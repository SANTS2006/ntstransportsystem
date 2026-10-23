import { randomBytes } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { hashToken, verifyPassword } from '../../platform/crypto.js';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import type { SecretBox } from '../../platform/secretbox.js';
import { writeAudit } from '../audit/audit.js';

const PERIOD_S = 30;
const RECOVERY_CODE_COUNT = 10;

const newRecoveryCode = () => {
  const raw = randomBytes(8).toString('hex'); // 64 bits
  return `${raw.slice(0, 8)}-${raw.slice(8)}`;
};
// Normalise user input so spacing/case differences don't matter.
const normaliseRecovery = (c: string) => c.trim().toLowerCase();

export class MfaService {
  constructor(
    private readonly db: Db,
    private readonly box: SecretBox,
    private readonly issuer: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private totp(secretBase32: string, label: string) {
    return new OTPAuth.TOTP({
      issuer: this.issuer,
      label,
      algorithm: 'SHA1', // widest authenticator-app compatibility (RFC 6238 default)
      digits: 6,
      period: PERIOD_S,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
  }

  /** Starts (or restarts) enrollment. MFA is not active until confirmed with a valid code. */
  async beginEnrollment(userId: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    const existing = await this.db.mfaCredential.findUnique({ where: { userId } });
    if (existing?.confirmedAt)
      throw AppError.conflict('Multi-factor authentication is already enabled');
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    const secretEnc = this.box.encrypt(secret);
    await this.db.mfaCredential.upsert({
      where: { userId },
      create: { userId, secretEnc },
      update: { secretEnc, confirmedAt: null, lastUsedStep: null },
    });
    return {
      secret,
      otpauthUri: this.totp(secret, user.email ?? user.phone ?? user.displayName).toString(),
    };
  }

  /**
   * Checks a code against the stored seed, allowing ±1 step of clock drift, and rejects replay of
   * a step that was already accepted. The conditional update makes acceptance atomic.
   */
  private async acceptTotp(
    userId: string,
    code: string,
    requireConfirmed: boolean,
  ): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) return false;
    const cred = await this.db.mfaCredential.findUnique({ where: { userId } });
    if (!cred || (requireConfirmed && !cred.confirmedAt)) return false;
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    const delta = this.totp(
      this.box.decrypt(cred.secretEnc),
      user.email ?? user.phone ?? user.displayName,
    ).validate({
      token: code,
      window: 1,
      timestamp: this.now().getTime(),
    });
    if (delta === null) return false;
    const step = BigInt(Math.floor(this.now().getTime() / 1000 / PERIOD_S) + delta);
    const claimed = await this.db.mfaCredential.updateMany({
      where: { userId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
      data: { lastUsedStep: step },
    });
    return claimed.count === 1;
  }

  private async replaceRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await this.db.$transaction([
      this.db.recoveryCode.deleteMany({ where: { userId } }),
      this.db.recoveryCode.createMany({
        data: codes.map((c) => ({ userId, codeHash: hashToken(normaliseRecovery(c)) })),
      }),
    ]);
    return codes;
  }

  /** Activates MFA. Returns recovery codes, which are shown exactly once. */
  async confirmEnrollment(userId: string, code: string, requestId?: string) {
    if (!(await this.acceptTotp(userId, code, false))) throw AppError.validation('Invalid code');
    await this.db.mfaCredential.update({ where: { userId }, data: { confirmedAt: this.now() } });
    await this.db.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
    const recoveryCodes = await this.replaceRecoveryCodes(userId);
    await writeAudit(this.db, {
      action: 'auth.mfa_enabled',
      outcome: 'SUCCESS',
      actorUserId: userId,
      requestId,
    });
    return { recoveryCodes };
  }

  /** Second-factor check at sign-in: a TOTP code or a single-use recovery code. */
  async verifySecondFactor(
    userId: string,
    input: { code?: string | undefined; recoveryCode?: string | undefined },
  ) {
    if (input.code !== undefined) return this.acceptTotp(userId, input.code, true);
    if (input.recoveryCode !== undefined) {
      const res = await this.db.recoveryCode.updateMany({
        where: { userId, codeHash: hashToken(normaliseRecovery(input.recoveryCode)), usedAt: null },
        data: { usedAt: this.now() },
      });
      return res.count === 1;
    }
    return false;
  }

  async remainingRecoveryCodes(userId: string) {
    return this.db.recoveryCode.count({ where: { userId, usedAt: null } });
  }

  async regenerateRecoveryCodes(userId: string, code: string, requestId?: string) {
    if (!(await this.acceptTotp(userId, code, true))) throw AppError.validation('Invalid code');
    const recoveryCodes = await this.replaceRecoveryCodes(userId);
    await writeAudit(this.db, {
      action: 'auth.mfa_recovery_regenerated',
      outcome: 'SUCCESS',
      actorUserId: userId,
      requestId,
    });
    return { recoveryCodes };
  }

  /** Requires the password (if one exists) and a valid code. Platform administrators cannot opt out. */
  async disable(
    userId: string,
    input: { password?: string | undefined; code: string },
    requestId?: string,
  ) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (await this.db.platformRoleAssignment.count({ where: { userId } })) {
      throw AppError.forbidden(
        'Multi-factor authentication is mandatory for platform administrators',
      );
    }
    if (
      user.passwordHash &&
      !(input.password && (await verifyPassword(user.passwordHash, input.password)))
    ) {
      throw AppError.forbidden('Password is incorrect');
    }
    if (!(await this.acceptTotp(userId, input.code, true)))
      throw AppError.validation('Invalid code');
    await this.db.$transaction([
      this.db.recoveryCode.deleteMany({ where: { userId } }),
      this.db.mfaCredential.delete({ where: { userId } }),
      this.db.user.update({ where: { id: userId }, data: { mfaEnabled: false } }),
    ]);
    await writeAudit(this.db, {
      action: 'auth.mfa_disabled',
      outcome: 'SUCCESS',
      actorUserId: userId,
      requestId,
    });
  }
}
