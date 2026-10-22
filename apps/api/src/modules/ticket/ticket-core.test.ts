import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  deriveTicketKey,
  formatTicketCode,
  newTicketCode,
  normalizeTicketCode,
  parseTicketToken,
  ticketToken,
} from './ticket-core.js';
import { renderReceiptPdf, renderTicketsPdf, type DocData } from './pdf.js';

const key = deriveTicketKey(randomBytes(32).toString('base64'));
const tenant = '11111111-1111-4111-8111-111111111111';
const ticket = '22222222-2222-4222-8222-222222222222';

describe('ticket QR token', () => {
  it('round-trips and is short enough for a small QR code', () => {
    const t = ticketToken(key, tenant, ticket);
    expect(t.length).toBeLessThan(110);
    expect(parseTicketToken(key, t)).toEqual({ tenantId: tenant, ticketId: ticket });
  });
  it('rejects tampering with either id, the signature, or a different key', () => {
    const t = ticketToken(key, tenant, ticket);
    const [v, ten, tic, sig] = t.split('.');
    const other = '33333333-3333-4333-8333-333333333333';
    expect(parseTicketToken(key, [v, other, tic, sig].join('.'))).toBeNull(); // moved to another company
    expect(parseTicketToken(key, [v, ten, other, sig].join('.'))).toBeNull(); // another ticket
    expect(parseTicketToken(key, [v, ten, tic, sig!.slice(0, -2) + 'AA'].join('.'))).toBeNull();
    expect(parseTicketToken(key, [v, ten, tic].join('.'))).toBeNull();
    expect(parseTicketToken(key, ['t2', ten, tic, sig].join('.'))).toBeNull();
    expect(parseTicketToken(deriveTicketKey(randomBytes(32).toString('base64')), t)).toBeNull();
    for (const junk of ['', 'abc', 't1...', 't1.a.b.c', '\u0000'])
      expect(parseTicketToken(key, junk)).toBeNull();
  });
  it('tolerates surrounding whitespace from a scanner', () => {
    const t = ticketToken(key, tenant, ticket);
    expect(parseTicketToken(key, `  ${t}\n`)).not.toBeNull();
  });
});

describe('ticket codes', () => {
  it('generates unambiguous 10-character codes', () => {
    for (let i = 0; i < 200; i++) expect(newTicketCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(new Set(Array.from({ length: 500 }, newTicketCode)).size).toBe(500);
  });
  it('normalises what a person types', () => {
    const code = 'ABCDE12345';
    expect(normalizeTicketCode(formatTicketCode(code).toLowerCase())).toBe(code);
    expect(normalizeTicketCode(' abcde 12345 ')).toBe(code);
    expect(normalizeTicketCode('IL0U')).toBe('1100V'.slice(0, 1) + '1' + '0' + 'V');
  });
});

const doc: DocData = {
  company: 'Demo Coaches',
  timezone: 'UTC',
  reference: 'ABC123',
  contactName: 'Aminata K\u00e9ita \u4e2d',
  contactPhone: '+23277000000',
  route: 'Freetown - Bo',
  origin: { name: 'A', city: 'Freetown' },
  destination: { name: 'B', city: 'Bo' },
  departureAt: new Date('2030-01-01T08:00:00Z'),
  arrivalAt: new Date('2030-01-01T12:00:00Z'),
  currency: 'SLE',
  totalMinor: 300_000,
  passengers: [
    { seat: '1', name: 'Aminata', fareMinor: 150_000 },
    { seat: '2', name: 'Bob', fareMinor: 150_000 },
  ],
  payment: {
    id: 'a1b2c3d4-0000-4000-8000-000000000000',
    paidAt: new Date('2029-12-31T10:00:00Z'),
    amountMinor: 300_000,
  },
  tickets: [1, 2].map((n) => ({
    seat: String(n),
    passengerName: 'P' + n,
    code: 'ABCDE-1234' + n,
    token: ticketToken(key, tenant, ticket),
    status: 'ISSUED',
  })),
};

const pageCount = (b: Buffer) =>
  Number(/\/Type \/Pages[\s\S]*?\/Count (\d+)/.exec(b.toString('latin1'))?.[1] ?? 0);

describe('PDF documents', () => {
  it('renders a ticket PDF with one page per ticket, and a receipt', async () => {
    const t = await renderTicketsPdf(doc);
    expect(t.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(t)).toBe(2);
    const r = await renderReceiptPdf(doc);
    expect(r.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(r)).toBe(1);
  });
});
