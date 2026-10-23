import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { dbErrorKind, mapDbErrors } from '../../platform/db-errors.js';
import { withDb, type Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { enqueueOutbox } from '../../platform/outbox.js';
import type { SecretBox } from '../../platform/secretbox.js';
import { writeAudit } from '../audit/audit.js';
import { confirmBookingInTx } from '../booking/booking.service.js';
import type { TenantScope } from '../tenants/tenant.guards.js';
import {
  GatewayError,
  verifyMonimeSignature,
  type GatewayConfig,
  type MomoProvider,
  type PaymentGateway,
} from './gateway.js';
import {
  METHOD_LABEL,
  PAYMENT_COUNTRY,
  PAY_METHODS,
  findMomo,
  type PayMethod,
  type PayOption,
} from './methods.js';

const ctxOf = (s: TenantScope) => ({ tenantId: s.tenantId, userId: s.userId });
const PAYMENT_WINDOW_MINUTES = 20;
/** How long seats stay held once a passenger says they paid by QMoney, while staff check. */
const CLAIM_HOLD_MINUTES = 120;
const MAX_CLAIMS_PER_BOOKING = 3;

export interface PaymentServiceOptions {
  /** Public base URL of the web app (success/cancel redirects). */
  appUrl: string;
  /** Public base URL of this API (shown to the admin as the webhook address). */
  apiUrl: string;
}

const webhookSchema = z.object({
  event: z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(100) }),
  data: z.object({ id: z.string().min(1).max(200) }).passthrough(),
});

export type WebhookResult =
  { status: 200; body: { status: string } } | { status: 401 | 400 | 503; body: { status: string } };

export class PaymentService {
  constructor(
    private readonly db: Db,
    private readonly box: SecretBox,
    private readonly gateway: PaymentGateway,
    private readonly opts: PaymentServiceOptions,
  ) {}

  // ---- Company settings -----------------------------------------------------------------------

  webhookUrl(tenantId: string) {
    return `${this.opts.apiUrl.replace(/\/$/, '')}/api/v1/webhooks/monime/${tenantId}`;
  }

  async getSettings(s: TenantScope) {
    const row = await withDb(this.db, ctxOf(s), (tx) =>
      tx.paymentSettings.findFirst({ where: { tenantId: s.tenantId } }),
    );
    return {
      configured: row !== null,
      enabled: row?.enabled ?? false,
      spaceId: row?.spaceId ?? null,
      webhookUrl: this.webhookUrl(s.tenantId),
    };
  }

