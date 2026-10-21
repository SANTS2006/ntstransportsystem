import { describe, expect, it, vi } from 'vitest';
import { MonimeGateway, signMonime, verifyMonimeSignature } from './gateway.js';

const secret = 'x'.repeat(40);
const body = Buffer.from(
  JSON.stringify({ event: { id: 'e1', name: 'checkout_session.completed' } }),
);
const now = 1_800_000_000;

describe('verifyMonimeSignature', () => {
  it('accepts a correctly signed, fresh delivery', () => {
    expect(verifyMonimeSignature(signMonime(body, secret, now), body, secret, now + 5)).toBe(true);
  });
  it('rejects a wrong secret, a changed body and a missing header', () => {
    const h = signMonime(body, secret, now);
    expect(verifyMonimeSignature(h, body, 'y'.repeat(40), now)).toBe(false);
    expect(verifyMonimeSignature(h, Buffer.from(body.toString() + ' '), secret, now)).toBe(false);
    expect(verifyMonimeSignature(undefined, body, secret, now)).toBe(false);
    expect(verifyMonimeSignature('', body, secret, now)).toBe(false);
  });
  it('rejects stale and future timestamps (replay window of 5 minutes)', () => {
    const h = signMonime(body, secret, now);
    expect(verifyMonimeSignature(h, body, secret, now + 299)).toBe(true);
    expect(verifyMonimeSignature(h, body, secret, now + 301)).toBe(false);
    expect(verifyMonimeSignature(h, body, secret, now - 301)).toBe(false);
  });
  it('is bound to the timestamp: a re-stamped signature fails', () => {
    const sig = signMonime(body, secret, now).split(',v1=')[1];
    expect(verifyMonimeSignature(`t=${now + 1},v1=${sig}`, body, secret, now + 1)).toBe(false);
  });
  it('rejects malformed headers without throwing', () => {
    for (const h of [
      't=abc,v1=zzz',
      't=,v1=',
      'v1=abc',
      `t=${now}`,
      'garbage',
      `t=${now},v1=`,
      `t=-5,v1=abc`,
    ]) {
      expect(verifyMonimeSignature(h, body, secret, now)).toBe(false);
    }
  });
  it('rejects a signature of the wrong length', () => {
    expect(verifyMonimeSignature(`t=${now},v1=AAAA`, body, secret, now)).toBe(false);
  });
});

const cfg = { token: 'mon_test_abcdefgh1234', spaceId: 'spc-123' };
const req = {
  idempotencyKey: 'nts-pay-' + 'a'.repeat(36),
  reference: 'pay-1',
  name: 'Bus ticket ABC',
  currency: 'SLE',
  lineItems: [{ name: 'Seat 1', amountMinor: 50_000, quantity: 1, reference: 'seat-1' }],
  successUrl: 'https://app.test/ok',
  cancelUrl: 'https://app.test/no',
  metadata: { a: 'b' },
};
const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('MonimeGateway', () => {
  it('sends the documented headers and body, and parses the session', async () => {
    const fetchFn = vi.fn(async () =>
      json(200, { success: true, result: { id: 'cs-1', redirectUrl: 'https://pay.monime.io/x' } }),
    );
    const g = new MonimeGateway('https://api.monime.io/v1', fetchFn as unknown as typeof fetch);
    const out = await g.createCheckout(cfg, req);
    expect(out).toEqual({ sessionId: 'cs-1', redirectUrl: 'https://pay.monime.io/x' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.monime.io/v1/checkout-sessions');
    const h = init.headers as Record<string, string>;
    expect(h.authorization).toBe('Bearer mon_test_abcdefgh1234');
    expect(h['monime-space-id']).toBe('spc-123');
    expect(h['monime-version']).toBe('caph.2025-08-23');
    expect(h['idempotency-key']).toBe(req.idempotencyKey);
    const sent = JSON.parse(init.body as string);
    expect(sent.reference).toBe('pay-1');
    expect(sent.lineItems[0].price).toEqual({ currency: 'SLE', value: 50_000 });
  });

  it('retries transient failures with the same idempotency key, but not client errors', async () => {
    const calls: string[] = [];
    const flaky = vi.fn(async (_u: string, init: RequestInit) => {
      calls.push((init.headers as Record<string, string>)['idempotency-key'] ?? '');
      return calls.length < 2
        ? json(503, { success: false })
        : json(200, {
            success: true,
            result: { id: 'cs-2', redirectUrl: 'https://pay.monime.io/y' },
          });
    });
    const g = new MonimeGateway('https://api.monime.io/v1', flaky as unknown as typeof fetch);
    await expect(g.createCheckout(cfg, req)).resolves.toMatchObject({ sessionId: 'cs-2' });
    expect(new Set(calls).size).toBe(1);

    const bad = vi.fn(async () => json(401, { success: false, error: { message: 'bad token' } }));
    const g2 = new MonimeGateway('https://api.monime.io/v1', bad as unknown as typeof fetch);
    await expect(g2.createCheckout(cfg, req)).rejects.toThrow(/401/);
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it('never accepts a non-https redirect URL or a response without a session', async () => {
    const g = new MonimeGateway('https://api.monime.io/v1', (async () =>
      json(200, {
        success: true,
        result: { id: 'cs-3', redirectUrl: 'http://evil.test' },
      })) as unknown as typeof fetch);
    await expect(g.createCheckout(cfg, req)).rejects.toThrow(/unexpected/);
  });

  it('reads the status, reference and total of a session', async () => {
    const g = new MonimeGateway('https://api.monime.io/v1', (async () =>
      json(200, {
        success: true,
        result: {
          status: 'completed',
          reference: 'pay-1',
          lineItems: { data: [{ price: { currency: 'SLE', value: 50_000 }, quantity: 2 }] },
        },
      })) as unknown as typeof fetch);
    await expect(g.getCheckout(cfg, 'cs-1')).resolves.toEqual({
      status: 'completed',
      reference: 'pay-1',
      totalMinor: 100_000,
      currency: 'SLE',
    });
  });
});
