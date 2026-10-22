import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Tx } from '../../platform/db.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U
const CODE_LENGTH = 10;

export function newTicketCode(): string {
  return Array.from(randomBytes(CODE_LENGTH), (b) => ALPHABET[b % 32]).join('');
}

/** Staff may type a code with a dash, in lower case, or with look-alike letters. */
export function normalizeTicketCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
}
export const formatTicketCode = (code: string) => `${code.slice(0, 5)}-${code.slice(5)}`;

// ---- Signed QR token -------------------------------------------------------------------------

/** Derives the QR signing key from the application secret, so it never equals the encryption key. */
export function deriveTicketKey(appKeyBase64: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(appKeyBase64, 'base64'), '', 'nts-ticket-qr-v1', 32),
  );
}

const sign = (key: Buffer, tenantId: string, ticketId: string) =>
  createHmac('sha256', key).update(`t1|${tenantId}|${ticketId}`).digest().subarray(0, 16);

/** `t1.<tenant>.<ticket>.<signature>`: short enough for a small QR code. */
export function ticketToken(key: Buffer, tenantId: string, ticketId: string): string {
  return `t1.${tenantId}.${ticketId}.${sign(key, tenantId, ticketId).toString('base64url')}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns the ids only if the signature is valid. A forged or edited token yields null. */
export function parseTicketToken(
  key: Buffer,
  token: string,
): { tenantId: string; ticketId: string } | null {
  const parts = token.trim().split('.');
  if (parts.length !== 4 || parts[0] !== 't1') return null;
  const [, tenantId, ticketId, sig] = parts as [string, string, string, string];
  if (!UUID.test(tenantId) || !UUID.test(ticketId)) return null;
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  const expected = sign(key, tenantId, ticketId);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { tenantId, ticketId };
}

// ---- Issue / void inside the caller's transaction ----------------------------------------------

/**
 * Makes sure every live seat of the booking has a ticket. Idempotent: calling it again creates
 * nothing new. Runs in the same transaction that confirms the booking.
 */
export async function issueTicketsInTx(
  tx: Tx,
  tenantId: string,
  bookingId: string,
): Promise<number> {
  const seats = await tx.bookingPassenger.findMany({
    where: { tenantId, bookingId, releasedAt: null, ticket: { is: null } },
    select: { id: true, tripId: true, seatLabel: true, fullName: true },
  });
  if (seats.length === 0) return 0;
  const res = await tx.ticket.createMany({
    data: seats.map((p) => ({
      tenantId,
      bookingId,
      passengerId: p.id,
      tripId: p.tripId,
      seatLabel: p.seatLabel,
      passengerName: p.fullName,
      code: newTicketCode(),
    })),
    skipDuplicates: true,
  });
  return res.count;
}

/** Voids tickets that have not been used. A boarded ticket is history and is left alone. */
export async function voidTicketsInTx(
  tx: Tx,
  tenantId: string,
  bookingId: string,
  reason: string,
): Promise<number> {
  const res = await tx.ticket.updateMany({
    where: { tenantId, bookingId, status: 'ISSUED' },
    data: { status: 'VOID', voidedAt: new Date(), voidReason: reason.slice(0, 200) },
  });
  return res.count;
}
