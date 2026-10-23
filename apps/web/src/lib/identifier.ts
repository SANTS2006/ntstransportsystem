import { normalizePhone } from '@nts/shared';

export type IdentifierKind = 'email' | 'phone';

/** One box takes either: anything with an "@" is an email address, everything else a phone number. */
export const identifierKind = (raw: string): IdentifierKind =>
  raw.includes('@') ? 'email' : 'phone';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Checks what was typed. Returns an error message, or null when it can be used. A phone number is
 * only accepted when text-message sign-up is switched on for this server.
 */
export function checkIdentifier(raw: string, phoneAllowed: boolean): string | null {
  const v = raw.trim();
  if (!v) return phoneAllowed ? 'Enter your email or phone number' : 'Enter your email address';
  if (identifierKind(v) === 'email') return EMAIL.test(v) ? null : 'Enter a valid email address';
  if (!phoneAllowed) return 'Enter a valid email address';
  return normalizePhone(v) ? null : 'Enter a valid phone number, or an email address';
}

/** Same wording wherever a phone number is asked for. */
export const PHONE_HINT = 'Orange, Africell and Qcell numbers all work. Example: 076 123 456';
