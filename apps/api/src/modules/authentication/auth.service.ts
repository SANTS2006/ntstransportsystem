import { randomUUID } from 'node:crypto';
import { generateToken, hashPassword, hashToken, verifyPassword } from '../../platform/crypto.js';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../audit/audit.js';
import { checkImage, MAX_AVATAR_BYTES } from '../branding/branding.service.js';
import type { Mailer } from '../notifications/mailer.js';
import type { MfaService } from './mfa.service.js';
import type { OtpService } from './otp.service.js';

const SESSION_TTL_MS = 30 * 24 * 3600_000;
const ROTATE_AFTER_MS = 15 * 60_000;
const ROTATION_GRACE_MS = 10_000;
const VERIFY_TTL_MS = 24 * 3600_000;
const RESET_TTL_MS = 30 * 60_000;
const MAX_FAILED = 5;

// Verified against when the account does not exist, to equalize response timing.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(generateToken()));

export interface SessionResult {
  userId: string;
  sessionToken: string;
}

/** Credentials passed: either a session, or a second factor is still required. */
export type LoginResult =
  ({ kind: 'session' } & SessionResult) | { kind: 'mfa'; challengeToken: string };

const MFA_CHALLENGE_TTL_MS = 5 * 60_000;
const MFA_MAX_ATTEMPTS = 5;

export interface ReqMeta {
  requestId?: string | undefined;
  userAgent?: string | undefined;
}

