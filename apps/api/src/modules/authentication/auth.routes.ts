import express, { type Request, type Response } from 'express';
import type { Router as ExpressRouter } from 'express';
import { Router } from '../../platform/router.js';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import { withDb, type Db } from '../../platform/db.js';
import type { RateLimitStoreFactory } from '../../platform/redis.js';
import { AppError } from '../../platform/errors.js';
import { IMAGE_TYPES, MAX_AVATAR_BYTES } from '../branding/branding.service.js';
import {
  changePasswordSchema,
  forgotSchema,
  loginSchema,
  phoneCodeSchema,
  phoneOnlySchema,
  companySlugSchema,
  emailCodeSchema,
  emailOnlySchema,
  profileSchema,
  registerPhoneSchema,
  registerSchema,
  resetPhoneSchema,
  resetSchema,
  tokenSchema,
} from './auth.schemas.js';
import type { AuthService, LoginResult } from './auth.service.js';
import type { GoogleAuthService } from './google.service.js';
import type { MfaService } from './mfa.service.js';
import { clearSessionCookies, requireAuth, setSessionCookies } from './session.middleware.js';

const makeLimiter =
  (scale: number, stores?: RateLimitStoreFactory) =>
  (name: string, max: number, windowMs = 15 * 60_000) =>
    rateLimit({
      windowMs,
      limit: max * scale,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      // Shared counters when Redis is configured (so limits hold across instances).
      ...(stores ? { store: stores(`auth:${name}`) } : {}),
      // If the store is unreachable, keep serving: password lockout in the database remains the
      // second line of defence, and an auth outage would be worse than a brief limiter gap.
      passOnStoreError: true,
      handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests')),
    });

const mfaCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code');
const mfaVerifySchema = z
  .object({
    challengeToken: z.string().min(20).max(200),
    code: mfaCode.optional(),
    recoveryCode: z.string().trim().min(8).max(40).optional(),
  })
  .refine((v) => (v.code === undefined) !== (v.recoveryCode === undefined), {
    message: 'Provide either a code or a recovery code',
  });
const credentialSchema = z.object({
  credential: z.string().min(20).max(4096),
  /** The company page the button is on; absent on the main page. */
  companySlug: companySlugSchema.optional(),
});
const disableMfaSchema = z.object({ code: mfaCode, password: z.string().max(128).optional() });
const codeOnlySchema = z.object({ code: mfaCode });

export interface AuthRouterDeps {
  auth: AuthService;
  db: Db;
  env: Pick<Env, 'NODE_ENV' | 'RATE_LIMIT_SCALE'>;
  mfa?: MfaService | undefined;
  google?: GoogleAuthService | undefined;
  /** Sign-up and sign-in by phone number (needs a way to send texts). */
  phone?: boolean | undefined;
  rateLimitStores?: RateLimitStoreFactory | undefined;
}