  /**
   * Saves a company's Monime credentials. Secrets are encrypted and never returned. If no webhook
   * secret is supplied on first setup one is generated and returned once, to be pasted into the
   * Monime dashboard when registering the webhook.
   */
  async putSettings(
    s: TenantScope,
    input: {
      spaceId: string;
      apiToken?: string | undefined;
      webhookSecret?: string | undefined;
      enabled: boolean;
    },
    requestId?: string,
  ) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const existing = await tx.paymentSettings.findFirst({ where: { tenantId: s.tenantId } });
      if (!existing && !input.apiToken)
        throw AppError.validation('The Monime API token is required');
      let generated: string | null = null;
      let webhookSecret = input.webhookSecret;
      if (!existing && !webhookSecret) {
        generated = randomBytes(32).toString('base64url');
        webhookSecret = generated;
      }
      const data = {
        spaceId: input.spaceId,
        enabled: input.enabled,
        ...(input.apiToken ? { apiTokenEnc: this.box.encrypt(input.apiToken) } : {}),
        ...(webhookSecret ? { webhookSecretEnc: this.box.encrypt(webhookSecret) } : {}),
      };
      if (existing) {
        await tx.paymentSettings.update({ where: { tenantId: s.tenantId }, data });
      } else {
        await tx.paymentSettings.create({
          data: {
            tenantId: s.tenantId,
            spaceId: input.spaceId,
            enabled: input.enabled,
            apiTokenEnc: this.box.encrypt(input.apiToken as string),
            webhookSecretEnc: this.box.encrypt(webhookSecret as string),
          },
        });
      }
      await writeAudit(tx, {
        action: 'payment.settings_saved',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'payment_settings',
        targetId: s.tenantId,
        requestId,
        summary: {
          enabled: input.enabled,
          tokenChanged: Boolean(input.apiToken),
          secretChanged: Boolean(webhookSecret),
        },
      });
      return { webhookSecret: generated, webhookUrl: this.webhookUrl(s.tenantId) };
    });
  }

  private async loadConfig(
    tenantId: string,
    requireEnabled: boolean,
  ): Promise<(GatewayConfig & { webhookSecret: string }) | null> {
    const row = await withDb(this.db, { tenantId }, (tx) =>
      tx.paymentSettings.findFirst({ where: { tenantId } }),
    );
    if (!row || (requireEnabled && !row.enabled)) return null;
    return {
      token: this.box.decrypt(row.apiTokenEnc),
      spaceId: row.spaceId,
      webhookSecret: this.box.decrypt(row.webhookSecretEnc),
    };
  }

  // ---- Start a payment ------------------------------------------------------------------------

  /**
   * Creates (or returns the open) hosted-checkout payment for a booking. The amount comes from the
   * booking's own price snapshot, never from the caller. The provider is called outside any
   * database transaction.
   */
  async start(
    s: TenantScope,
    bookingId: string,
    requestId?: string,
    method?: PayMethod | 'ONLINE',
  ) {
    const cfg = await this.loadConfig(s.tenantId, true);
    if (!cfg) throw AppError.conflict('Online payments are not set up for this company');
    // A chosen wallet must be one Monime really lists for this company; its id comes from Monime.
    let momoProviders: string[] | undefined;
    let chosen: PayMethod | null = null;
    if (method && method !== 'ONLINE') {
      const found = findMomo(method, (await this.momos(s.tenantId, cfg)) ?? []);
      if (!found) throw AppError.conflict('That payment method is not available right now');
      momoProviders = [found.providerId];
      chosen = method;
    }

    const prepared = await withDb(this.db, ctxOf(s), async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, tenantId: s.tenantId },
        include: { passengers: { where: { releasedAt: null } } },
      });
      if (!booking) throw AppError.notFound();
      if (booking.status !== 'PENDING_PAYMENT') {
        throw AppError.conflict('This booking is not waiting for payment');
      }
      if (booking.totalMinor <= 0) throw AppError.conflict('There is nothing to pay');
      const open = await tx.payment.findFirst({
        where: { tenantId: s.tenantId, bookingId, status: { in: ['CREATED', 'PENDING'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (open?.status === 'PENDING' && open.redirectUrl && (open.method ?? null) === chosen) {
        return { reuse: { paymentId: open.id, redirectUrl: open.redirectUrl } } as const;
      }
      if (open) {
        // A CREATED attempt whose provider call never finished, or an open checkout for another
        // wallet than the one chosen now: retire it and start over. (If the customer does finish the
        // old one, settle() still recognises it and flags the double payment.)
        await tx.payment.updateMany({
          where: { id: open.id },
          data: {
            status: open.status === 'PENDING' ? 'CANCELLED' : 'FAILED',
            lastError: 'Superseded',
          },
        });
      }
      // Give the customer time to pay: extend the hold once, on the first attempt.
      const attempts = await tx.payment.count({ where: { tenantId: s.tenantId, bookingId } });
      if (attempts === 0) {
        const until = new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60_000);
        if (!booking.holdExpiresAt || booking.holdExpiresAt < until) {
          await tx.booking.update({ where: { id: bookingId }, data: { holdExpiresAt: until } });
        }
      }
      const payment = await tx.payment.create({
        data: {
          tenantId: s.tenantId,
          bookingId,
          amountMinor: booking.totalMinor,
          currency: booking.currency,
          method: chosen,
          idempotencyKey: `nts-pay-${randomBytes(18).toString('hex')}`,
        },
      });
      return { payment, booking } as const;
    });
    if ('reuse' in prepared) return { ...prepared.reuse, reused: true };

    const { payment, booking } = prepared;
    try {
      const created = await this.gateway.createCheckout(cfg, {
        idempotencyKey: payment.idempotencyKey,
        reference: payment.id,
        name: `Bus ticket ${booking.reference}`,
        currency: payment.currency,
        lineItems: booking.passengers.map((p) => ({
          name: `Seat ${p.seatLabel}`,
          amountMinor: p.fareMinor,
          quantity: 1,
          reference: `seat-${p.seatLabel}`,
        })),
        successUrl: `${this.opts.appUrl}/pay/return?booking=${booking.id}&tenant=${s.tenantId}&result=success`,
        cancelUrl: `${this.opts.appUrl}/pay/return?booking=${booking.id}&tenant=${s.tenantId}&result=cancelled`,
        metadata: { tenantId: s.tenantId, bookingId: booking.id, paymentId: payment.id },
        momoProviders,
      });
      await withDb(this.db, ctxOf(s), async (tx) => {
        await tx.payment.updateMany({
          where: { id: payment.id, status: 'CREATED' },
          data: {
            status: 'PENDING',
            providerSessionId: created.sessionId,
            redirectUrl: created.redirectUrl,
          },
        });
        await writeAudit(tx, {
          action: 'payment.started',
          outcome: 'SUCCESS',
          tenantId: s.tenantId,
          actorUserId: s.userId,
          targetType: 'payment',
          targetId: payment.id,
          requestId,
          summary: { amountMinor: payment.amountMinor, method: chosen },
        });
      });
      return { paymentId: payment.id, redirectUrl: created.redirectUrl, reused: false };
    } catch (err) {
      const message = err instanceof GatewayError ? err.message : 'Provider error';
      await withDb(this.db, ctxOf(s), (tx) =>
        tx.payment.updateMany({
          where: { id: payment.id, status: 'CREATED' },
          data: { status: 'FAILED', lastError: message.slice(0, 300) },
        }),
      );
      throw new AppError(
        502,
        'PAYMENT_PROVIDER_ERROR',
        'The payment provider could not start the payment. Please try again.',
      );
    }
  }

  // ---- Which ways of paying are on offer ---------------------------------------------------------

  private readonly momoCache = new Map<string, { at: number; momos: MomoProvider[] | null }>();

  /** Monime's mobile-money providers for this company, remembered for ten minutes (one minute if Monime could not be reached). */
  private async momos(tenantId: string, cfg: GatewayConfig): Promise<MomoProvider[] | null> {
    const hit = this.momoCache.get(tenantId);
    const age = hit ? Date.now() - hit.at : Infinity;
    if (hit && age < (hit.momos ? 10 * 60_000 : 60_000)) return hit.momos;
    let momos: MomoProvider[] | null;
    try {
      momos = await this.gateway.listMomos(cfg, PAYMENT_COUNTRY);
    } catch {
      momos = null;
    }
    this.momoCache.set(tenantId, { at: Date.now(), momos });
    return momos;
  }

  /**
   * The ways a passenger can pay a booking of this company: Orange Money, AfriMoney and QMoney
   * through Monime when Monime lists them; otherwise one generic "pay online" choice (Monime's page
   * shows what the company has enabled); and QMoney paid straight to the company's own number when
   * the company has set one up and Monime does not offer QMoney.
   */
  async options(s: TenantScope): Promise<PayOption[]> {
    const cfg = await this.loadConfig(s.tenantId, true);
    const manual = await withDb(this.db, ctxOf(s), (tx) =>
      tx.manualPaymentSettings.findFirst({ where: { tenantId: s.tenantId } }),
    );
    const out: PayOption[] = [];
    let qmoneyOnline = false;
    if (cfg) {
      const momos = await this.momos(s.tenantId, cfg);
      const known = momos ? PAY_METHODS.filter((m) => findMomo(m, momos)) : [];
      if (known.length === 0) {
        out.push({ method: 'ONLINE', label: METHOD_LABEL.ONLINE, kind: 'ONLINE' });
      }
      for (const m of known) {
        out.push({ method: m, label: METHOD_LABEL[m], kind: 'ONLINE' });
        if (m === 'QMONEY') qmoneyOnline = true;
      }
    }
    if (manual?.qmoneyNumber && !qmoneyOnline) {
      out.push({
        method: 'QMONEY',
        label: METHOD_LABEL.QMONEY,
        kind: 'MANUAL',
        manual: { number: manual.qmoneyNumber, accountName: manual.qmoneyAccountName },
      });
    }
    return out;
  }

  async getQmoney(s: TenantScope) {
    const row = await withDb(this.db, ctxOf(s), (tx) =>
      tx.manualPaymentSettings.findFirst({ where: { tenantId: s.tenantId } }),
    );
    return { number: row?.qmoneyNumber ?? null, accountName: row?.qmoneyAccountName ?? null };
  }

  /** The company's own QMoney number (and the name on it), or clears it with null. */
  async putQmoney(
    s: TenantScope,
    input: { number: string | null; accountName?: string | null | undefined },
    requestId?: string,
  ) {
    const data = {
      qmoneyNumber: input.number,
      qmoneyAccountName: input.number ? (input.accountName ?? null) : null,
      updatedBy: s.userId,
    };
    await withDb(this.db, ctxOf(s), async (tx) => {
      await tx.manualPaymentSettings.upsert({
        where: { tenantId: s.tenantId },
        create: { tenantId: s.tenantId, ...data },
        update: data,
      });
      await writeAudit(tx, {
        action: 'payment.qmoney_settings_saved',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'payment_settings',
        requestId,
        summary: { configured: input.number !== null },
      });
    });
    return this.getQmoney(s);
  }

  /**
   * A passenger says they paid a booking with QMoney and gives the transaction number. This confirms
   * nothing: it tells staff what to look for on their QMoney statement and gives the passenger time
   * (the seats stay held for two hours). Staff confirm with "take payment" (QMoney).
   */
  async submitClaim(
    s: TenantScope,
    bookingId: string,
    input: { reference: string },
    requestId?: string,
  ) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const manual = await tx.manualPaymentSettings.findFirst({
            where: { tenantId: s.tenantId },
          });
          if (!manual?.qmoneyNumber)
            throw AppError.conflict('QMoney is not available for this company');
          const b = await tx.booking.findFirst({ where: { id: bookingId, tenantId: s.tenantId } });
          if (!b) throw AppError.notFound();
          if (b.status !== 'PENDING_PAYMENT') {
            throw AppError.conflict('This booking is not waiting for payment');
          }
          const earlier = await tx.paymentClaim.count({
            where: { tenantId: s.tenantId, bookingId },
          });
          if (earlier >= MAX_CLAIMS_PER_BOOKING) {
            throw AppError.conflict(
              'Too many payment notices for this booking. Please contact the company.',
            );
          }
          const claim = await tx.paymentClaim.create({
            data: {
              tenantId: s.tenantId,
              bookingId,
              method: 'QMONEY',
              reference: input.reference,
              createdBy: s.userId,
            },
          });
          const until = new Date(Date.now() + CLAIM_HOLD_MINUTES * 60_000);
          const hold = !b.holdExpiresAt || b.holdExpiresAt < until ? until : b.holdExpiresAt;
          if (hold !== b.holdExpiresAt) {
            await tx.booking.update({ where: { id: bookingId }, data: { holdExpiresAt: hold } });
          }
          await writeAudit(tx, {
            action: 'payment.claim_submitted',
            outcome: 'SUCCESS',
            tenantId: s.tenantId,
            actorUserId: s.userId,
            targetType: 'booking',
            targetId: bookingId,
            requestId,
            summary: { method: 'QMONEY' },
          });
          return { claimId: claim.id, holdExpiresAt: hold.toISOString() };
        }),
      { unique: 'That transaction number has already been used for a booking' },
    );
  }

  async listForBooking(s: TenantScope, bookingId: string) {
    const rows = await withDb(this.db, ctxOf(s), async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, tenantId: s.tenantId },
        select: { id: true },
      });
      if (!booking) throw AppError.notFound();
      return tx.payment.findMany({
        where: { tenantId: s.tenantId, bookingId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
    });
    return rows.map((p) => ({
      id: p.id,
      provider: p.provider,
      method: p.method,
      reference: p.reference,
      status: p.status,
      amountMinor: p.amountMinor,
      currency: p.currency,
      paidAt: p.paidAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    }));
  }

  // ---- Settle (verify with the provider, then confirm) -----------------------------------------

  /**
   * Asks the provider for the session's real state and applies it. This is the only place a
   * payment becomes PAID, and it is used by the webhook and by manual/automatic reconciliation, so
   * neither a forged webhook nor a redirect can confirm a booking on its own.
   */
  async settle(tenantId: string, paymentId: string): Promise<string> {
    const cfg = await this.loadConfig(tenantId, false);
    if (!cfg) return 'no_settings';
    const payment = await withDb(this.db, { tenantId }, (tx) =>
      tx.payment.findFirst({ where: { id: paymentId, tenantId } }),
    );
    if (!payment || !payment.providerSessionId) return 'unknown_payment';
    if (['PAID', 'PAID_UNFULFILLED'].includes(payment.status)) return 'already_settled';

    const state = await this.gateway.getCheckout(cfg, payment.providerSessionId); // may throw: caller retries

    return withDb(this.db, { tenantId }, async (tx) => {
      const close = async (status: 'EXPIRED' | 'CANCELLED' | 'FAILED', why?: string) => {
        await tx.payment.updateMany({
          where: { id: paymentId, status: { in: ['CREATED', 'PENDING'] } },
          data: { status, ...(why ? { lastError: why } : {}) },
        });
        return status.toLowerCase();
      };
      if (state.status === 'expired') return close('EXPIRED');
      if (state.status === 'cancelled') return close('CANCELLED');
      if (state.status !== 'completed') return 'still_pending';

      // The provider says completed. Make sure it is OUR session for THIS payment and amount.
      if (state.reference !== payment.id) return close('FAILED', 'Reference mismatch');
      if (
        state.totalMinor !== null &&
        (state.totalMinor !== payment.amountMinor ||
          (state.currency && state.currency !== payment.currency))
      ) {
        return close('FAILED', 'Amount mismatch');
      }

      const res = await tx.payment.updateMany({
        where: {
          id: paymentId,
          status: { in: ['CREATED', 'PENDING', 'FAILED', 'EXPIRED', 'CANCELLED'] },
        },
        data: { paidAt: new Date(), status: 'PAID' },
      });
      if (res.count !== 1) return 'already_settled';

      const outcome = await confirmBookingInTx(tx, tenantId, payment.bookingId);
      // 'already' with another settled payment on the booking (typically paid at the desk while this
      // checkout was still open) means the customer has paid twice: this one needs a refund.
      const duplicate =
        outcome === 'already' &&
        (await tx.payment.count({
          where: {
            tenantId,
            bookingId: payment.bookingId,
            status: 'PAID',
            id: { not: paymentId },
          },
        })) > 0;
      if (outcome === 'unavailable' || duplicate) {
        // Paid, but the seats were already released (hold lapsed and resold, or cancelled), or the
        // booking had already been paid another way.
        await tx.payment.updateMany({
          where: { id: paymentId },
          data: { status: 'PAID_UNFULFILLED' },
        });
        await enqueueOutbox(tx, {
          tenantId,
          type: 'payment.refund_required',
          payload: {
            paymentId,
            bookingId: payment.bookingId,
            amountMinor: payment.amountMinor,
            currency: payment.currency,
          },
          dedupeKey: `payment.refund_required:${paymentId}`,
        });
        await writeAudit(tx, {
          action: 'payment.paid_unfulfilled',
          outcome: 'FAILURE',
          tenantId,
          targetType: 'payment',
          targetId: paymentId,
          summary: { amountMinor: payment.amountMinor },
        });
        return 'paid_unfulfilled';
      }
      await writeAudit(tx, {
        action: 'payment.paid',
        outcome: 'SUCCESS',
        tenantId,
        targetType: 'payment',
        targetId: paymentId,
        summary: { amountMinor: payment.amountMinor },
      });
      return 'paid';
    });
  }

  /** Staff "check payment status": covers a missed webhook. */
  async refresh(s: TenantScope, paymentId: string) {
    const p = await withDb(this.db, ctxOf(s), (tx) =>
      tx.payment.findFirst({ where: { id: paymentId, tenantId: s.tenantId } }),
    );
    if (!p) throw AppError.notFound();
    try {
      const outcome = await this.settle(s.tenantId, paymentId);
      return { outcome };
    } catch {
      throw new AppError(
        502,
        'PAYMENT_PROVIDER_ERROR',
        'Could not reach the payment provider. Please try again.',
      );
    }
  }

  // ---- Webhook ------------------------------------------------------------------------------

  /**
   * Handles a Monime delivery. Order matters: signature first (nothing else is trusted before it),
   * then replay record, then re-verification with the provider. Returns 503 for transient provider
   * errors so Monime retries; unknown or irrelevant events are acknowledged with 200.
   */
  async handleWebhook(
    tenantId: string,
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): Promise<WebhookResult> {
    const cfg = await this.loadConfig(tenantId, false);
    // Same answer for "no such company" and "bad signature": nothing to learn from probing.
    if (!cfg || !verifyMonimeSignature(signatureHeader, rawBody, cfg.webhookSecret)) {
      return { status: 401, body: { status: 'invalid_signature' } };
    }
    let parsed: z.infer<typeof webhookSchema>;
    try {
      parsed = webhookSchema.parse(JSON.parse(rawBody.toString('utf8')));
    } catch {
      return { status: 400, body: { status: 'invalid_payload' } };
    }
    const { event, data } = parsed;

    const record = async (outcome: string) => {
      try {
        await withDb(this.db, { tenantId }, (tx) =>
          tx.paymentWebhookEvent.createMany({
            data: [
              {
                tenantId,
                eventId: event.id,
                name: event.name.slice(0, 100),
                outcome: outcome.slice(0, 60),
              },
            ],
          }),
        );
      } catch (err) {
        if (dbErrorKind(err) !== 'unique') throw err;
      }
    };
    const seen = await withDb(this.db, { tenantId }, (tx) =>
      tx.paymentWebhookEvent.findFirst({ where: { tenantId, eventId: event.id } }),
    );
    if (seen) return { status: 200, body: { status: 'duplicate' } };

    if (!event.name.startsWith('checkout_session.')) {
      await record('ignored');
      return { status: 200, body: { status: 'ignored' } };
    }
    const payment = await withDb(this.db, { tenantId }, (tx) =>
      tx.payment.findFirst({ where: { tenantId, providerSessionId: data.id } }),
    );
    if (!payment) {
      await record('unknown_session');
      return { status: 200, body: { status: 'unknown_session' } };
    }
    try {
      const outcome = await this.settle(tenantId, payment.id);
      await record(outcome);
      return { status: 200, body: { status: outcome } };
    } catch {
      // Not recorded, so the retry is processed.
      return { status: 503, body: { status: 'provider_unavailable' } };
    }
  }
}
