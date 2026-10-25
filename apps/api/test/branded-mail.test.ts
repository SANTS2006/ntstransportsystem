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
});