// Counters are in memory (per instance) unless a Redis store factory is supplied.
export function authRouter({
  auth,
  db,
  env,
  mfa,
  google,
  phone,
  rateLimitStores,
}: AuthRouterDeps): ExpressRouter {
  const r = Router();
  const limiter = makeLimiter(env.RATE_LIMIT_SCALE, rateLimitStores);
  const meta = (req: Request) => ({ requestId: req.id, userAgent: req.header('user-agent') });
  const me = (req: Request) => {
    if (!req.auth) throw AppError.unauthenticated();
    return req.auth;
  };
  const respondLogin = (res: Response, result: LoginResult) => {
    if (result.kind === 'mfa') {
      res.json({ mfaRequired: true, challengeToken: result.challengeToken });
      return;
    }
    setSessionCookies(res, env, result.sessionToken);
    res.json({ userId: result.userId });
  };

  r.post('/register', limiter('register', 10), async (req, res) => {
    await auth.register(registerSchema.parse(req.body), meta(req));
    res
      .status(202)
      .json({ message: 'If the address can be registered, a verification email has been sent.' });
  });

  r.post('/verify-email', limiter('verify-email', 20), async (req, res) => {
    await auth.verifyEmail(tokenSchema.parse(req.body).token, meta(req));
    res.json({ message: 'Email verified' });
  });

  r.post('/verify-email-code', limiter('verify-email-code', 20), async (req, res) => {
    const body = emailCodeSchema.parse(req.body);
    await auth.verifyEmailCode(body.email, body.code, meta(req));
    res.json({ message: 'Email verified' });
  });
  r.post(
    '/resend-email-code',
    limiter('resend-email-code', 10),
    limiter('email-codes', 10, 60 * 60_000),
    async (req, res) => {
      await auth.resendEmailCode(emailOnlySchema.parse(req.body).email, meta(req));
      res
        .status(202)
        .json({ message: 'If the address is waiting to be confirmed, a code has been sent.' });
    },
  );

  if (phone) {
    // One shared hourly cap per address on everything that sends a text, so nobody can use the
    // sign-up forms to send a flood of messages (each number is also capped in the database).
    const sendsText = limiter('sms', 10, 60 * 60_000);
    r.post('/register-phone', limiter('register-phone', 10), sendsText, async (req, res) => {
      await auth.registerPhone(registerPhoneSchema.parse(req.body), meta(req));
      res.status(202).json({ message: 'If the number can be registered, a code has been sent.' });
    });
    r.post('/verify-phone', limiter('verify-phone', 20), async (req, res) => {
      const body = phoneCodeSchema.parse(req.body);
      await auth.verifyPhone(body.phone, body.code, meta(req));
      res.json({ message: 'Phone number verified' });
    });
    r.post('/resend-phone-code', limiter('resend-phone', 10), sendsText, async (req, res) => {
      await auth.resendPhoneCode(phoneOnlySchema.parse(req.body).phone, meta(req));
      res
        .status(202)
        .json({ message: 'If the number is waiting to be verified, a code has been sent.' });
    });
    r.post('/forgot-password-phone', limiter('forgot-phone', 5), sendsText, async (req, res) => {
      await auth.forgotPasswordPhone(phoneOnlySchema.parse(req.body).phone, meta(req));
      res.status(202).json({ message: 'If an account exists, a code has been sent.' });
    });
    r.post('/reset-password-phone', limiter('reset-phone', 10), async (req, res) => {
      const body = resetPhoneSchema.parse(req.body);
      await auth.resetPasswordPhone(body.phone, body.code, body.password, meta(req));
      clearSessionCookies(res, env);
      res.json({ message: 'Password updated. Please sign in.' });
    });
  }

  r.post('/login', limiter('login', 20), async (req, res) => {
    respondLogin(res, await auth.login(loginSchema.parse(req.body), meta(req)));
  });

  r.post('/mfa/verify', limiter('mfa-verify', 20), async (req, res) => {
    const body = mfaVerifySchema.parse(req.body);
    const session = await auth.completeMfaLogin(
      body.challengeToken,
      { code: body.code, recoveryCode: body.recoveryCode },
      meta(req),
    );
    setSessionCookies(res, env, session.sessionToken);
    res.json({ userId: session.userId });
  });

  if (google) {
    r.post('/google', limiter('google', 20), async (req, res) => {
      respondLogin(
        res,
        await google.signIn(
          credentialSchema.parse(req.body).credential,
          meta(req),
          credentialSchema.parse(req.body).companySlug,
        ),
      );
    });
  }

  r.post('/logout', async (req, res) => {
    if (req.auth) await auth.logout(req.auth.sessionToken);
    clearSessionCookies(res, env);
    res.status(204).end();
  });

  r.post('/forgot-password', limiter('forgot-password', 5), async (req, res) => {
    await auth.forgotPassword(forgotSchema.parse(req.body).email, meta(req));
    res.status(202).json({ message: 'If an account exists, a reset email has been sent.' });
  });

  r.post('/reset-password', limiter('reset-password', 10), async (req, res) => {
    const body = resetSchema.parse(req.body);
    await auth.resetPassword(body.token, body.password, meta(req));
    clearSessionCookies(res, env);
    res.json({ message: 'Password updated. Please sign in.' });
  });

  r.post('/change-password', requireAuth, limiter('change-password', 10), async (req, res) => {
    const a = me(req);
    const body = changePasswordSchema.parse(req.body);
    await auth.changePassword(
      a.userId,
      body.currentPassword,
      body.newPassword,
      a.sessionToken,
      meta(req),
    );
    res.json({ message: 'Password changed' });
  });

  r.patch('/me', requireAuth, limiter('profile', 30), async (req, res) => {
    await auth.updateProfile(me(req).userId, profileSchema.parse(req.body).displayName, meta(req));
    res.status(204).end();
  });
  r.put(
    '/me/avatar',
    requireAuth,
    limiter('avatar', 20),
    express.raw({ type: [...IMAGE_TYPES], limit: MAX_AVATAR_BYTES + 1000 }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body)) throw AppError.validation('Send a PNG, JPEG or WebP picture');
      await auth.setAvatar(me(req).userId, req.body, meta(req));
      res.status(204).end();
    },
  );
  r.delete('/me/avatar', requireAuth, async (req, res) => {
    await auth.clearAvatar(me(req).userId);
    res.status(204).end();
  });
  r.get('/me/avatar', requireAuth, async (req, res) => {
    const a = await auth.getAvatar(me(req).userId);
    if (!a) throw AppError.notFound('No profile picture');
    res.setHeader('Content-Type', a.type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(a.data);
  });

  r.get('/me', requireAuth, async (req, res) => {
    const user = await db.user.findUniqueOrThrow({
      where: { id: me(req).userId },
      select: {
        id: true,
        email: true,
        phone: true,
        displayName: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        mfaEnabled: true,
        mustChangePassword: true,
        homeTenantId: true,
        avatar: { select: { updatedAt: true } },
        identities: { select: { provider: true } },
        platformRoles: { select: { role: true } },
      },
    });
    const { platformRoles, avatar, homeTenantId, ...rest } = user;
    const homeCompany = homeTenantId
      ? await withDb(db, { platform: true }, (tx) =>
          tx.tenant.findUnique({
            where: { id: homeTenantId },
            select: { id: true, name: true, slug: true },
          }),
        )
      : null;
    res.json({
      ...rest,
      homeCompany,
      avatarVersion: avatar ? avatar.updatedAt.getTime() : null,
      platformRoles: platformRoles.map((r) => r.role),
    });
  });

  r.get('/sessions', requireAuth, async (req, res) => {
    const a = me(req);
    res.json({ sessions: await auth.listSessions(a.userId, a.sessionToken) });
  });

  r.delete('/sessions/:id', requireAuth, async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) throw AppError.notFound('Session not found');
    await auth.revokeSession(me(req).userId, id.data);
    res.status(204).end();
  });

  if (mfa) {
    r.post('/mfa/enroll', requireAuth, limiter('mfa-enroll', 10), async (req, res) => {
      res.json(await mfa.beginEnrollment(me(req).userId));
    });
    r.post(
      '/mfa/enroll/confirm',
      requireAuth,
      limiter('mfa-enroll-confirm', 10),
      async (req, res) => {
        const { code } = codeOnlySchema.parse(req.body);
        res.json(await mfa.confirmEnrollment(me(req).userId, code, req.id));
      },
    );
    r.post(
      '/mfa/recovery-codes',
      requireAuth,
      limiter('mfa-recovery-codes', 5),
      async (req, res) => {
        const { code } = codeOnlySchema.parse(req.body);
        res.json(await mfa.regenerateRecoveryCodes(me(req).userId, code, req.id));
      },
    );
    r.post('/mfa/disable', requireAuth, limiter('mfa-disable', 5), async (req, res) => {
      const body = disableMfaSchema.parse(req.body);
      await mfa.disable(me(req).userId, body, req.id);
      res.status(204).end();
    });
  }

  return r;
}

/** Exposed so the OpenAPI document is generated from the exact schemas used for validation. */
export const requestSchemas = {
  profileSchema,
  emailCodeSchema,
  emailOnlySchema,
  registerPhoneSchema,
  phoneOnlySchema,
  phoneCodeSchema,
  resetPhoneSchema,
  mfaVerifySchema,
  credentialSchema,
  disableMfaSchema,
  codeOnlySchema,
};
