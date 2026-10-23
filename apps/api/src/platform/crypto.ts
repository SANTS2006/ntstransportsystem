import { hkdfSync } from 'node:crypto';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

/** Argon2id with OWASP-aligned parameters (19 MiB, t=2, p=1 minimum). */
const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const hashPassword = (password: string) => argon2.hash(password, ARGON_OPTS);

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** 256-bit URL-safe random token. Only sha256(token) is persisted. */
export const generateToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** A purpose-specific key derived from the application secret, so no purpose reuses another's key. */
export function deriveSubkey(appKeyBase64: string, purpose: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(appKeyBase64, 'base64'), '', `nts:${purpose}`, 32),
  );
}
