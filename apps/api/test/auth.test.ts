import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  createTenantWithOwner,
  makeApp,
  TEST_DB_URL,
  uniq,
  testCompanySlug,
} from './helpers.js';
import { withDb, type Db } from '../src/platform/db.js';

const PASSWORD = 'correct-horse-battery';
const tokenFrom = (link: string | undefined) =>
  new URL(link ?? 'http://x').searchParams.get('token') ?? '';
const cookieValue = (res: request.Response, name: string) =>
  (res.headers['set-cookie'] as unknown as string[] | undefined)
    ?.find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0]
    ?.slice(name.length + 1);

describe.skipIf(!TEST_DB_URL)('authentication (database)', () => {
  let db: Db;
  let SLUG = '';
  let ctx: ReturnType<typeof makeApp>;

  beforeAll(() => {
    db = createDb(TEST_DB_URL as string);
    ctx = makeApp(db);
  });
  beforeAll(async () => {
    SLUG = await testCompanySlug(db);
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  async function registerVerified(email = `${uniq('u')}@example.test`) {
    await request(ctx.app)
      .post('/api/v1/auth/register')
      .send({ companySlug: SLUG, email, password: PASSWORD, displayName: 'T' })
      .expect(202);
    const mail = ctx.mailer.last('verify-email');
    expect(mail?.to).toBe(email);
    await request(ctx.app)
      .post('/api/v1/auth/verify-email')
      .send({ token: tokenFrom(mail?.data.link) })
      .expect(200);
    return email;
  }

  it('registers, verifies, logs in and reads the profile with HttpOnly cookies', async () => {
    const email = await registerVerified();
    const login = await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ companySlug: SLUG, email, password: PASSWORD })
      .expect(200);
    const setCookie = (login.headers['set-cookie'] as unknown as string[]).join('\n');
    expect(setCookie).toMatch(/sid=[^;]+;.*HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const me = await request(ctx.app)
      .get('/api/v1/auth/me')
      .set('Cookie', `sid=${cookieValue(login, 'sid')}`)
      .expect(200);
    expect(me.body.email).toBe(email);
    expect(me.body.passwordHash).toBeUndefined();
  });

  it('does not log in before email verification', async () => {
    const email = `${uniq('unv')}@example.test`;
    await request(ctx.app)
      .post('/api/v1/auth/register')
      .send({ companySlug: SLUG, email, password: PASSWORD, displayName: 'T' })
      .expect(202);
    await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ companySlug: SLUG, email, password: PASSWORD })
      .expect(403);
  });

  it('confirms an email with the 6-character code, once, and not with a wrong one', async () => {
    const email = `${uniq('code')}@example.test`;
    await request(ctx.app)
      .post('/api/v1/auth/register')
      .send({ companySlug: SLUG, email, password: PASSWORD, displayName: 'T' })
      .expect(202);
    const code = ctx.mailer.last('verify-email')?.data.code ?? '';
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    const wrong = code === 'AAAAAA' ? 'BBBBBB' : 'AAAAAA';
    await request(ctx.app)
      .post('/api/v1/auth/verify-email-code')
      .send({ companySlug: SLUG, email, code: wrong })
      .expect(400);
    await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ companySlug: SLUG, email, password: PASSWORD })
      .expect(403);
    // Lower case is accepted; the code works once.
    await request(ctx.app)
      .post('/api/v1/auth/verify-email-code')
      .send({ companySlug: SLUG, email, code: code.toLowerCase() })
      .expect(200);
    await request(ctx.app)
      .post('/api/v1/auth/verify-email-code')
      .send({ companySlug: SLUG, email, code })
      .expect(400);
    await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ companySlug: SLUG, email, password: PASSWORD })
      .expect(200);
  });

  it('gives the same registration response for an existing email', async () => {
    const email = await registerVerified();
    const before = ctx.mailer.sent.length;
    const res = await request(ctx.app)
      .post('/api/v1/auth/register')
      .send({ companySlug: SLUG, email, password: PASSWORD, displayName: 'T' });
    expect(res.status).toBe(202);
    expect(ctx.mailer.sent.length).toBe(before);
  });

  it('returns identical failures for unknown user and wrong password', async () => {
    const email = await registerVerified();
    const wrong = await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ companySlug: SLUG, email, password: 'nope-nope-nope' });
    const unknown = await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ companySlug: SLUG, email: `${uniq('ghost')}@example.test`, password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('locks the account after repeated failures, even with the right password', async () => {
    const email = await registerVerified();
    for (let i = 0; i < 5; i++) {
      await request(ctx.app)
        .post('/api/v1/auth/login')
        .send({ companySlug: SLUG, email, password: 'bad-bad-bad-bad' })
        .expect(401);
    }
    await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ companySlug: SLUG, email, password: PASSWORD })
      .expect(401);
  });

  it('requires a CSRF token for authenticated unsafe requests', async () => {
    const email = await registerVerified();
    const login = await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ companySlug: SLUG, email, password: PASSWORD });
    const sid = cookieValue(login, 'sid');
    const csrf = cookieValue(login, 'csrf');
    const body = { currentPassword: PASSWORD, newPassword: 'another-long-password' };
    await request(ctx.app)
      .post('/api/v1/auth/change-password')
      .set('Cookie', `sid=${sid}; csrf=${csrf}`)
      .send(body)
      .expect(403);
    await request(ctx.app)
      .post('/api/v1/auth/change-password')
      .set('Cookie', `sid=${sid}; csrf=${csrf}`)
      .set('x-csrf-token', csrf ?? '')
      .send(body)
      .expect(200);
  });

  it('rejects cross-origin unsafe requests', async () => {
    await request(ctx.app)
      .post('/api/v1/auth/login')
      .set('origin', 'https://evil.example')
      .send({ companySlug: SLUG, email: 'a@b.co', password: 'x' })
      .expect(403);
  });

  it('completes password reset: generic request, single-use token, sessions revoked', async () => {
    const email = await registerVerified();
    const login = await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ companySlug: SLUG, email, password: PASSWORD });
    const sid = cookieValue(login, 'sid');

    const unknown = await request(ctx.app)
      .post('/api/v1/auth/forgot-password')
      .send({ companySlug: SLUG, email: `${uniq('nobody')}@example.test` });
    const known = await request(ctx.app)
      .post('/api/v1/auth/forgot-password')
      .send({ companySlug: SLUG, email });
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);

    const token = tokenFrom(ctx.mailer.last('password-reset')?.data.link);
    const newPassword = 'brand-new-long-password';
    await request(ctx.app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: newPassword })
      .expect(200);
    await request(ctx.app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'yet-another-password' })
      .expect(400);

    await request(ctx.app).get('/api/v1/auth/me').set('Cookie', `sid=${sid}`).expect(401);
    await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ companySlug: SLUG, email, password: PASSWORD })
      .expect(401);
    await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ companySlug: SLUG, email, password: newPassword })
      .expect(200);
    expect(ctx.mailer.last('password-changed')?.to).toBe(email);
  });

  it('stores only token hashes', async () => {
    const email = await registerVerified();
    const token = tokenFrom(ctx.mailer.last('verify-email')?.data.link);
    const rows = await db.oneTimeToken.findMany({ where: { user: { email } } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.tokenHash === token)).toBe(false);
  });

  it('logs out and invalidates the session', async () => {
    const email = await registerVerified();
    const login = await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ companySlug: SLUG, email, password: PASSWORD });
    const sid = cookieValue(login, 'sid');
    const csrf = cookieValue(login, 'csrf');
    await request(ctx.app)
      .post('/api/v1/auth/logout')
      .set('Cookie', `sid=${sid}; csrf=${csrf}`)
      .set('x-csrf-token', csrf ?? '')
      .expect(204);
    await request(ctx.app).get('/api/v1/auth/me').set('Cookie', `sid=${sid}`).expect(401);
  });

  describe('which sign-in page an account may use', () => {
    const otherCompany = async () => {
      const slug = uniq('other').toLowerCase();
      await withDb(db, { platform: true }, (tx) =>
        tx.tenant.create({ data: { name: 'Other Co', slug, status: 'ACTIVE' } }),
      );
      return slug;
    };
    const login = (email: string, slug?: string, password = PASSWORD) =>
      request(ctx.app)
        .post('/api/v1/auth/login')
        .send({ email, password, ...(slug ? { companySlug: slug } : {}) });

    it('registers only on a real, open company page, and signs in only on that page', async () => {
      const email = await registerVerified();
      await request(ctx.app)
        .post('/api/v1/auth/register')
        .send({
          companySlug: 'no-such-company',
          email: `${uniq('x')}@example.test`,
          password: PASSWORD,
          displayName: 'X',
        })
        .expect(404);
      await request(ctx.app)
        .post('/api/v1/auth/register')
        .send({ email: `${uniq('y')}@example.test`, password: PASSWORD, displayName: 'Y' })
        .expect(400); // a company page is required

      await login(email, SLUG).expect(200);
      // Not on the main page (platform administrators only), and not on another company page.
      const main = await login(email).expect(403);
      expect(main.body.error.code).toBe('WRONG_SIGN_IN_PAGE');
      const other = await login(email, await otherCompany()).expect(403);
      expect(other.body.error.code).toBe('WRONG_SIGN_IN_PAGE');
      // A wrong password still looks like any other wrong password, on any page.
      await login(email, await otherCompany(), 'wrong-wrong-wrong').expect(401);
    });

    it('lets platform administrators in on the main page only, and company staff on their own page', async () => {
      const email = await registerVerified();
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      await db.platformRoleAssignment.create({ data: { userId: user.id, role: 'SUPER_ADMIN' } });
      await login(email).expect(200);
      const denied = await login(email, SLUG).expect(403);
      expect(denied.body.error.code).toBe('WRONG_SIGN_IN_PAGE');

      const staff = await createTenantWithOwner(db, uniq('staffco'));
      const slug = staff.tenant.slug;
      await login(staff.email, slug, staff.password).expect(200);
      await login(staff.email, undefined, staff.password).expect(403);
      await login(staff.email, SLUG, staff.password).expect(403);
    });
  });
});
