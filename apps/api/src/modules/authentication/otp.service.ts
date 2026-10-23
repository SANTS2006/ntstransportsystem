import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Db } from '../../platform/db.js';
import type { SmsSender } from '../../platform/sms.js';

export type OtpPurpose = 'REGISTER' | 'PASSWORD_RESET' | 'EMAIL_VERIFY';

/** E-mail codes are six letters and digits (no 0/O/1/I, which look alike); text codes are digits. */
const EMAIL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = (purpose: OtpPurpose) =>
  purpose === 'EMAIL_VERIFY'
    ? Array.from({ length: 6 }, () => EMAIL_ALPHABET[randomInt(0, EMAIL_ALPHABET.length)]).join('')
    : String(randomInt(0, 1_000_000)).padStart(6, '0');
const codeShape = (purpose: OtpPurpose) =>
  purpose === 'EMAIL_VERIFY' ? /^[A-Z0-9]{6}$/ : /^\d{6}$/;

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
/** Between two texts to the same number for the same reason. */
export const OTP_RESEND_AFTER_MS = 60_000;
/** Texts to one number per hour: caps what one person can cost us and what one number receives. */
export const OTP_MAX_PER_HOUR = 5;

const text = (code: string) =>
  `NTS Transport: your code is ${code}. It expires in 10 minutes. Never share it with anyone.`;

/**
 * One-time codes sent by SMS. A code is six digits, valid for ten minutes, can be tried five
 * times, and replaces any earlier code for the same number and purpose. Only a keyed hash is
 * stored, so a copy of the database does not reveal codes, and the key is not in the database.
 */
export class OtpService {
  constructor(
    private readonly db: Db,
    private readonly sms: SmsSender,
    private readonly key: Buffer,
    private readonly opts: {
      now?: () => Date;
      onSendError?: (err: Error) => void;
    } = {},
  ) {}

  private now() {
    return (this.opts.now ?? (() => new Date()))();
  }

  private hash(phone: string, purpose: OtpPurpose, code: string): string {
    return createHmac('sha256', this.key).update(`${phone}|${purpose}|${code}`).digest('hex');
  }

  /**
   * Sends a new code unless one was sent a moment ago or too many went out this hour (the caller
   * answers the same either way, so the response reveals nothing). Returns whether one was sent.
   */
  async issue(
    phone: string,
    purpose: OtpPurpose,
    userId: string | null,
    /** How the code reaches the person; texts by default. */
    deliver: (code: string) => Promise<void> = (code) => this.sms.send(phone, text(code)),
  ): Promise<boolean> {
    const now = this.now();
    const recent = await this.db.phoneOtp.findMany({
      where: { phone, purpose, createdAt: { gt: new Date(now.getTime() - 3_600_000) } },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    if (recent.length >= OTP_MAX_PER_HOUR) return false;
    const last = recent[0];
    if (last && now.getTime() - last.createdAt.getTime() < OTP_RESEND_AFTER_MS) return false;

    const code = makeCode(purpose);
    await this.db.phoneOtp.updateMany({
      where: { phone, purpose, consumedAt: null },
      data: { consumedAt: now }, // only the newest code can work
    });
    const row = await this.db.phoneOtp.create({
      data: {
        phone,
        purpose,
        userId,
        codeHash: this.hash(phone, purpose, code),
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      },
    });
    try {
      await deliver(code);
    } catch (err) {
      // The row stays (it counts toward the hourly limit); the person can ask for another code.
      await this.db.phoneOtp.update({ where: { id: row.id }, data: { consumedAt: now } });
      this.opts.onSendError?.(err as Error);
      return false;
    }
    return true;
  }

  /** Checks a code. Each wrong guess uses one of the five attempts; a right one is used up. */
  async verify(
    phone: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<{ ok: true; userId: string | null } | { ok: false }> {
    code = purpose === 'EMAIL_VERIFY' ? code.trim().toUpperCase() : code;
    if (!codeShape(purpose).test(code)) return { ok: false };
    const now = this.now();
    const row = await this.db.phoneOtp.findFirst({
      where: { phone, purpose, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return { ok: false };
    // Count the attempt first and atomically, so parallel guesses cannot exceed the limit.
    const took = await this.db.phoneOtp.updateMany({
      where: { id: row.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (took.count !== 1) return { ok: false };
    const a = Buffer.from(this.hash(phone, purpose, code));
    const b = Buffer.from(row.codeHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };
    const used = await this.db.phoneOtp.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: now },
    });
    return used.count === 1 ? { ok: true, userId: row.userId } : { ok: false };
  }
}
