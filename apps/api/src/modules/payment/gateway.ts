import { createHmac, timingSafeEqual } from 'node:crypto';

/** What we need from a payment provider. Monime is the only implementation; tests use a fake. */
export interface GatewayConfig {
  token: string;
  spaceId: string;
}
export interface CheckoutRequest {
  idempotencyKey: string;
  /** Our payment id; echoed back by the provider so webhooks can be matched to it. */
  reference: string;
  name: string;
  currency: string;
  lineItems: { name: string; amountMinor: number; quantity: number; reference: string }[];
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  /**
   * Offer only these mobile-money providers (Monime provider ids) and nothing else. Without it the
   * hosted page offers everything the company's Monime space has enabled.
   */
  momoProviders?: string[] | undefined;
}

/** A mobile-money provider as Monime lists it. */
export interface MomoProvider {
  providerId: string;
  name: string;
  active: boolean;
  /** Whether Monime can take payments from accounts with this provider. */
  canPayFrom: boolean;
}
export interface CheckoutCreated {
  sessionId: string;
  redirectUrl: string;
}
export type ProviderStatus = 'pending' | 'completed' | 'cancelled' | 'expired' | 'unknown';
export interface CheckoutState {
  status: ProviderStatus;
  reference: string | null;
  /** Sum of the session's line items (price x quantity), or null if the provider did not say. */
  totalMinor: number | null;
  currency: string | null;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export interface PaymentGateway {
  createCheckout(cfg: GatewayConfig, req: CheckoutRequest): Promise<CheckoutCreated>;
  getCheckout(cfg: GatewayConfig, sessionId: string): Promise<CheckoutState>;
  /** The mobile-money providers Monime supports in a country (ISO code). */
  listMomos(cfg: GatewayConfig, country: string): Promise<MomoProvider[]>;
}

// ---- Webhook signature -----------------------------------------------------------------------

export const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Monime signs "<unix timestamp>_<raw body>" with HMAC-SHA256 and sends
 * `Monime-Signature: t=<timestamp>,v1=<base64 signature>`. The scheme is taken from Monime's own
 * WordPress plugin; see docs/PAYMENTS.md. The raw bytes must be used: re-serialised JSON differs.
 */
export function verifyMonimeSignature(
  header: string | undefined,
  rawBody: Buffer,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!header || !secret) return false;
  let t: number | null = null;
  let sig: string | null = null;
  for (const part of header.split(',')) {
    const p = part.trim();
    if (p.startsWith('t=')) t = Number(p.slice(2));
    else if (p.startsWith('v1=')) sig = p.slice(3).trim();
  }
  if (t === null || !Number.isInteger(t) || t <= 0 || !sig) return false;
  if (Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${t}_`), rawBody]))
    .digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Builds a valid header. Used by tests and by documentation; never to authenticate real calls. */
export function signMonime(rawBody: Buffer, secret: string, t: number): string {
  const sig = createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${t}_`), rawBody]))
    .digest('base64');
  return `t=${t},v1=${sig}`;
}

// ---- Monime HTTP client ----------------------------------------------------------------------

