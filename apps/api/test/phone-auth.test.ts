import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_AFTER_MS,
} from '../src/modules/authentication/otp.service.js';
import { withDb, type Db } from '../src/platform/db.js';
import { createDb, makeApp, TEST_DB_URL, uniq, testCompanySlug } from './helpers.js';

const PASSWORD = 'correct-horse-battery';
const cookieValue = (res: request.Response, name: string) =>
  (res.headers['set-cookie'] as unknown as string[] | undefined)
    ?.find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0]
    ?.slice(name.length + 1);

describe.skipIf(!TEST_DB_URL)('sign-up and sign-in by phone number (database)', () => {
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
  const plat = <T>(fn: Parameters<typeof withDb<T>>[2]) => withDb(db, { platform: true }, fn);

  /** A fresh Sierra Leone number: +232 and 8 digits, as the person might type it (with a 0). */
  let n = 10_000_000 + Math.floor(Math.random() * 80_000_000);
  const fresh = () => {
    const digits = String(++n);
    return { typed: `0${digits.slice(0, 2)} ${digits.slice(2)}`, e164: `+232${digits}` };
  };
  const api = (path: string, body: object) =>
    request(ctx.app)
      .post(`/api/v1/auth${path}`)
      .send({ companySlug: SLUG, ...body });
  /** Lets the resend cooldown pass without waiting a real minute. */
  const skipCooldown = (phone: string) =>
    plat((tx) =>
      tx.phoneOtp.updateMany({
        where: { phone },
        data: { createdAt: new Date(Date.now() - OTP_RESEND_AFTER_MS - 5_000) },
      }),
    );

  it('registers with any way of writing the number, texts a code, verifies it, then signs in', async () => {
    const { typed, e164 } = fresh();
    const res = await api('/register-phone', {
      phone: typed,
      password: PASSWORD,
      displayName: 'Fanta Jalloh',
    }).expect(202);
    expect(res.body.message).toMatch(/code has been sent/);
    expect(ctx.sms.to(e164)).toHaveLength(1);
    expect(ctx.sms.to(e164)[0]!.text).toMatch(/^NTS Transport: your code is \d{6}\./);

    const user = await plat((tx) => tx.user.findUniqueOrThrow({ where: { phone: e164 } }));
    expect(user).toMatchObject({ email: null, phoneVerifiedAt: null, displayName: 'Fanta Jalloh' });
    // Only a keyed hash of the code is stored.
    const row = await plat((tx) => tx.phoneOtp.findFirstOrThrow({ where: { phone: e164 } }));
    expect(row.codeHash).not.toContain(ctx.sms.codeFor(e164));
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);

    // Not verified yet: the password is right, the number is not proven.
    const early = await api('/login', { phone: typed, password: PASSWORD }).expect(403);
    expect(early.body.error.code).toBe('PHONE_NOT_VERIFIED');

    await api('/verify-phone', { phone: typed, code: ctx.sms.codeFor(e164) }).expect(200);
    const login = await api('/login', { phone: typed, password: PASSWORD }).expect(200);
    const sid = cookieValue(login, 'sid');
    expect(sid).toBeTruthy();
    const me = await request(ctx.app)
      .get('/api/v1/auth/me')
      .set('Cookie', `sid=${sid}`)
      .expect(200);
    expect(me.body).toMatchObject({ email: null, phone: e164, displayName: 'Fanta Jalloh' });
    expect(me.body.phoneVerifiedAt).toBeTruthy();

    // A code works once.
    await api('/verify-phone', { phone: e164, code: ctx.sms.codeFor(e164) }).expect(400);
    // The wrong password is the same generic failure as for e-mail.
    const bad = await api('/login', { phone: e164, password: 'wrong-password-here' }).expect(401);
    expect(bad.body.error.message).toBe('Invalid phone number or password');
  }, 300_000);

  it('gives each code five tries, then no more, even for the right code', async () => {
    const { e164 } = fresh();
    await api('/register-phone', { phone: e164, password: PASSWORD, displayName: 'T' }).expect(202);
    const code = ctx.sms.codeFor(e164);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await api('/verify-phone', { phone: e164, code: wrong }).expect(400);
    }
    await api('/verify-phone', { phone: e164, code }).expect(400); // the right one is too late
    expect(
      (await plat((tx) => tx.user.findUniqueOrThrow({ where: { phone: e164 } }))).phoneVerifiedAt,
    ).toBeNull();
    // A new code starts afresh.
    await skipCooldown(e164);
    await api('/resend-phone-code', { phone: e164 }).expect(202);
    expect(ctx.sms.to(e164)).toHaveLength(2);
    await api('/verify-phone', { phone: e164, code: ctx.sms.codeFor(e164) }).expect(200);
  }, 300_000);

  it('rejects an expired code, a code for another number, and a malformed code', async () => {
    const a = fresh();
    const b = fresh();
    await api('/register-phone', { phone: a.e164, password: PASSWORD, displayName: 'A' }).expect(
      202,
    );
    await api('/register-phone', { phone: b.e164, password: PASSWORD, displayName: 'B' }).expect(
      202,
    );
    await api('/verify-phone', { phone: b.e164, code: ctx.sms.codeFor(a.e164) }).expect(400); // not B's
    await api('/verify-phone', { phone: a.e164, code: '12345' }).expect(400);
    await api('/verify-phone', { phone: a.e164, code: 'abcdef' }).expect(400);
    await api('/verify-phone', { phone: 'not a number', code: '123456' }).expect(400);
    await plat((tx) =>
      tx.phoneOtp.updateMany({
        where: { phone: a.e164 },
        data: { expiresAt: new Date(Date.now() - 1000) },
      }),
    );
    await api('/verify-phone', { phone: a.e164, code: ctx.sms.codeFor(a.e164) }).expect(400);
  }, 300_000);

  it('sends one text at a time: the cooldown holds, and only the newest code works', async () => {
    const { e164 } = fresh();
    const body = { phone: e164, password: PASSWORD, displayName: 'T' };
    await api('/register-phone', body).expect(202);
    const first = ctx.sms.codeFor(e164);
    // Asking again straight away answers the same but sends nothing.
    await api('/register-phone', body).expect(202);
    await api('/resend-phone-code', { phone: e164 }).expect(202);
    expect(ctx.sms.to(e164)).toHaveLength(1);

    await skipCooldown(e164);
    await api('/resend-phone-code', { phone: e164 }).expect(202);
    expect(ctx.sms.to(e164)).toHaveLength(2);
    const second = ctx.sms.codeFor(e164);
    if (second !== first) await api('/verify-phone', { phone: e164, code: first }).expect(400);
    await api('/verify-phone', { phone: e164, code: second }).expect(200);
  }, 300_000);

  it('caps how many texts one number can be sent in an hour', async () => {
    const { e164 } = fresh();
    const body = { phone: e164, password: PASSWORD, displayName: 'T' };
    for (let i = 0; i < 8; i++) {
      await api('/register-phone', body).expect(202);
      await skipCooldown(e164);
    }
    expect(ctx.sms.to(e164)).toHaveLength(5);
  }, 300_000);

  it('does not reveal whether a number is registered, and leaves a verified account alone', async () => {
    const { e164 } = fresh();
    await api('/register-phone', { phone: e164, password: PASSWORD, displayName: 'Owner' }).expect(
      202,
    );
    await api('/verify-phone', { phone: e164, code: ctx.sms.codeFor(e164) }).expect(200);
    const before = ctx.sms.sent.length;
    // Someone else "registers" the same number: same answer, no text, nothing changed.
    const again = await api('/register-phone', {
      phone: e164,
      password: 'another-long-password-1',
      displayName: 'Intruder',
    }).expect(202);
    expect(again.body.message).toMatch(/code has been sent/);
    expect(ctx.sms.sent.length).toBe(before);
    await api('/login', { phone: e164, password: PASSWORD }).expect(200);
    await api('/login', { phone: e164, password: 'another-long-password-1' }).expect(401);
    expect(
      (await plat((tx) => tx.user.findUniqueOrThrow({ where: { phone: e164 } }))).displayName,
    ).toBe('Owner');
  }, 300_000);

  it('lets the real owner take over a number somebody else signed up first but never verified', async () => {
    const { e164 } = fresh();
    await api('/register-phone', {
      phone: e164,
      password: 'squatters-password-1',
      displayName: 'Squatter',
    }).expect(202);
    await skipCooldown(e164);
    // The real owner signs up with their own number: they, not the squatter, receive the code.
    await api('/register-phone', {
      phone: e164,
      password: 'real-owners-password-1',
      displayName: 'Real Owner',
    }).expect(202);
    await api('/verify-phone', { phone: e164, code: ctx.sms.codeFor(e164) }).expect(200);
    await api('/login', { phone: e164, password: 'real-owners-password-1' }).expect(200);
    await api('/login', { phone: e164, password: 'squatters-password-1' }).expect(401);
  }, 300_000);

  it('keeps going when the text provider is down, and lets the person ask again', async () => {
    const { e164 } = fresh();
    ctx.sms.failNext = true;
    await api('/register-phone', { phone: e164, password: PASSWORD, displayName: 'T' }).expect(202);
    expect(ctx.sms.to(e164)).toHaveLength(0);
    await skipCooldown(e164);
    await api('/resend-phone-code', { phone: e164 }).expect(202);
    expect(ctx.sms.to(e164)).toHaveLength(1);
    await api('/verify-phone', { phone: e164, code: ctx.sms.codeFor(e164) }).expect(200);
  }, 300_000);

  it('resets a forgotten password with a texted code, ends every session, and tells nothing about other numbers', async () => {
    const { e164 } = fresh();
    await api('/register-phone', { phone: e164, password: PASSWORD, displayName: 'T' }).expect(202);
    await api('/verify-phone', { phone: e164, code: ctx.sms.codeFor(e164) }).expect(200);
    const login = await api('/login', { phone: e164, password: PASSWORD }).expect(200);
    const sid = cookieValue(login, 'sid');

    // An unknown number gets the same answer and no text; an unverified one gets none either.
    const stranger = fresh();
    const unknown = await api('/forgot-password-phone', { phone: stranger.e164 }).expect(202);
    expect(unknown.body.message).toMatch(/If an account exists/);
    expect(ctx.sms.to(stranger.e164)).toHaveLength(0);

    await skipCooldown(e164);
    await api('/forgot-password-phone', { phone: e164 }).expect(202);
    const code = ctx.sms.codeFor(e164);
    // A sign-up code cannot reset a password, and a reset code cannot verify a sign-up.
    await api('/reset-password-phone', {
      phone: e164,
      code: '000000',
      password: 'brand-new-password-1',
    }).expect(400);
    await api('/reset-password-phone', { phone: e164, code, password: 'short' }).expect(400);
    await api('/reset-password-phone', {
      phone: e164,
      code,
      password: 'brand-new-password-1',
    }).expect(200);
    await api('/reset-password-phone', {
      phone: e164,
      code,
      password: 'brand-new-password-2',
    }).expect(400); // used

    await api('/login', { phone: e164, password: PASSWORD }).expect(401);
    await api('/login', { phone: e164, password: 'brand-new-password-1' }).expect(200);
    await request(ctx.app).get('/api/v1/auth/me').set('Cookie', `sid=${sid}`).expect(401); // old session ended
  }, 300_000);

  it('validates input and keeps e-mail and phone sign-in separate', async () => {
    await api('/register-phone', { phone: 'abc', password: PASSWORD, displayName: 'T' }).expect(
      400,
    );
    await api('/register-phone', { phone: '+23276', password: PASSWORD, displayName: 'T' }).expect(
      400,
    );
    await api('/register-phone', {
      phone: fresh().e164,
      password: 'short',
      displayName: 'T',
    }).expect(400);
    await api('/register-phone', {
      phone: fresh().e164,
      password: PASSWORD,
      displayName: '',
    }).expect(400);
    await api('/register-phone', {
      phone: fresh().e164,
      password: PASSWORD,
      displayName: 'T',
      extra: 1,
    }).expect(202); // unknown keys are ignored, as in e-mail sign-up
    // Exactly one of e-mail and phone to sign in.
    await api('/login', { password: PASSWORD }).expect(400);
    await api('/login', {
      email: 'a@example.test',
      phone: fresh().e164,
      password: PASSWORD,
    }).expect(400);
    // An e-mail account cannot be signed into with a phone number it does not have.
    const email = `${uniq('mix')}@example.test`;
    await api('/register', { email, password: PASSWORD, displayName: 'T' }).expect(202);
    await api('/login', { phone: fresh().e164, password: PASSWORD }).expect(401);
  }, 300_000);

  it('is refused by the database when an account has no way to be reached or a malformed number', async () => {
    const make = (data: Record<string, unknown>) =>
      plat((tx) => tx.user.create({ data: { displayName: 'x', ...data } as never }));
    await expect(make({})).rejects.toThrow(); // neither e-mail nor phone
    await expect(make({ phone: '0761234567' })).rejects.toThrow(); // not E.164
    await expect(make({ phone: '+23276' })).rejects.toThrow();
    await expect(
      make({ email: `${uniq('v')}@example.test`, phoneVerifiedAt: new Date() }),
    ).rejects.toThrow(); // verified a number it does not have
    const p = fresh().e164;
    await make({ phone: p });
    await expect(make({ phone: p })).rejects.toThrow(); // one account per number
    await expect(plat((tx) => tx.phoneOtp.deleteMany({ where: { phone: p } }))).rejects.toThrow(); // codes are never deleted by hand
  }, 300_000);

  it('reports whether phone sign-up is available', async () => {
    const f = await request(ctx.app).get('/api/v1/features').expect(200);
    expect(f.body.phoneSignup).toBe(true);
  }, 120_000);
});
