import * as OTPAuth from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/platform/db.js';
import { createDb, makeApp, TEST_DB_URL, uniq, testCompanySlug } from './helpers.js';

const PASSWORD = 'correct-horse-battery';
type Res = request.Response;
const cookie = (res: Res, name: string) =>
  (res.headers['set-cookie'] as unknown as string[] | undefined)
    ?.find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0]
    ?.slice(name.length + 1);
const tokenFrom = (link?: string) => new URL(link ?? 'http://x').searchParams.get('token') ?? '';

/** A valid TOTP code for the step `stepOffset` periods from now (±1 is accepted by the server). */
const totpCode = (secret: string, stepOffset = 0) =>
  new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 }).generate({
    timestamp: Date.now() + stepOffset * 30_000,
  });

describe.skipIf(!TEST_DB_URL)('MFA and Google sign-in (database)', () => {
  let db: Db;
  let SLUG = '';
  let ctx: ReturnType<typeof makeApp>;
  const api = () => request(ctx.app);

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

  async function signedInUser() {
    const email = `${uniq('m')}@example.test`;
    await api()
      .post('/api/v1/auth/register')
      .send({ companySlug: SLUG, email, password: PASSWORD, displayName: 'M' })
      .expect(202);
    await api()
      .post('/api/v1/auth/verify-email')
      .send({ token: tokenFrom(ctx.mailer.last('verify-email')?.data.link) })
      .expect(200);
    const login = await api()
      .post('/api/v1/auth/login')
      .send({ companySlug: SLUG, email, password: PASSWORD })
      .expect(200);
    const sid = cookie(login, 'sid') ?? '';
    const csrf = cookie(login, 'csrf') ?? '';
    const authed = (method: 'post' | 'get' | 'delete', path: string) => {
      const agent = api();
      const req = agent[method](`/api/v1/auth${path}`);
      return req.set('Cookie', `sid=${sid}; csrf=${csrf}`).set('x-csrf-token', csrf);
    };
    return { email, authed };
  }

  async function enrolledUser() {
    const u = await signedInUser();
    const enroll = await u.authed('post', '/mfa/enroll').send({}).expect(200);
    const secret = enroll.body.secret as string;
    expect(enroll.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const confirm = await u
      .authed('post', '/mfa/enroll/confirm')
      .send({ code: totpCode(secret) })
      .expect(200);
    return { ...u, secret, recoveryCodes: confirm.body.recoveryCodes as string[] };
  }

  describe('TOTP MFA', () => {
    it('enrolls, issues 10 recovery codes once, and stores the seed encrypted', async () => {
      const u = await enrolledUser();
      expect(u.recoveryCodes).toHaveLength(10);
      const stored = await db.mfaCredential.findFirstOrThrow({
        where: { user: { email: u.email } },
      });
      expect(stored.secretEnc.startsWith('v1.')).toBe(true);
      expect(stored.secretEnc).not.toContain(u.secret);
      const codes = await db.recoveryCode.findMany({ where: { user: { email: u.email } } });
      expect(codes.some((c) => u.recoveryCodes.some((p) => c.codeHash === p))).toBe(false); // hashed
      const me = await u.authed('get', '/me').expect(200);
      expect(me.body.mfaEnabled).toBe(true);
    });

    it('rejects an invalid confirmation code and leaves MFA off', async () => {
      const u = await signedInUser();
      await u.authed('post', '/mfa/enroll').send({}).expect(200);
      await u.authed('post', '/mfa/enroll/confirm').send({ code: '000000' }).expect(400);
      expect((await u.authed('get', '/me')).body.mfaEnabled).toBe(false);
    });

    it('requires a second factor at login and then issues a session', async () => {
      const u = await enrolledUser();
      const step1 = await api()
        .post('/api/v1/auth/login')
        .send({ companySlug: SLUG, email: u.email, password: PASSWORD })
        .expect(200);
      expect(step1.body.mfaRequired).toBe(true);
      expect(cookie(step1, 'sid')).toBeUndefined();
      // Next time-step: valid (within drift window) and not the one consumed during enrollment.
      const step2 = await api()
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken: step1.body.challengeToken, code: totpCode(u.secret, 1) })
        .expect(200);
      const sid = cookie(step2, 'sid');
      expect(sid).toBeTruthy();
      await api().get('/api/v1/auth/me').set('Cookie', `sid=${sid}`).expect(200);
    });

    it('rejects replay of an already-used code and a reused challenge', async () => {
      const u = await enrolledUser();
      const code = totpCode(u.secret, 1);
      const c1 = await api()
        .post('/api/v1/auth/login')
        .send({ companySlug: SLUG, email: u.email, password: PASSWORD });
      await api()
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken: c1.body.challengeToken, code })
        .expect(200);
      await api()
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken: c1.body.challengeToken, code })
        .expect(401);
      const c2 = await api()
        .post('/api/v1/auth/login')
        .send({ companySlug: SLUG, email: u.email, password: PASSWORD });
      await api()
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken: c2.body.challengeToken, code })
        .expect(401);
    });

    it('limits attempts per challenge', async () => {
      const u = await enrolledUser();
      const c = await api()
        .post('/api/v1/auth/login')
        .send({ companySlug: SLUG, email: u.email, password: PASSWORD });
      for (let i = 0; i < 5; i++) {
        await api()
          .post('/api/v1/auth/mfa/verify')
          .send({ challengeToken: c.body.challengeToken, code: '123456' })
          .expect(401);
      }
      // Even a correct code is refused once attempts are exhausted.
      await api()
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken: c.body.challengeToken, code: totpCode(u.secret, 1) })
        .expect(401);
    });

    it('accepts a recovery code exactly once', async () => {
      const u = await enrolledUser();
      const recovery = u.recoveryCodes[0] as string;
      const c1 = await api()
        .post('/api/v1/auth/login')
        .send({ companySlug: SLUG, email: u.email, password: PASSWORD });
      await api()
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken: c1.body.challengeToken, recoveryCode: recovery })
        .expect(200);
      const c2 = await api()
        .post('/api/v1/auth/login')
        .send({ companySlug: SLUG, email: u.email, password: PASSWORD });
      await api()
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken: c2.body.challengeToken, recoveryCode: recovery })
        .expect(401);
    });

    it('does not give a session on password alone, and an unknown challenge fails generically', async () => {
      await api()
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken: 'x'.repeat(43), code: '123456' })
        .expect(401);
    });

    it('requires password and code to disable', async () => {
      const u = await enrolledUser();
      await u
        .authed('post', '/mfa/disable')
        .send({ code: totpCode(u.secret, 1), password: 'wrong-password-123' })
        .expect(403);
      await u
        .authed('post', '/mfa/disable')
        .send({ code: totpCode(u.secret, 1), password: PASSWORD })
        .expect(204);
      expect((await u.authed('get', '/me')).body.mfaEnabled).toBe(false);
    });

    it('forbids platform administrators from disabling MFA', async () => {
      const u = await enrolledUser();
      const user = await db.user.findUniqueOrThrow({ where: { email: u.email } });
      await db.platformRoleAssignment.create({ data: { userId: user.id, role: 'SUPPORT' } });
      await u
        .authed('post', '/mfa/disable')
        .send({ code: totpCode(u.secret, 1), password: PASSWORD })
        .expect(403);
      expect((await u.authed('get', '/me')).body.mfaEnabled).toBe(true);
    });

    it('requires the CSRF token for enrollment', async () => {
      const u = await signedInUser();
      const login = await api()
        .post('/api/v1/auth/login')
        .send({ companySlug: SLUG, email: u.email, password: PASSWORD });
      await api()
        .post('/api/v1/auth/mfa/enroll')
        .set('Cookie', `sid=${cookie(login, 'sid')}`)
        .send({})
        .expect(403);
    });
  });

  describe('Google sign-in', () => {
    const profile = (
      over: Partial<{ sub: string; email: string; emailVerified: boolean }> = {},
    ) => ({
      sub: `g-${uniq('sub')}`,
      email: `${uniq('g')}@example.test`,
      emailVerified: true,
      name: 'Gina Google',
      ...over,
    });

    it('creates a verified, password-less account and signs in; no tenant access is implied', async () => {
      const p = profile();
      const res = await api()
        .post('/api/v1/auth/google')
        .send({ companySlug: SLUG, credential: ctx.google.issue(p) })
        .expect(200);
      const sid = cookie(res, 'sid');
      expect(sid).toBeTruthy();
      const user = await db.user.findUniqueOrThrow({
        where: { email: p.email },
        include: { memberships: true },
      });
      expect(user.passwordHash).toBeNull();
      expect(user.emailVerifiedAt).not.toBeNull();
      expect(user.memberships).toHaveLength(0);
      // Signing in again resolves via the stable subject.
      await api()
        .post('/api/v1/auth/google')
        .send({ companySlug: SLUG, credential: ctx.google.issue(p) })
        .expect(200);
      expect(await db.user.count({ where: { email: p.email } })).toBe(1);
    });

    it('rejects tokens that did not come from Google verification', async () => {
      await api()
        .post('/api/v1/auth/google')
        .send({ companySlug: SLUG, credential: 'forged-profile-'.padEnd(40, 'x') })
        .expect(401);
    });

    it('rejects an unverified Google email', async () => {
      const p = profile({ emailVerified: false });
      await api()
        .post('/api/v1/auth/google')
        .send({ companySlug: SLUG, credential: ctx.google.issue(p) })
        .expect(401);
      expect(await db.user.count({ where: { email: p.email } })).toBe(0);
    });

    it('signs in to an existing confirmed account with the same email and remembers Google', async () => {
      const u = await signedInUser();
      const p = profile({ email: u.email });
      const res = await api()
        .post('/api/v1/auth/google')
        .send({ companySlug: SLUG, credential: ctx.google.issue(p) })
        .expect(200);
      expect(cookie(res, 'sid')).toBeTruthy();
      expect(await db.authIdentity.count({ where: { subject: p.sub } })).toBe(1);
      // The next time it is the Google account that is recognised.
      await api()
        .post('/api/v1/auth/google')
        .send({ companySlug: SLUG, credential: ctx.google.issue(p) })
        .expect(200);
    });

    it('keeps Google to the right sign-in page', async () => {
      const u = await signedInUser();
      const p = profile({ email: u.email });
      // An ordinary account is not let in on the main (platform administrator) page.
      const main = await api()
        .post('/api/v1/auth/google')
        .send({ credential: ctx.google.issue(p) })
        .expect(403);
      expect(main.body.error.code).toBe('WRONG_SIGN_IN_PAGE');
      expect(await db.authIdentity.count({ where: { subject: p.sub } })).toBe(0);
      // A new account cannot be created on the main page either.
      await api()
        .post('/api/v1/auth/google')
        .send({ credential: ctx.google.issue(profile()) })
        .expect(403);
      // A platform administrator signs in with Google on the main page.
      const admin = await signedInUser();
      const adminRow = await db.user.findUniqueOrThrow({ where: { email: admin.email } });
      await db.platformRoleAssignment.create({
        data: { userId: adminRow.id, role: 'SUPER_ADMIN' },
      });
      await api()
        .post('/api/v1/auth/google')
        .send({ credential: ctx.google.issue(profile({ email: admin.email })) })
        .expect(200);
    });

    it('takes over an unverified password account and removes the squatter password', async () => {
      const email = `${uniq('squat')}@example.test`;
      await api()
        .post('/api/v1/auth/register')
        .send({ companySlug: SLUG, email, password: PASSWORD, displayName: 'Squatter' })
        .expect(202);
      const p = profile({ email });
      await api()
        .post('/api/v1/auth/google')
        .send({ companySlug: SLUG, credential: ctx.google.issue(p) })
        .expect(200);
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      expect(user.passwordHash).toBeNull();
      await api()
        .post('/api/v1/auth/login')
        .send({ companySlug: SLUG, email, password: PASSWORD })
        .expect(401);
    });

    it('requires MFA after Google sign-in when the account has it', async () => {
      const u = await enrolledUser();
      const p = profile({ email: u.email });
      const res = await api()
        .post('/api/v1/auth/google')
        .send({ companySlug: SLUG, credential: ctx.google.issue(p) })
        .expect(200);
      expect(res.body.mfaRequired).toBe(true);
      expect(cookie(res, 'sid')).toBeUndefined();
    });
  });

  describe('session management', () => {
    it('lists own sessions, flags the current one, and revokes another by id', async () => {
      const u = await signedInUser();
      const other = await api()
        .post('/api/v1/auth/login')
        .send({ companySlug: SLUG, email: u.email, password: PASSWORD });
      const otherSid = cookie(other, 'sid');
      const list = await u.authed('get', '/sessions').expect(200);
      expect(list.body.sessions.length).toBeGreaterThanOrEqual(2);
      expect(list.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
      expect(JSON.stringify(list.body)).not.toContain('refreshTokenHash');
      const target = list.body.sessions.find((s: { current: boolean }) => !s.current);
      await u.authed('delete', `/sessions/${target.id}`).expect(204);
      await api().get('/api/v1/auth/me').set('Cookie', `sid=${otherSid}`).expect(401);
    });

    it("cannot revoke another user's session", async () => {
      const a = await signedInUser();
      const b = await signedInUser();
      const bSessions = await b.authed('get', '/sessions').expect(200);
      await a.authed('delete', `/sessions/${bSessions.body.sessions[0].id}`).expect(404);
      await b.authed('get', '/me').expect(200);
    });
  });
});
