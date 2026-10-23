import { randomBytes } from 'node:crypto';
import type { PaymentGateway } from '../src/modules/payment/gateway.js';
import type { FileStorage } from '../src/platform/storage.js';
import type { Express } from 'express';
import * as OTPAuth from 'otpauth';
import request from 'supertest';
import { TenantService } from '../src/modules/tenants/tenant.service.js';
import type {
  GoogleProfile,
  GoogleVerifier,
} from '../src/modules/authentication/google.service.js';
import { AppError } from '../src/platform/errors.js';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import type { Mailer, MailMessage } from '../src/modules/notifications/mailer.js';
import { createDb, withDb, type Db } from '../src/platform/db.js';
import { hashPassword } from '../src/platform/crypto.js';
import { createLogger } from '../src/platform/logger.js';

// The test database may be far away: give transactions longer than production's 15 s default.
process.env.DB_TX_TIMEOUT_MS ??= '60000';
export const TEST_DB_URL = process.env.TEST_DATABASE_URL;

export class CaptureMailer implements Mailer {
  sent: MailMessage[] = [];
  async send(msg: MailMessage) {
    this.sent.push(msg);
  }
  last(template: MailMessage['template']) {
    return [...this.sent].reverse().find((m) => m.template === template);
  }
}

/**
 * Stand-in for Google's token service (real ID tokens cannot be minted in tests).
 * The production verifier is google-auth-library; this only models its output contract.
 */
export class FakeGoogleVerifier implements GoogleVerifier {
  private readonly tokens = new Map<string, GoogleProfile>();
  issue(profile: GoogleProfile): string {
    const token = `fake-google-token-${randomBytes(12).toString('hex')}`;
    this.tokens.set(token, profile);
    return token;
  }
  async verify(idToken: string): Promise<GoogleProfile> {
    const p = this.tokens.get(idToken);
    if (!p) throw AppError.unauthenticated('Google sign-in could not be verified');
    return p;
  }
}

export function makeApp(
  db: Db,
  opts: { rateLimitScale?: number; paymentGateway?: PaymentGateway; storage?: FileStorage } = {},
) {
  const env = loadEnv({
    NODE_ENV: 'test',
    RATE_LIMIT_SCALE: String(opts.rateLimitScale ?? 1000),
    MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  });
  const mailer = new CaptureMailer();
  const google = new FakeGoogleVerifier();
  return {
    app: createApp({
      env,
      logger: createLogger(env),
      db,
      mailer,
      googleVerifier: google,
      ...(opts.paymentGateway ? { paymentGateway: opts.paymentGateway } : {}),
      ...(opts.storage ? { storage: opts.storage } : {}),
    }),
    mailer,
    google,
  };
}

let n = 0;
export const uniq = (p: string) => `${p}-${Date.now().toString(36)}-${++n}`;

export async function createTenantWithOwner(db: Db, label: string) {
  const slug = uniq(label);
  const user = await db.user.create({
    data: {
      email: `${slug}@example.test`,
      displayName: `${label} owner`,
      emailVerifiedAt: new Date(),
      passwordHash: await hashPassword('a-very-long-test-password'),
    },
  });
  const tenant = await withDb(db, { platform: true }, async (tx) => {
    const t = await tx.tenant.create({ data: { name: label, slug, status: 'ACTIVE' } });
    const ownerRoleId = await TenantService.seedRoles(tx, t.id);
    await tx.membership.create({
      data: { tenantId: t.id, userId: user.id, roleId: ownerRoleId, status: 'ACTIVE' },
    });
    return t;
  });
  return { tenant, user, email: user.email, password: 'a-very-long-test-password' };
}

export { createDb };

// --- HTTP client helpers ---------------------------------------------------------------------

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
export interface Client {
  email: string;
  userId: string;
  /** Authenticated request with session + CSRF headers already attached. */
  call: (method: Method, path: string) => request.Test;
}

const cookieOf = (res: request.Response, name: string) =>
  (res.headers['set-cookie'] as unknown as string[] | undefined)
    ?.find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0]
    ?.slice(name.length + 1) ?? '';

export async function loginClient(
  app: Express,
  db: Db,
  email: string,
  password: string,
): Promise<Client> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
  const sid = cookieOf(res, 'sid');
  const csrf = cookieOf(res, 'csrf');
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  return {
    email,
    userId: user.id,
    call: (method, path) => {
      const agent = request(app);
      const req = agent[method](`/api/v1${path}`);
      return req.set('Cookie', `sid=${sid}; csrf=${csrf}`).set('x-csrf-token', csrf);
    },
  };
}

/** Creates a verified password account directly in the database and signs in through the API. */
export async function newClient(
  app: Express,
  db: Db,
  label: string,
  password = 'a-very-long-test-password',
) {
  const email = `${uniq(label)}@example.test`;
  await db.user.create({
    data: {
      email,
      displayName: label,
      emailVerifiedAt: new Date(),
      passwordHash: await hashPassword(password),
    },
  });
  return { ...(await loginClient(app, db, email, password)), password };
}

/** Enrolls TOTP MFA through the API and returns the current secret. */
export async function enrollMfa(client: Client): Promise<string> {
  const enroll = await client.call('post', '/auth/mfa/enroll').send({}).expect(200);
  const secret = enroll.body.secret as string;
  const code = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    digits: 6,
    period: 30,
  }).generate();
  await client.call('post', '/auth/mfa/enroll/confirm').send({ code }).expect(200);
  return secret;
}