const lockDelayMs = (fails: number) =>
  Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, fails - MAX_FAILED));

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly mailer: Mailer,
    private readonly appUrl: string,
    private readonly mfa?: MfaService,
    private readonly now: () => Date = () => new Date(),
    /** Present when sign-up and sign-in by phone number are available. */
    private readonly otp?: OtpService,
    /** Sends and checks the codes that confirm an e-mail address (needs no text-message provider). */
    private readonly emailCodes?: OtpService,
  ) {}

  private async issueToken(
    userId: string,
    purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET' | 'MFA_CHALLENGE',
    ttlMs: number,
  ) {
    const token = generateToken();
    await this.db.oneTimeToken.create({
      data: {
        userId,
        purpose,
        tokenHash: hashToken(token),
        expiresAt: new Date(this.now().getTime() + ttlMs),
      },
    });
    return token;
  }

  /** Resolves identically whether or not the email is already registered. */
  async register(input: { email: string; password: string; displayName: string }, meta: ReqMeta) {
    const existing = await this.db.user.findUnique({ where: { email: input.email } });
    if (existing) {
      await writeAudit(this.db, {
        action: 'auth.register',
        outcome: 'FAILURE',
        requestId: meta.requestId,
        summary: { reason: 'exists' },
      });
      return;
    }
    const user = await this.db.user.create({
      data: {
        email: input.email,
        displayName: input.displayName,
        passwordHash: await hashPassword(input.password),
      },
    });
    await this.sendEmailCode(user.id, input.email);
    await writeAudit(this.db, {
      action: 'auth.register',
      outcome: 'SUCCESS',
      actorUserId: user.id,
      requestId: meta.requestId,
    });
  }

  /** Mails the code (and the older confirmation link) that proves an address is the person's own. */
  private async sendEmailCode(userId: string, email: string) {
    const token = await this.issueToken(userId, 'EMAIL_VERIFY', VERIFY_TTL_MS);
    const link = `${this.appUrl}/verify-email?token=${token}`;
    if (!this.emailCodes) {
      await this.mailer.send({ to: email, template: 'verify-email', data: { link } });
      return;
    }
    await this.emailCodes.issue(email, 'EMAIL_VERIFY', userId, (code) =>
      this.mailer.send({ to: email, template: 'verify-email', data: { link, code } }),
    );
  }

  /** Checks the code from the e-mail and marks the address as confirmed. */
  async verifyEmailCode(email: string, code: string, meta: ReqMeta) {
    const r = this.emailCodes ? await this.emailCodes.verify(email, 'EMAIL_VERIFY', code) : null;
    if (!r?.ok || !r.userId) {
      await writeAudit(this.db, {
        action: 'auth.email_code_verify',
        outcome: 'FAILURE',
        requestId: meta.requestId,
      });
      throw AppError.validation('That code is not right, or it has expired');
    }
    await this.db.user.update({ where: { id: r.userId }, data: { emailVerifiedAt: this.now() } });
    await writeAudit(this.db, {
      action: 'auth.email_verified',
      outcome: 'SUCCESS',
      actorUserId: r.userId,
      requestId: meta.requestId,
    });
  }

  /** Mails another code to an address that signed up and is not confirmed. Never says if it did. */
  async resendEmailCode(email: string, meta: ReqMeta) {
    const user = await this.db.user.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt && user.status === 'ACTIVE') {
      await this.sendEmailCode(user.id, email);
    }
    await writeAudit(this.db, {
      action: 'auth.email_code_resent',
      outcome: 'SUCCESS',
      requestId: meta.requestId,
    });
  }

  private async consumeToken(token: string, purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET') {
    const tokenHash = hashToken(token);
    // Atomic single use: only one concurrent caller can flip usedAt from null.
    const res = await this.db.oneTimeToken.updateMany({
      where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: this.now() } },
      data: { usedAt: this.now() },
    });
    if (res.count !== 1) throw AppError.validation('This link is invalid or has expired');
    const row = await this.db.oneTimeToken.findUniqueOrThrow({ where: { tokenHash } });
    return row.userId;
  }

  async verifyEmail(token: string, meta: ReqMeta) {
    const userId = await this.consumeToken(token, 'EMAIL_VERIFY');
    await this.db.user.update({ where: { id: userId }, data: { emailVerifiedAt: this.now() } });
    await writeAudit(this.db, {
      action: 'auth.email_verified',
      outcome: 'SUCCESS',
      actorUserId: userId,
      requestId: meta.requestId,
    });
  }

  private async createSession(
    userId: string,
    meta: ReqMeta,
    familyId: string = randomUUID(),
  ): Promise<SessionResult> {
    const sessionToken = generateToken();
    await this.db.session.create({
      data: {
        userId,
        familyId,
        refreshTokenHash: hashToken(sessionToken),
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        expiresAt: new Date(this.now().getTime() + SESSION_TTL_MS),
      },
    });
    return { userId, sessionToken };
  }

  async login(
    input: { email?: string | undefined; phone?: string | undefined; password: string },
    meta: ReqMeta,
  ): Promise<LoginResult> {
    const byPhone = input.phone !== undefined;
    const genericFailure = () =>
      AppError.unauthenticated(
        byPhone ? 'Invalid phone number or password' : 'Invalid email or password',
      );
    const user = byPhone
      ? await this.db.user.findUnique({ where: { phone: input.phone as string } })
      : await this.db.user.findUnique({ where: { email: input.email as string } });
    const now = this.now();

    if (!user?.passwordHash) {
      await verifyPassword(await getDummyHash(), input.password);
      await writeAudit(this.db, {
        action: 'auth.login',
        outcome: 'FAILURE',
        requestId: meta.requestId,
        summary: { reason: 'unknown' },
      });
      throw genericFailure();
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      await writeAudit(this.db, {
        action: 'auth.login',
        outcome: 'DENIED',
        actorUserId: user.id,
        requestId: meta.requestId,
        summary: { reason: 'locked' },
      });
      throw genericFailure();
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      const fails = user.failedLoginCount + 1;
      await this.db.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: fails,
          lockedUntil: fails >= MAX_FAILED ? new Date(now.getTime() + lockDelayMs(fails)) : null,
        },
      });
      await writeAudit(this.db, {
        action: 'auth.login',
        outcome: 'FAILURE',
        actorUserId: user.id,
        requestId: meta.requestId,
        summary: { reason: 'bad_password', fails },
      });
      throw genericFailure();
    }
    // Only a caller who proved the password learns the account state.
    const verified = byPhone ? user.phoneVerifiedAt : user.emailVerifiedAt;
    if (user.status !== 'ACTIVE' || !verified) {
      const inactive = user.status !== 'ACTIVE';
      await writeAudit(this.db, {
        action: 'auth.login',
        outcome: 'DENIED',
        actorUserId: user.id,
        requestId: meta.requestId,
        summary: { reason: inactive ? 'inactive' : 'unverified' },
      });
      if (inactive) throw AppError.forbidden('This account is unavailable');
      throw byPhone
        ? new AppError(403, 'PHONE_NOT_VERIFIED', 'Please verify your phone number first')
        : new AppError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email address first');
    }
    await this.db.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    return this.completeLogin(user.id, 'password', meta);
  }

  /**
   * Final step once a primary factor (password or verified Google identity) has succeeded.
   * Users with MFA get a short-lived, single-use challenge instead of a session.
   */
  async completeLogin(
    userId: string,
    method: 'password' | 'google',
    meta: ReqMeta,
  ): Promise<LoginResult> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabled) {
      if (!this.mfa)
        throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Sign-in is temporarily unavailable');
      const challengeToken = await this.issueToken(user.id, 'MFA_CHALLENGE', MFA_CHALLENGE_TTL_MS);
      await writeAudit(this.db, {
        action: 'auth.login_mfa_required',
        outcome: 'SUCCESS',
        actorUserId: user.id,
        requestId: meta.requestId,
        summary: { method },
      });
      return { kind: 'mfa', challengeToken };
    }
    await writeAudit(this.db, {
      action: 'auth.login',
      outcome: 'SUCCESS',
      actorUserId: user.id,
      requestId: meta.requestId,
      summary: { method },
    });
    return { kind: 'session', ...(await this.createSession(user.id, meta)) };
  }

  /** Second step of an MFA sign-in. Limited attempts per challenge; the challenge is single use. */
  async completeMfaLogin(
    challengeToken: string,
    factor: { code?: string | undefined; recoveryCode?: string | undefined },
    meta: ReqMeta,
  ): Promise<SessionResult> {
    const invalid = () => AppError.unauthenticated('Invalid or expired verification');
    const tokenHash = hashToken(challengeToken);
    const row = await this.db.oneTimeToken.findUnique({ where: { tokenHash } });
    const now = this.now();
    if (
      !row ||
      row.purpose !== 'MFA_CHALLENGE' ||
      row.usedAt ||
      row.expiresAt <= now ||
      row.attempts >= MFA_MAX_ATTEMPTS ||
      !this.mfa
    ) {
      throw invalid();
    }
    const ok = await this.mfa.verifySecondFactor(row.userId, factor);
    if (!ok) {
      await this.db.oneTimeToken.update({
        where: { tokenHash },
        data: { attempts: { increment: 1 } },
      });
      await writeAudit(this.db, {
        action: 'auth.mfa_verify',
        outcome: 'FAILURE',
        actorUserId: row.userId,
        requestId: meta.requestId,
      });
      throw invalid();
    }
    const claimed = await this.db.oneTimeToken.updateMany({
      where: { tokenHash, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw invalid();
    const user = await this.db.user.findUniqueOrThrow({ where: { id: row.userId } });
    if (user.status !== 'ACTIVE') throw invalid();
    await writeAudit(this.db, {
      action: 'auth.login',
      outcome: 'SUCCESS',
      actorUserId: user.id,
      requestId: meta.requestId,
      summary: { method: 'mfa' },
    });
    return this.createSession(user.id, meta);
  }

  async listSessions(userId: string, currentToken: string) {
    const rows = await this.db.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: this.now() } },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        createdAt: true,
        lastUsedAt: true,
        refreshTokenHash: true,
      },
    });
    const current = hashToken(currentToken);
    return rows.map((row) => {
      const { refreshTokenHash, ...rest } = row;
      return { ...rest, current: refreshTokenHash === current };
    });
  }

  /** Only the owner's own sessions can be revoked; others get the same not-found. */
  async revokeSession(userId: string, sessionId: string) {
    const res = await this.db.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: this.now() },
    });
    if (res.count !== 1) throw AppError.notFound('Session not found');
  }

  /**
   * Resolves a session cookie to a user. Rotates the token when it is old. Presenting an
   * already-rotated token outside a short grace window is treated as theft: the family is revoked.
   */
  async authenticate(
    sessionToken: string,
    meta: ReqMeta,
  ): Promise<{ userId: string; mustChangePassword: boolean; rotatedToken?: string } | null> {
    const row = await this.db.session.findUnique({
      where: { refreshTokenHash: hashToken(sessionToken) },
    });
    const now = this.now();
    if (!row || row.expiresAt <= now) return null;
    if (row.revokedAt) {
      if (now.getTime() - row.revokedAt.getTime() > ROTATION_GRACE_MS) {
        await this.db.session.updateMany({
          where: { familyId: row.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        await writeAudit(this.db, {
          action: 'auth.session_reuse_detected',
          outcome: 'DENIED',
          actorUserId: row.userId,
          requestId: meta.requestId,
        });
      }
      return null;
    }
    const user = await this.db.user.findUnique({ where: { id: row.userId } });
    if (!user || user.status !== 'ACTIVE') return null;

    if (now.getTime() - row.createdAt.getTime() > ROTATE_AFTER_MS) {
      const claimed = await this.db.session.updateMany({
        where: { id: row.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (claimed.count === 1) {
        const next = await this.createSession(row.userId, meta, row.familyId);
        return {
          userId: row.userId,
          mustChangePassword: user.mustChangePassword,
          rotatedToken: next.sessionToken,
        };
      }
    }
    return { userId: row.userId, mustChangePassword: user.mustChangePassword };
  }

  async logout(sessionToken: string) {
    await this.db.session.updateMany({
      where: { refreshTokenHash: hashToken(sessionToken), revokedAt: null },
      data: { revokedAt: this.now() },
    });
  }

  async revokeAllSessions(userId: string) {
    await this.db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.now() },
    });
  }

  /** Generic outcome regardless of whether the account exists. */
  async forgotPassword(email: string, meta: ReqMeta) {
    const user = await this.db.user.findUnique({ where: { email } });
    if (user?.email && user.status === 'ACTIVE') {
      const token = await this.issueToken(user.id, 'PASSWORD_RESET', RESET_TTL_MS);
      await this.mailer.send({
        to: user.email,
        template: 'password-reset',
        data: { link: `${this.appUrl}/reset-password?token=${token}` },
      });
    }
    await writeAudit(this.db, {
      action: 'auth.password_reset_requested',
      outcome: 'SUCCESS',
      requestId: meta.requestId,
    });
  }

  async resetPassword(token: string, newPassword: string, meta: ReqMeta) {
    const userId = await this.consumeToken(token, 'PASSWORD_RESET');
    const user = await this.db.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(newPassword),
        failedLoginCount: 0,
        lockedUntil: null,
        // Possession of the emailed link proves ownership of the address.
        emailVerifiedAt: this.now(),
      },
    });
    await this.revokeAllSessions(userId);
    if (user.email) {
      await this.mailer.send({ to: user.email, template: 'password-changed', data: {} });
    }
    await writeAudit(this.db, {
      action: 'auth.password_reset',
      outcome: 'SUCCESS',
      actorUserId: userId,
      requestId: meta.requestId,
    });
  }

  // ---- Phone number accounts -----------------------------------------------------------------------

  private requireOtp(): OtpService {
    if (!this.otp) throw AppError.notFound();
    return this.otp;
  }

  /**
   * Creates an account that is reached by phone number, and texts a code to prove the number is the
   * person's own. Answers the same whether or not the number is already registered. A number whose
   * account was never verified is taken over by the newest sign-up (and only whoever then receives
   * the code can finish it), so nobody can lock a real owner out by registering their number first.
   */
  async registerPhone(
    input: { phone: string; password: string; displayName: string },
    meta: ReqMeta,
  ) {
    const otp = this.requireOtp();
    const existing = await this.db.user.findUnique({ where: { phone: input.phone } });
    if (existing?.phoneVerifiedAt || (existing && existing.status !== 'ACTIVE')) {
      await writeAudit(this.db, {
        action: 'auth.register_phone',
        outcome: 'FAILURE',
        requestId: meta.requestId,
        summary: { reason: 'exists' },
      });
      return;
    }
    const passwordHash = await hashPassword(input.password);
    let userId: string;
    if (existing) {
      await this.db.user.update({
        where: { id: existing.id },
        data: { passwordHash, displayName: input.displayName },
      });
      userId = existing.id;
    } else {
      try {
        userId = (
          await this.db.user.create({
            data: { phone: input.phone, displayName: input.displayName, passwordHash },
          })
        ).id;
      } catch {
        return; // a simultaneous sign-up for the same number won; say nothing different
      }
    }
    await otp.issue(input.phone, 'REGISTER', userId);
    await writeAudit(this.db, {
      action: 'auth.register_phone',
      outcome: 'SUCCESS',
      actorUserId: userId,
      requestId: meta.requestId,
    });
  }

  /** Checks the code from the text and marks the number as the account's own. */
  async verifyPhone(phone: string, code: string, meta: ReqMeta) {
    const otp = this.requireOtp();
    const r = await otp.verify(phone, 'REGISTER', code);
    if (!r.ok || !r.userId) {
      await writeAudit(this.db, {
        action: 'auth.phone_verify',
        outcome: 'FAILURE',
        requestId: meta.requestId,
      });
      throw AppError.validation('That code is not right, or it has expired');
    }
    await this.db.user.update({
      where: { id: r.userId },
      data: { phoneVerifiedAt: this.now() },
    });
    await writeAudit(this.db, {
      action: 'auth.phone_verified',
      outcome: 'SUCCESS',
      actorUserId: r.userId,
      requestId: meta.requestId,
    });
  }

  /** Sends another code to a number that signed up and has not verified yet. Never says if it did. */
  async resendPhoneCode(phone: string, meta: ReqMeta) {
    const otp = this.requireOtp();
    const user = await this.db.user.findUnique({ where: { phone } });
    if (user && !user.phoneVerifiedAt && user.status === 'ACTIVE') {
      await otp.issue(phone, 'REGISTER', user.id);
    }
    await writeAudit(this.db, {
      action: 'auth.phone_code_resent',
      outcome: 'SUCCESS',
      requestId: meta.requestId,
    });
  }

  /** Texts a password-reset code to a verified number. Same answer for every number. */
  async forgotPasswordPhone(phone: string, meta: ReqMeta) {
    const otp = this.requireOtp();
    const user = await this.db.user.findUnique({ where: { phone } });
    if (user?.phoneVerifiedAt && user.status === 'ACTIVE') {
      await otp.issue(phone, 'PASSWORD_RESET', user.id);
    }
    await writeAudit(this.db, {
      action: 'auth.password_reset_requested',
      outcome: 'SUCCESS',
      requestId: meta.requestId,
      summary: { channel: 'phone' },
    });
  }

  async resetPasswordPhone(phone: string, code: string, newPassword: string, meta: ReqMeta) {
    const otp = this.requireOtp();
    const r = await otp.verify(phone, 'PASSWORD_RESET', code);
    if (!r.ok || !r.userId) {
      await writeAudit(this.db, {
        action: 'auth.password_reset',
        outcome: 'FAILURE',
        requestId: meta.requestId,
        summary: { channel: 'phone' },
      });
      throw AppError.validation('That code is not right, or it has expired');
    }
    await this.db.user.update({
      where: { id: r.userId },
      data: {
        passwordHash: await hashPassword(newPassword),
        failedLoginCount: 0,
        lockedUntil: null,
        phoneVerifiedAt: this.now(), // receiving the code proves the number
      },
    });
    await this.revokeAllSessions(r.userId);
    await writeAudit(this.db, {
      action: 'auth.password_reset',
      outcome: 'SUCCESS',
      actorUserId: r.userId,
      requestId: meta.requestId,
      summary: { channel: 'phone' },
    });
  }

  /** The person's own name. Nothing else about the account changes here. */
  async updateProfile(userId: string, displayName: string, meta: ReqMeta) {
    await this.db.user.update({ where: { id: userId }, data: { displayName } });
    await writeAudit(this.db, {
      action: 'auth.profile_updated',
      outcome: 'SUCCESS',
      actorUserId: userId,
      requestId: meta.requestId,
    });
  }

  async setAvatar(userId: string, bytes: Buffer, meta: ReqMeta) {
    const type = checkImage(bytes, MAX_AVATAR_BYTES);
    const data = new Uint8Array(bytes);
    await this.db.userAvatar.upsert({
      where: { userId },
      create: { userId, data, contentType: type },
      update: { data, contentType: type },
    });
    await writeAudit(this.db, {
      action: 'auth.avatar_changed',
      outcome: 'SUCCESS',
      actorUserId: userId,
      requestId: meta.requestId,
    });
  }

  async clearAvatar(userId: string) {
    await this.db.userAvatar.deleteMany({ where: { userId } });
  }

  async getAvatar(userId: string) {
    const a = await this.db.userAvatar.findUnique({ where: { userId } });
    return a ? { data: Buffer.from(a.data), type: a.contentType } : null;
  }

  async changePassword(
    userId: string,
    current: string,
    next: string,
    currentSessionToken: string,
    meta: ReqMeta,
  ) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, current))) {
      await writeAudit(this.db, {
        action: 'auth.password_change',
        outcome: 'FAILURE',
        actorUserId: userId,
        requestId: meta.requestId,
      });
      throw AppError.forbidden('Current password is incorrect');
    }
    await this.db.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(next), mustChangePassword: false },
    });
    // Revoke every other session; keep the caller signed in.
    await this.db.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        NOT: { refreshTokenHash: hashToken(currentSessionToken) },
      },
      data: { revokedAt: this.now() },
    });
    if (user.email) {
      await this.mailer.send({ to: user.email, template: 'password-changed', data: {} });
    }
    await writeAudit(this.db, {
      action: 'auth.password_change',
      outcome: 'SUCCESS',
      actorUserId: userId,
      requestId: meta.requestId,
    });
  }
}
