import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withDb, type Db } from '../src/platform/db.js';
import {
  createDb,
  createTenantWithOwner,
  enrollMfa,
  loginClient,
  makeApp,
  newClient,
  TEST_DB_URL,
  uniq,
} from './helpers.js';

describe.skipIf(!TEST_DB_URL)('company and system e-mail (database)', () => {
  let db: Db;
  let ctx: ReturnType<typeof makeApp>;

  beforeAll(() => {
    db = createDb(TEST_DB_URL as string);
    ctx = makeApp(db);
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  const plat = <T>(fn: Parameters<typeof withDb<T>>[2]) => withDb(db, { platform: true }, fn);

  it('adding an employee with an email makes their account and mails them the company welcome', async () => {
    const t = await createTenantWithOwner(db, 'welcome');
    const owner = await loginClient(ctx.app, db, t.email, t.password);
    const email = `${uniq('driver')}@example.test`;
    const number = uniq('E');

    const res = await owner
      .call('post', `/tenants/${t.tenant.id}/employees`)
      .send({
        employeeNumber: number,
        fullName: 'Aminata Kamara',
        role: 'DRIVER',
        email,
        phone: '+23277' + String(Date.now()).slice(-6),
      })
      .expect(201);

    const mail = ctx.mailer.sent.find((m) => m.to === email && m.template === 'staff-added');
    expect(mail?.tenantId).toBe(t.tenant.id);
    expect(mail?.data.password).toMatch(/^[\w-]{12,}$/);
    expect(mail?.data.link).toContain(`/${t.tenant.slug}/login`);
    expect(mail?.data.employeeNumber).toBe(number);

    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.mustChangePassword).toBe(true);
    expect(user.homeTenantId).toBe(t.tenant.id);
    const emp = await plat((tx) => tx.employee.findUniqueOrThrow({ where: { id: res.body.id } }));
    expect(emp.userId).toBe(user.id);

    // The first password works on the company's own page, then must be replaced.
    const login = await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ email, password: mail?.data.password, companySlug: t.tenant.slug })
      .expect(200);
    expect(login.status).toBe(200);
  });

  it('refuses an email that already belongs to a member and leaves no half-added employee', async () => {
    const t = await createTenantWithOwner(db, 'dupe');
    const owner = await loginClient(ctx.app, db, t.email, t.password);
    const number = uniq('E');
    await owner
      .call('post', `/tenants/${t.tenant.id}/employees`)
      .send({ employeeNumber: number, fullName: 'Same Person', role: 'DRIVER', email: t.email })
      .expect(409);
    const left = await plat((tx) =>
      tx.employee.count({ where: { tenantId: t.tenant.id, employeeNumber: number } }),
    );
    expect(left).toBe(0);
  });

  it('a password reset asked for on a company page is sent in that company brand to its page', async () => {
    const t = await createTenantWithOwner(db, 'reset');
    ctx.mailer.sent.length = 0;
    await request(ctx.app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: t.email, companySlug: t.tenant.slug })
      .expect(202);
    const mail = ctx.mailer.sent.find((m) => m.to === t.email && m.template === 'password-reset');
    expect(mail?.tenantId).toBe(t.tenant.id);
    expect(mail?.data.link).toContain(`/${t.tenant.slug}/reset-password?token=`);
  });

  it('platform staff write to a company administrator in the system look, with attachments', async () => {
    const t = await createTenantWithOwner(db, 'mailed');
    const ops = await newClient(ctx.app, db, 'plat-ops');
    await enrollMfa(ops);
    await db.platformRoleAssignment.create({ data: { userId: ops.userId, role: 'OPERATIONS' } });

    const list = await ops.call('get', '/platform/email/companies').expect(200);
    const row = list.body.items.find((c: { id: string }) => c.id === t.tenant.id);
    expect(row.adminEmail).toBe(t.email);

    ctx.mailer.sent.length = 0;
    await ops
      .call('post', '/platform/email')
      .send({
        tenantId: t.tenant.id,
        subject: 'Scheduled maintenance',
        message: 'We will be down on Sunday.',
        attachments: [
          { name: 'notice.pdf', contentBase64: Buffer.from('hello').toString('base64') },
        ],
      })
      .expect(202);
    const mail = ctx.mailer.sent.find((m) => m.template === 'platform-message');
    expect(mail?.to).toBe(t.email);
    expect(mail?.tenantId).toBeUndefined();
    expect(mail?.attachments?.[0]?.name).toBe('notice.pdf');

    await ops
      .call('post', '/platform/email')
      .send({
        tenantId: t.tenant.id,
        subject: 'Bad',
        message: 'x',
        attachments: [{ name: 'run.exe', contentBase64: 'QUJD' }],
      })
      .expect(400);
  });

  it('company staff cannot use the platform email', async () => {
    const t = await createTenantWithOwner(db, 'nope');
    const owner = await loginClient(ctx.app, db, t.email, t.password);
    await owner
      .call('post', '/platform/email')
      .send({ tenantId: t.tenant.id, subject: 'a', message: 'b' })
      .expect(404);
  });

  it('sends a password reset only from the page the account belongs to', async () => {
    const a = await createTenantWithOwner(db, 'scopea');
    const b = await createTenantWithOwner(db, 'scopeb');
    const admin = await newClient(ctx.app, db, 'plat-scope');
    await db.platformRoleAssignment.create({ data: { userId: admin.userId, role: 'SUPPORT' } });
    const ask = async (email: string, companySlug?: string) => {
      ctx.mailer.sent.length = 0;
      await request(ctx.app)
        .post('/api/v1/auth/forgot-password')
        .send({ email, ...(companySlug ? { companySlug } : {}) })
        .expect(202);
      return ctx.mailer.sent.filter((m) => m.to === email && m.template === 'password-reset');
    };
    // A company's own owner on that company's page: sent, and it is that company's.
    const own = await ask(a.email, a.tenant.slug);
    expect(own).toHaveLength(1);
    expect(own[0]?.tenantId).toBe(a.tenant.id);
    // The same account on another company's page, or on the main page: nothing is sent.
    expect(await ask(a.email, b.tenant.slug)).toHaveLength(0);
    expect(await ask(a.email)).toHaveLength(0);
    // A platform administrator: only from the main page.
    expect(await ask(admin.email, a.tenant.slug)).toHaveLength(0);
    const main = await ask(admin.email);
    expect(main).toHaveLength(1);
    expect(main[0]?.tenantId).toBeUndefined();
    // Every answer looked the same (no way to tell who has an account).
    const unknown = await request(ctx.app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: `nobody-${Date.now()}@example.test`, companySlug: a.tenant.slug });
    expect(unknown.status).toBe(202);
  });

  it('gives a new staff member the role chosen, and refuses a role the adder does not hold', async () => {
    const t = await createTenantWithOwner(db, 'roles');
    const owner = await loginClient(ctx.app, db, t.email, t.password);
    const email = `${uniq('disp')}@example.test`;
    await owner
      .call('post', `/tenants/${t.tenant.id}/employees`)
      .send({ employeeNumber: uniq('E'), fullName: 'Dina Patch', roleKey: 'dispatcher', email })
      .expect(201);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const held = await plat((tx) =>
      tx.membership.findFirstOrThrow({
        where: { tenantId: t.tenant.id, userId: user.id },
        include: { role: true },
      }),
    );
    expect(held.role.key).toBe('dispatcher');

    // An administrator cannot create an owner.
    const admin = await newClient(ctx.app, db, 'adm');
    await plat(async (tx) => {
      const role = await tx.role.findFirstOrThrow({
        where: { tenantId: t.tenant.id, key: 'admin' },
      });
      await tx.membership.create({
        data: { tenantId: t.tenant.id, userId: admin.userId, roleId: role.id, status: 'ACTIVE' },
      });
    });
    const number = uniq('E');
    await admin
      .call('post', `/tenants/${t.tenant.id}/employees`)
      .send({
        employeeNumber: number,
        fullName: 'Sneaky Owner',
        roleKey: 'owner',
        email: `${uniq('own')}@example.test`,
      })
      .expect((r) => expect([403, 404]).toContain(r.status));
    expect(
      await plat((tx) =>
        tx.employee.count({ where: { tenantId: t.tenant.id, employeeNumber: number } }),
      ),
    ).toBe(0);
  });

  it('ends the whole session on sign out', async () => {
    const t = await createTenantWithOwner(db, 'bye');
    const login = await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ email: t.email, password: t.password, companySlug: t.tenant.slug })
      .expect(200);
    const cookies = (login.headers['set-cookie'] as unknown as string[]).map(
      (c) => c.split(';')[0],
    );
    const csrf = cookies.find((c) => c?.startsWith('csrf='))?.slice(5) ?? '';
    await request(ctx.app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookies.join('; '))
      .set('x-csrf-token', csrf)
      .expect(204);
    await request(ctx.app).get('/api/v1/auth/me').set('Cookie', cookies.join('; ')).expect(401);
  });

  it('lists staff among the users of the company, and lets an owner add a role to themselves', async () => {
    const t = await createTenantWithOwner(db, 'userlist');
    const owner = await loginClient(ctx.app, db, t.email, t.password);
    const users = await owner.call('get', `/tenants/${t.tenant.id}/users`).expect(200);
    const me = users.body.users.find((u: { email: string }) => u.email === t.email);
    expect(me?.isStaff).toBe(true);

    const membership = (await owner.call('get', `/tenants/${t.tenant.id}/memberships`).expect(200))
      .body.memberships[0];
    const dispatcher = (
      await owner.call('get', `/tenants/${t.tenant.id}/roles`).expect(200)
    ).body.roles.find((r: { key: string }) => r.key === 'dispatcher');
    await owner
      .call('post', `/tenants/${t.tenant.id}/memberships/${membership.id}/roles`)
      .send({ roleId: dispatcher.id })
      .expect(204);
    await owner
      .call('post', `/tenants/${t.tenant.id}/me/switch-role`)
      .send({ role: dispatcher.id })
      .expect(204);
  });
});
