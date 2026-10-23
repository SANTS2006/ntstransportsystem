import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withDb, type Db, type Tx } from '../src/platform/db.js';
import {
  createDb,
  createTenantWithOwner,
  enrollMfa,
  loginClient,
  makeApp,
  newClient,
  TEST_DB_URL,
  uniq,
  type Client,
} from './helpers.js';

const tokenFrom = (link?: string) => new URL(link ?? 'http://x').searchParams.get('token') ?? '';

describe.skipIf(!TEST_DB_URL)('tenants, memberships and RBAC (database)', () => {
  let db: Db;
  let ctx: ReturnType<typeof makeApp>;

  beforeAll(() => {
    db = createDb(TEST_DB_URL as string);
    ctx = makeApp(db);
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  /** An ACTIVE company with an owner who is signed in. */
  async function activeCompany(label: string) {
    const t = await createTenantWithOwner(db, label);
    const owner = await loginClient(ctx.app, db, t.email, t.password);
    return { tenant: t.tenant, owner };
  }

  /** Adds a signed-in member with the given role key, bypassing the invite flow. */
  async function addMember(tenantId: string, roleKey: string, label = roleKey): Promise<Client> {
    const c = await newClient(ctx.app, db, label);
    await withDb(db, { platform: true }, async (tx) => {
      const role = await tx.role.findFirstOrThrow({ where: { tenantId, key: roleKey } });
      await tx.membership.create({
        data: { tenantId, userId: c.userId, roleId: role.id, status: 'ACTIVE' },
      });
    });
    return c;
  }

  async function platformUser(role: 'SUPER_ADMIN' | 'OPERATIONS' | 'SUPPORT', withMfa = true) {
    const c = await newClient(ctx.app, db, `plat-${role.toLowerCase()}`);
    if (withMfa) await enrollMfa(c);
    await db.platformRoleAssignment.create({ data: { userId: c.userId, role } });
    return c;
  }

  /** Test-only direct reads of RLS tables use explicit platform scope (the app role sees nothing otherwise). */
  const plat = <T>(fn: (tx: Tx) => Promise<T>) => withDb(db, { platform: true }, fn);
  const membershipOf = (tenantId: string, userId: string) =>
    plat((tx) => tx.membership.findFirstOrThrow({ where: { tenantId, userId } }));

  const roleIdOf = (tenantId: string, key: string) =>
    withDb(db, { platform: true }, (tx) =>
      tx.role.findFirstOrThrow({ where: { tenantId, key } }).then((r) => r.id),
    );

  describe('company application and platform lifecycle', () => {
    it('does not let a user register a company for themselves', async () => {
      const u = await newClient(ctx.app, db, 'applicant');
      await u.call('post', '/tenants').send({ name: 'Sierra Coaches Ltd' }).expect(404);
      await u
        .call('post', '/platform/tenants')
        .send({
          name: 'Sierra Coaches Ltd',
          slug: 'sierra-coaches',
          adminName: 'Some One',
          adminEmail: 'someone@example.test',
        })
        .expect(404);
      const mine = await u.call('get', '/tenants/mine').expect(200);
      expect(mine.body.tenants).toEqual([]);
    });

    const PNG = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64),
    ]);

    it('registers a company with its own address, colours and logo, and makes its administrator', async () => {
      const ops = await platformUser('OPERATIONS');
      const adminEmail = `${uniq('first-admin')}@example.test`;
      const slug = uniq('sierra').toLowerCase();
      const res = await ops
        .call('post', '/platform/tenants')
        .send({
          name: 'Sierra Coaches Ltd',
          slug,
          adminName: 'Ada Kamara',
          adminEmail,
          primaryColor: '#0b6e4f',
          accentColor: '#f4a300',
        })
        .expect(201);
      expect(res.body).toMatchObject({ status: 'ACTIVE', slug, adminAccountCreated: true });
      const id = res.body.id as string;

      // The e-mail carries the company sign-in link, the address and the generated password.
      const mail = ctx.mailer.sent.find(
        (m) => m.to === adminEmail && m.template === 'company-admin-created',
      );
      expect(mail?.data).toMatchObject({
        email: adminEmail,
        password: `SCL@${new Date().getFullYear()}`,
      });
      expect(mail?.data.link).toMatch(new RegExp(`/${slug}/login$`));

      // Unknown keys, a bad or reserved or taken address name are refused.
      const base = { name: 'Other Co', adminName: 'Bo Bangura', adminEmail: 'bo@example.test' };
      await ops
        .call('post', '/platform/tenants')
        .send({ ...base, slug: uniq('x'), status: 'ACTIVE' })
        .expect(400);
      await ops
        .call('post', '/platform/tenants')
        .send({ ...base, slug: 'Bad Name' })
        .expect(400);
      await ops
        .call('post', '/platform/tenants')
        .send({ ...base, slug: 'login' })
        .expect(409);
      await ops
        .call('post', '/platform/tenants')
        .send({ ...base, slug })
        .expect(409);

      // Logo: a real picture is stored, a script pretending to be one is refused.
      await ops
        .call('put', `/platform/tenants/${id}/logo`)
        .set('Content-Type', 'image/png')
        .send(Buffer.from('<script>alert(1)</script>'))
        .expect(400);
      await ops
        .call('put', `/platform/tenants/${id}/logo`)
        .set('Content-Type', 'image/png')
        .send(PNG)
        .expect(204);

      // Anyone can see the company's sign-in branding, and only that.
      const pub = await request(ctx.app).get(`/api/v1/public/companies/${slug}`).expect(200);
      expect(pub.body).toMatchObject({
        name: 'Sierra Coaches Ltd',
        slug,
        primaryColor: '#0b6e4f',
        accentColor: '#f4a300',
      });
      expect(pub.body.logoUrl).toContain(`/public/companies/${slug}/logo`);
      const logo = await request(ctx.app).get(`/api/v1/public/companies/${slug}/logo`).expect(200);
      expect(logo.headers['content-type']).toBe('image/png');
      expect(logo.headers['x-content-type-options']).toBe('nosniff');
      await request(ctx.app).get('/api/v1/public/companies/no-such-company').expect(404);

      // The new administrator signs in with the generated password and must change it first.
      const login = await request(ctx.app)
        .post('/api/v1/auth/login')
        .send({ email: adminEmail, password: mail?.data.password })
        .expect(200);
      const sid = (login.headers['set-cookie'] as unknown as string[])
        .find((c) => c.startsWith('sid='))!
        .split(';')[0]!;
      const csrf = (login.headers['set-cookie'] as unknown as string[])
        .find((c) => c.startsWith('csrf='))!
        .split(';')[0]!
        .slice(5);
      const as = (path: string) =>
        request(ctx.app).get(`/api/v1${path}`).set('Cookie', `${sid}; csrf=${csrf}`);
      const me = await as('/auth/me').expect(200);
      expect(me.body.mustChangePassword).toBe(true);
      const blocked = await as('/tenants/mine').expect(403);
      expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      await request(ctx.app)
        .post('/api/v1/auth/change-password')
        .set('Cookie', `${sid}; csrf=${csrf}`)
        .set('x-csrf-token', csrf)
        .send({ currentPassword: mail?.data.password, newPassword: 'a-brand-new-password-1' })
        .expect(200);
      const mine = await as('/tenants/mine').expect(200);
      expect(mine.body.tenants).toEqual([
        expect.objectContaining({
          tenantId: id,
          status: 'ACTIVE',
          role: expect.objectContaining({ key: 'owner' }),
        }),
      ]);
      expect((await as('/auth/me').expect(200)).body.mustChangePassword).toBe(false);

      // The company's own owner can change colours and logo, a plain member cannot.
      const owner = await loginClient(ctx.app, db, adminEmail, 'a-brand-new-password-1');
      await owner
        .call('patch', `/tenants/${id}/branding`)
        .send({ primaryColor: '#123456', accentColor: null })
        .expect(200);
      await owner
        .call('patch', `/tenants/${id}/branding`)
        .send({ primaryColor: 'red', accentColor: null })
        .expect(400);
      const other = await activeCompany('brand-other');
      await other.owner
        .call('patch', `/tenants/${id}/branding`)
        .send({ primaryColor: '#111111', accentColor: null })
        .expect(404);

      const audit = await withDb(db, { platform: true }, (tx) =>
        tx.auditLog.findMany({
          where: {
            tenantId: id,
            action: { in: ['platform.tenant_created', 'platform.admin_provisioned'] },
          },
        }),
      );
      expect(audit.map((e) => e.action).sort()).toEqual([
        'platform.admin_provisioned',
        'platform.tenant_created',
      ]);
    });

    it('makes an existing account the administrator without changing its password', async () => {
      const ops = await platformUser('OPERATIONS');
      const person = await newClient(ctx.app, db, 'existing-admin');
      const res = await ops
        .call('post', '/platform/tenants')
        .send({
          name: 'Existing Admin Co',
          slug: uniq('existing').toLowerCase(),
          adminName: 'Whoever',
          adminEmail: person.email,
        })
        .expect(201);
      expect(res.body.adminAccountCreated).toBe(false);
      const mail = ctx.mailer.sent.find(
        (m) => m.to === person.email && m.template === 'company-admin-created',
      );
      expect(mail?.data.password).toBe('');
      const mine = await person.call('get', '/tenants/mine').expect(200);
      expect(mine.body.tenants).toHaveLength(1);
    });

    it('lets anyone signed in change their name and picture', async () => {
      const u = await newClient(ctx.app, db, 'profile');
      await u.call('patch', '/auth/me').send({ displayName: 'Fanta Jalloh' }).expect(204);
      await u.call('patch', '/auth/me').send({ displayName: '' }).expect(400);
      await u
        .call('put', '/auth/me/avatar')
        .set('Content-Type', 'image/png')
        .send(Buffer.from('not a picture'))
        .expect(400);
      await u.call('put', '/auth/me/avatar').set('Content-Type', 'image/png').send(PNG).expect(204);
      const me = await u.call('get', '/auth/me').expect(200);
      expect(me.body.displayName).toBe('Fanta Jalloh');
      expect(me.body.avatarVersion).toEqual(expect.any(Number));
      const pic = await u.call('get', '/auth/me/avatar').expect(200);
      expect(pic.headers['content-type']).toBe('image/png');
      await u.call('delete', '/auth/me/avatar').expect(204);
      await u.call('get', '/auth/me/avatar').expect(404);
    });

    it('rejects client-supplied tenant status/slug on profile update', async () => {
      const { tenant, owner } = await activeCompany('ma-active');
      await owner
        .call('patch', `/tenants/${tenant.id}/profile`)
        .send({ status: 'SUSPENDED' })
        .expect(400);
      await owner
        .call('patch', `/tenants/${tenant.id}/profile`)
        .send({ slug: 'hijack' })
        .expect(400);
      await owner
        .call('patch', `/tenants/${tenant.id}/profile`)
        .send({ name: 'Renamed Coaches' })
        .expect(200);
    });

    it('stops a company approving itself even if app code were bypassed (DB trigger)', async () => {
      const { tenant } = await activeCompany('selfapprove');
      await expect(
        withDb(db, { tenantId: tenant.id }, (tx) =>
          tx.tenant.update({ where: { id: tenant.id }, data: { status: 'SUSPENDED' } }),
        ),
      ).rejects.toThrow();
    });

    it('hides the platform area from people with no platform role', async () => {
      const u = await newClient(ctx.app, db, 'nobody');
      await u.call('get', '/platform/tenants').expect(404);
    });

    it('requires MFA for platform access, and audits the denial', async () => {
      const p = await platformUser('OPERATIONS', false);
      const res = await p.call('get', '/platform/tenants').expect(403);
      expect(res.body.error.message).toMatch(/multi-factor/i);
      const events = await withDb(db, { platform: true }, (tx) =>
        tx.auditLog.findMany({
          where: { action: 'platform.access_denied', actorUserId: p.userId },
        }),
      );
      expect(events.length).toBeGreaterThan(0);
    });

    it('lets OPERATIONS approve, reject and suspend with legal transitions only', async () => {
      const pend = await createTenantWithOwner(db, 'life', 'PENDING');
      const applicant = await loginClient(ctx.app, db, pend.email, pend.password);
      const id = pend.tenant.id;
      const ops = await platformUser('OPERATIONS');

      const pending = await ops.call('get', '/platform/tenants?status=PENDING').expect(200);
      expect(pending.body.tenants.some((t: { id: string }) => t.id === id)).toBe(true);

      await ops
        .call('post', `/platform/tenants/${id}/suspend`)
        .send({ reason: 'too early' })
        .expect(409); // PENDING cannot be suspended
      await ops.call('post', `/platform/tenants/${id}/approve`).send({}).expect(200);
      await ops.call('post', `/platform/tenants/${id}/approve`).send({}).expect(409);
      await ops.call('post', `/platform/tenants/${id}/suspend`).send({}).expect(400); // reason required
      await ops
        .call('post', `/platform/tenants/${id}/suspend`)
        .send({ reason: 'Unpaid fees' })
        .expect(200);

      // A suspended company is locked out of its own workspace immediately.
      await applicant.call('get', `/tenants/${id}/memberships`).expect(403);
      await ops.call('post', `/platform/tenants/${id}/reactivate`).send({}).expect(200);
      await applicant.call('get', `/tenants/${id}/memberships`).expect(200);

      const audit = await withDb(db, { platform: true }, (tx) =>
        tx.auditLog.findMany({
          where: { tenantId: id, action: { startsWith: 'platform.tenant_' } },
        }),
      );
      expect(audit.map((e) => e.action)).toEqual(
        expect.arrayContaining([
          'platform.tenant_approve',
          'platform.tenant_suspend',
          'platform.tenant_reactivate',
        ]),
      );
      expect(audit.some((e) => e.outcome === 'DENIED')).toBe(true); // the illegal transition attempts
    });

    it('does not let SUPPORT change company status, but lets them read', async () => {
      const a = { body: { id: (await createTenantWithOwner(db, 'supp', 'PENDING')).tenant.id } };
      const support = await platformUser('SUPPORT');
      await support.call('get', '/platform/tenants').expect(200);
      await support.call('post', `/platform/tenants/${a.body.id}/approve`).send({}).expect(403);
    });

    it('shows the audit log to SECURITY_AUDIT and SUPER_ADMIN only, with filters', async () => {
      const { tenant } = await activeCompany('audit-view');
      const ops = await platformUser('OPERATIONS');
      await ops
        .call('post', `/platform/tenants/${tenant.id}/suspend`)
        .send({ reason: 'audit test' })
        .expect(200);
      await ops.call('get', '/platform/audit').expect(403);

      const sec = await newClient(ctx.app, db, 'plat-sec');
      await enrollMfa(sec);
      await db.platformRoleAssignment.create({
        data: { userId: sec.userId, role: 'SECURITY_AUDIT' },
      });
      const res = await sec
        .call('get', `/platform/audit?tenantId=${tenant.id}&action=tenant_suspend`)
        .expect(200);
      expect(res.body.total).toBeGreaterThan(0);
      expect(res.body.events[0]).toMatchObject({
        action: 'platform.tenant_suspend',
        tenant: { id: tenant.id },
      });
      expect(res.body.events[0].actor).toMatchObject({ id: ops.userId });
      await sec.call('get', '/platform/audit?outcome=NOPE').expect(400);

      const nobody = await newClient(ctx.app, db, 'audit-nobody');
      await nobody.call('get', '/platform/audit').expect(404);
    });

    it('does not give a company owner any platform access', async () => {
      const { owner } = await activeCompany('owner-not-platform');
      await enrollMfa(owner);
      await owner.call('get', '/platform/tenants').expect(404);
    });
  });

  describe('tenant isolation over HTTP', () => {
    it('gives non-members the same 404 as for a company that does not exist', async () => {
      const a = await activeCompany('iso-http-a');
      const b = await activeCompany('iso-http-b');
      const cross = await b.owner.call('get', `/tenants/${a.tenant.id}/memberships`).expect(404);
      const ghost = await b.owner.call('get', `/tenants/${randomUUID()}/memberships`).expect(404);
      // Identical except for the per-request correlation ID.
      expect({ ...cross.body.error, requestId: 'x' }).toEqual({
        ...ghost.body.error,
        requestId: 'x',
      });
      for (const path of ['profile', 'roles', 'invitations', 'audit']) {
        await b.owner.call('get', `/tenants/${a.tenant.id}/${path}`).expect(404);
      }
    });

    it("cannot act on another company's members, roles or invitations by guessing IDs", async () => {
      const a = await activeCompany('iso-obj-a');
      const b = await activeCompany('iso-obj-b');
      const aMember = (await a.owner.call('get', `/tenants/${a.tenant.id}/memberships`).expect(200))
        .body.memberships[0];
      const aRole = await roleIdOf(a.tenant.id, 'driver');
      // Through B's own (valid) tenant scope, A's object IDs are simply not found.
      await b.owner.call('delete', `/tenants/${b.tenant.id}/memberships/${aMember.id}`).expect(404);
      await b.owner
        .call('patch', `/tenants/${b.tenant.id}/memberships/${aMember.id}`)
        .send({ roleKey: 'driver' })
        .expect(404);
      await b.owner
        .call('put', `/tenants/${b.tenant.id}/roles/${aRole}/permissions`)
        .send({ permissions: [] })
        .expect(404);
      await b.owner.call('delete', `/tenants/${b.tenant.id}/roles/${aRole}`).expect(404);
      // ...and A is unharmed.
      expect(
        await plat((tx) => tx.membership.count({ where: { id: aMember.id, status: 'ACTIVE' } })),
      ).toBe(1);
    });

    it("keeps each company's audit trail separate", async () => {
      const a = await activeCompany('iso-audit-a');
      const b = await activeCompany('iso-audit-b');
      await a.owner
        .call('patch', `/tenants/${a.tenant.id}/profile`)
        .send({ name: 'Alpha Renamed' })
        .expect(200);
      const aEvents = (await a.owner.call('get', `/tenants/${a.tenant.id}/audit`).expect(200)).body
        .events;
      const bEvents = (await b.owner.call('get', `/tenants/${b.tenant.id}/audit`).expect(200)).body
        .events;
      expect(aEvents.some((e: { action: string }) => e.action === 'tenant.profile_updated')).toBe(
        true,
      );
      expect(bEvents.some((e: { action: string }) => e.action === 'tenant.profile_updated')).toBe(
        false,
      );
    });

    it('lists only the caller’s own companies', async () => {
      const a = await activeCompany('iso-mine-a');
      await activeCompany('iso-mine-b');
      const mine = (await a.owner.call('get', '/tenants/mine').expect(200)).body.tenants;
      expect(mine.map((t: { tenantId: string }) => t.tenantId)).toEqual([a.tenant.id]);
    });

    it('enforces permissions per route (driver cannot manage members or read audit)', async () => {
      const { tenant } = await activeCompany('perm-routes');
      const driver = await addMember(tenant.id, 'driver');
      await driver.call('get', `/tenants/${tenant.id}/memberships`).expect(403);
      await driver
        .call('post', `/tenants/${tenant.id}/invitations`)
        .send({ email: 'x@example.test', roleKey: 'driver' })
        .expect(403);
      await driver.call('get', `/tenants/${tenant.id}/audit`).expect(403);
      await driver
        .call('patch', `/tenants/${tenant.id}/profile`)
        .send({ name: 'Nope Nope' })
        .expect(403);
    });
  });

  describe('UI support endpoints', () => {
    it("returns the caller's own role and permissions, and 404 for a non-member", async () => {
      const a = await activeCompany('me-a');
      const b = await activeCompany('me-b');
      const driver = await addMember(a.tenant.id, 'driver');

      const own = await driver.call('get', `/tenants/${a.tenant.id}/me`).expect(200);
      expect(own.body.role.key).toBe('driver');
      expect(own.body.permissions).toEqual(['ticket.validate', 'trip.read']);
      const owner = await a.owner.call('get', `/tenants/${a.tenant.id}/me`).expect(200);
      expect(owner.body.permissions).toContain('role.manage');

      await b.owner.call('get', `/tenants/${a.tenant.id}/me`).expect(404);
    });

    it('reports platform roles (names only) on /auth/me', async () => {
      const plain = await newClient(ctx.app, db, 'plain-me');
      expect((await plain.call('get', '/auth/me').expect(200)).body.platformRoles).toEqual([]);
      const ops = await platformUser('OPERATIONS', false);
      const me = await ops.call('get', '/auth/me').expect(200);
      expect(me.body.platformRoles).toEqual(['OPERATIONS']);
      expect(me.body.passwordHash).toBeUndefined();
    });
  });

  describe('refused actions are audited', () => {
    const denials = (tenantId: string, actorUserId: string, action: string) =>
      plat((tx) =>
        tx.auditLog.findMany({ where: { tenantId, actorUserId, action, outcome: 'DENIED' } }),
      );

    it('records a route-level permission failure', async () => {
      const { tenant } = await activeCompany('audit-perm');
      const driver = await addMember(tenant.id, 'driver');
      await driver.call('get', `/tenants/${tenant.id}/memberships`).expect(403);
      const events = await denials(tenant.id, driver.userId, 'authz.permission_denied');
      expect(events).toHaveLength(1);
      expect(events[0]?.summary).toMatchObject({ permission: 'membership.read' });
    });

    it('records an escalation attempt and a last-owner refusal, and the rows survive the failed request', async () => {
      const { tenant, owner } = await activeCompany('audit-svc');
      const admin = await addMember(tenant.id, 'admin');
      await admin
        .call('post', `/tenants/${tenant.id}/invitations`)
        .send({ email: 'x@example.test', roleKey: 'owner' })
        .expect(403);
      const escalations = await denials(tenant.id, admin.userId, 'membership.invite_denied');
      expect(escalations).toHaveLength(1);
      expect(escalations[0]?.summary).toMatchObject({ reason: 'FORBIDDEN' });

      const ownerMembership = await membershipOf(tenant.id, owner.userId);
      await owner
        .call('delete', `/tenants/${tenant.id}/memberships/${ownerMembership.id}`)
        .expect(409);
      const lastOwner = await denials(tenant.id, owner.userId, 'membership.revoke_denied');
      expect(lastOwner).toHaveLength(1);
      expect(lastOwner[0]?.summary).toMatchObject({ reason: 'CONFLICT' });
    });

    it('does not audit a successful action as denied, and keeps denials inside their own tenant', async () => {
      const a = await activeCompany('audit-iso-a');
      const b = await activeCompany('audit-iso-b');
      const driver = await addMember(a.tenant.id, 'driver');
      await driver.call('get', `/tenants/${a.tenant.id}/memberships`).expect(403);
      const seenByB = await b.owner.call('get', `/tenants/${b.tenant.id}/audit`).expect(200);
      expect(
        seenByB.body.events.some((e: { action: string }) => e.action === 'authz.permission_denied'),
      ).toBe(false);
      const seenByA = await a.owner.call('get', `/tenants/${a.tenant.id}/audit`).expect(200);
      expect(
        seenByA.body.events.some((e: { action: string }) => e.action === 'authz.permission_denied'),
      ).toBe(true);
    });
  });

  describe('invitations', () => {
    it('invites, accepts once, and binds acceptance to the invited verified email', async () => {
      const { tenant, owner } = await activeCompany('invite');
      const invitee = await newClient(ctx.app, db, 'invitee');
      const stranger = await newClient(ctx.app, db, 'stranger');

      await owner
        .call('post', `/tenants/${tenant.id}/invitations`)
        .send({ email: invitee.email, roleKey: 'dispatcher' })
        .expect(201);
      const mail = ctx.mailer.last('tenant-invitation');
      expect(mail?.to).toBe(invitee.email);
      expect(mail?.data.company).toBeTruthy();
      const token = tokenFrom(mail?.data.link);

      // Someone else holding the link cannot use it.
      await stranger.call('post', '/invitations/accept').send({ token }).expect(400);
      const ok = await invitee.call('post', '/invitations/accept').send({ token }).expect(200);
      expect(ok.body.tenantId).toBe(tenant.id);
      await invitee.call('post', '/invitations/accept').send({ token }).expect(400); // single use

      const mine = (await invitee.call('get', '/tenants/mine').expect(200)).body.tenants;
      expect(mine[0].role.key).toBe('dispatcher');
      const stored = await plat((tx) => tx.invitation.findMany({ where: { tenantId: tenant.id } }));
      expect(stored.some((i) => i.tokenHash === token)).toBe(false); // only a hash is stored
    });

    it('revoked, superseded and unknown invitations cannot be accepted', async () => {
      const { tenant, owner } = await activeCompany('invite-revoke');
      const invitee = await newClient(ctx.app, db, 'invitee2');
      const send = async () => {
        const r = await owner
          .call('post', `/tenants/${tenant.id}/invitations`)
          .send({ email: invitee.email, roleKey: 'driver' })
          .expect(201);
        return {
          id: r.body.id as string,
          token: tokenFrom(ctx.mailer.last('tenant-invitation')?.data.link),
        };
      };
      const first = await send();
      const second = await send(); // supersedes the first
      await invitee.call('post', '/invitations/accept').send({ token: first.token }).expect(400);
      await owner.call('delete', `/tenants/${tenant.id}/invitations/${second.id}`).expect(204);
      await invitee.call('post', '/invitations/accept').send({ token: second.token }).expect(400);
      await invitee
        .call('post', '/invitations/accept')
        .send({ token: 'z'.repeat(43) })
        .expect(400);
    });

    it('does not honour an invitation once the company is no longer active', async () => {
      const { tenant, owner } = await activeCompany('invite-suspended');
      const invitee = await newClient(ctx.app, db, 'invitee3');
      await owner
        .call('post', `/tenants/${tenant.id}/invitations`)
        .send({ email: invitee.email, roleKey: 'driver' })
        .expect(201);
      const token = tokenFrom(ctx.mailer.last('tenant-invitation')?.data.link);
      await withDb(db, { platform: true }, (tx) =>
        tx.tenant.update({ where: { id: tenant.id }, data: { status: 'SUSPENDED' } }),
      );
      await invitee.call('post', '/invitations/accept').send({ token }).expect(400);
    });

    it('rejects an invitation to a role that does not exist in this company', async () => {
      const { tenant, owner } = await activeCompany('invite-badrole');
      await owner
        .call('post', `/tenants/${tenant.id}/invitations`)
        .send({ email: 'a@example.test', roleKey: 'nonexistent' })
        .expect(404);
    });
  });

  describe('privilege escalation and safety rules', () => {
    it('stops an administrator granting roles or permissions they do not hold', async () => {
      const { tenant } = await activeCompany('escalate');
      const admin = await addMember(tenant.id, 'admin'); // lacks finance.report.read and hr.read
      const target = await addMember(tenant.id, 'driver', 'target');
      const targetMembership = await membershipOf(tenant.id, target.userId);

      await admin
        .call('post', `/tenants/${tenant.id}/invitations`)
        .send({ email: 'o@example.test', roleKey: 'owner' })
        .expect(403);
      await admin
        .call('post', `/tenants/${tenant.id}/invitations`)
        .send({ email: 'f@example.test', roleKey: 'finance_officer' })
        .expect(403);
      await admin
        .call('patch', `/tenants/${tenant.id}/memberships/${targetMembership.id}`)
        .send({ roleKey: 'hr_manager' })
        .expect(403);
      await admin
        .call('post', `/tenants/${tenant.id}/roles`)
        .send({ key: 'sneaky', name: 'Sneaky', permissions: ['hr.read'] })
        .expect(403);
      // What they do hold, they may grant.
      await admin
        .call('patch', `/tenants/${tenant.id}/memberships/${targetMembership.id}`)
        .send({ roleKey: 'dispatcher' })
        .expect(204);
    });

    it('stops an administrator removing or demoting an owner, or changing their own role', async () => {
      const { tenant, owner } = await activeCompany('protect-owner');
      const admin = await addMember(tenant.id, 'admin');
      const ownerMembership = await membershipOf(tenant.id, owner.userId);
      const adminMembership = await membershipOf(tenant.id, admin.userId);

      await admin
        .call('delete', `/tenants/${tenant.id}/memberships/${ownerMembership.id}`)
        .expect(403);
      await admin
        .call('patch', `/tenants/${tenant.id}/memberships/${ownerMembership.id}`)
        .send({ roleKey: 'driver' })
        .expect(403);
      await admin
        .call('patch', `/tenants/${tenant.id}/memberships/${adminMembership.id}`)
        .send({ roleKey: 'owner' })
        .expect(403);
    });

    it('never lets a company lose its last owner', async () => {
      const { tenant, owner } = await activeCompany('last-owner');
      const m = await membershipOf(tenant.id, owner.userId);
      await owner.call('delete', `/tenants/${tenant.id}/memberships/${m.id}`).expect(409);
      // A second owner makes removal of the first legitimate.
      const second = await addMember(tenant.id, 'owner', 'owner2');
      await owner.call('delete', `/tenants/${tenant.id}/memberships/${m.id}`).expect(204);
      await second.call('get', `/tenants/${tenant.id}/memberships`).expect(200);
    });

    it('applies revocation on the very next request', async () => {
      const { tenant, owner } = await activeCompany('revoke-now');
      const dispatcher = await addMember(tenant.id, 'dispatcher');
      const m = await membershipOf(tenant.id, dispatcher.userId);
      await dispatcher.call('get', `/tenants/${tenant.id}/profile`).expect(200);
      await owner.call('delete', `/tenants/${tenant.id}/memberships/${m.id}`).expect(204);
      await dispatcher.call('get', `/tenants/${tenant.id}/profile`).expect(404);
    });

    it('keeps the owner role immutable and protects roles that are in use', async () => {
      const { tenant, owner } = await activeCompany('roles');
      const ownerRoleId = await roleIdOf(tenant.id, 'owner');
      await owner
        .call('put', `/tenants/${tenant.id}/roles/${ownerRoleId}/permissions`)
        .send({ permissions: [] })
        .expect(403);
      await owner.call('delete', `/tenants/${tenant.id}/roles/${ownerRoleId}`).expect(403);

      const created = await owner
        .call('post', `/tenants/${tenant.id}/roles`)
        .send({
          key: uniq('custom').replace(/-/g, '_').slice(0, 30),
          name: 'Custom Role',
          permissions: ['route.read', 'trip.read'],
        })
        .expect(201);
      const id = created.body.id as string;
      await owner
        .call('put', `/tenants/${tenant.id}/roles/${id}/permissions`)
        .send({ permissions: ['route.read'] })
        .expect(204);
      await owner
        .call('put', `/tenants/${tenant.id}/roles/${id}/permissions`)
        .send({ permissions: ['not.a.permission'] })
        .expect(400);

      const roles = (await owner.call('get', `/tenants/${tenant.id}/roles`).expect(200)).body;
      expect(roles.roles.find((r: { id: string }) => r.id === id).permissions).toEqual([
        'route.read',
      ]);

      // In use: cannot delete until unassigned.
      const holder = await newClient(ctx.app, db, 'holder');
      await withDb(db, { platform: true }, (tx) =>
        tx.membership.create({
          data: { tenantId: tenant.id, userId: holder.userId, roleId: id, status: 'ACTIVE' },
        }),
      );
      await owner.call('delete', `/tenants/${tenant.id}/roles/${id}`).expect(409);
    });

    it('rejects malformed identifiers without leaking details', async () => {
      const { tenant, owner } = await activeCompany('malformed');
      await owner.call('delete', `/tenants/${tenant.id}/memberships/not-a-uuid`).expect(404);
      await owner.call('get', '/tenants/not-a-uuid/profile').expect(404);
    });
  });
});