const TIMEOUT_MS = 15_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface MonimeEnvelope {
  success?: boolean;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

/**
 * Talks to Monime's REST API (caph.2025-08-23). Credentials are passed per call because each
 * company has its own. Neither the token nor request bodies are ever logged. Creating a session is
 * retried with the same Idempotency-Key, which Monime documents as safe.
 */
export class MonimeGateway implements PaymentGateway {
  constructor(
    private readonly baseUrl = 'https://api.monime.io/v1',
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private headers(cfg: GatewayConfig, idempotencyKey?: string): Record<string, string> {
    return {
      authorization: `Bearer ${cfg.token}`,
      'monime-space-id': cfg.spaceId,
      'monime-version': 'caph.2025-08-23',
      accept: 'application/json',
      ...(idempotencyKey
        ? { 'content-type': 'application/json', 'idempotency-key': idempotencyKey }
        : {}),
    };
  }

  private async call(url: string, init: RequestInit, attempts: number): Promise<MonimeEnvelope> {
    let last: GatewayError | null = null;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await sleep(300 * 2 ** i + Math.floor(Math.random() * 200));
      try {
        const res = await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
        const body = (await res.json().catch(() => ({}))) as MonimeEnvelope;
        if (res.ok && body.success !== false) return body;
        const retryable = res.status === 429 || res.status >= 500;
        last = new GatewayError(
          // Provider message only; it never contains our credentials.
          `Monime responded ${res.status}${body.error?.message ? `: ${String(body.error.message).slice(0, 200)}` : ''}`,
          retryable,
        );
        if (!retryable) throw last;
      } catch (err) {
        if (err instanceof GatewayError) {
          if (!err.retryable) throw err;
          last = err;
        } else {
          last = new GatewayError('Could not reach Monime', true);
        }
      }
    }
    throw last ?? new GatewayError('Monime request failed', true);
  }

  async createCheckout(cfg: GatewayConfig, req: CheckoutRequest): Promise<CheckoutCreated> {
    const body = await this.call(
      `${this.baseUrl}/checkout-sessions`,
      {
        method: 'POST',
        headers: this.headers(cfg, req.idempotencyKey),
        body: JSON.stringify({
          name: req.name.slice(0, 150),
          reference: req.reference,
          successUrl: req.successUrl,
          cancelUrl: req.cancelUrl,
          lineItems: req.lineItems.map((l) => ({
            type: 'custom',
            name: l.name.slice(0, 100),
            quantity: l.quantity,
            reference: l.reference.slice(0, 100),
            price: { currency: req.currency, value: l.amountMinor },
          })),
          metadata: req.metadata,
          ...(req.momoProviders && req.momoProviders.length > 0
            ? {
                // Only the chosen wallet: no cards, banks or other wallets on the hosted page.
                paymentOptions: {
                  card: { disable: true },
                  bank: { disable: true },
                  wallet: { disable: true },
                  momo: { enabledProviders: req.momoProviders },
                },
              }
            : {}),
        }),
      },
      3,
    );
    const r = body.result ?? {};
    const sessionId = typeof r.id === 'string' ? r.id : null;
    const redirectUrl = typeof r.redirectUrl === 'string' ? r.redirectUrl : null;
    if (!sessionId || !redirectUrl || !redirectUrl.startsWith('https://')) {
      throw new GatewayError('Monime returned an unexpected response', false);
    }
    return { sessionId, redirectUrl };
  }

  async listMomos(cfg: GatewayConfig, country: string): Promise<MomoProvider[]> {
    const out: MomoProvider[] = [];
    let after: string | null = null;
    for (let page = 0; page < 5; page++) {
      const q: URLSearchParams = new URLSearchParams({ country, limit: '50' });
      if (after) q.set('after', after);
      const res: MonimeEnvelope & { pagination?: { next?: string | null } } = await this.call(
        `${this.baseUrl}/momos?${q.toString()}`,
        { method: 'GET', headers: this.headers(cfg) },
        2,
      );
      const rows = (res as unknown as { result?: unknown }).result;
      for (const m of Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []) {
        const feature = (m.featureSet as { payment?: { canPayFrom?: unknown } } | undefined)
          ?.payment;
        if (typeof m.providerId !== 'string' || typeof m.name !== 'string') continue;
        out.push({
          providerId: m.providerId,
          name: m.name.slice(0, 80),
          active: (m.status as { active?: unknown } | undefined)?.active === true,
          canPayFrom: feature?.canPayFrom === true,
        });
      }
      after = res.pagination?.next ?? null;
      if (!after) break;
    }
    return out;
  }

  async getCheckout(cfg: GatewayConfig, sessionId: string): Promise<CheckoutState> {
    const body = await this.call(
      `${this.baseUrl}/checkout-sessions/${encodeURIComponent(sessionId)}`,
      { method: 'GET', headers: this.headers(cfg) },
      3,
    );
    const r = body.result ?? {};
    const raw = typeof r.status === 'string' ? r.status : '';
    const status: ProviderStatus = ['pending', 'completed', 'cancelled', 'expired'].includes(raw)
      ? (raw as ProviderStatus)
      : 'unknown';
    const items = (r.lineItems as { data?: unknown[] } | undefined)?.data;
    let total: number | null = null;
    let currency: string | null = null;
    if (Array.isArray(items) && items.length > 0) {
      total = 0;
      for (const it of items as {
        price?: { value?: unknown; currency?: unknown };
        quantity?: unknown;
      }[]) {
        const v = Number(it.price?.value);
        const q = Number(it.quantity ?? 1);
        if (!Number.isInteger(v) || !Number.isInteger(q)) {
          total = null;
          break;
        }
        total += v * q;
        if (typeof it.price?.currency === 'string') currency = it.price.currency;
      }
    }
    return {
      status,
      reference: typeof r.reference === 'string' ? r.reference : null,
      totalMinor: total,
      currency,
    };
  }
}
