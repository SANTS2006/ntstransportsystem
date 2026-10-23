import type { Permission } from '@nts/shared';
import type { Request, Router as ExpressRouter } from 'express';
import { z } from 'zod';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { Router } from '../../platform/router.js';
import { requireAuth } from '../authentication/session.middleware.js';
import { createDenialAuditor } from '../tenants/tenant.audit.js';
import {
  requireTenantPermission,
  tenantScope,
  uuidParam,
  type TenantScope,
} from '../tenants/tenant.guards.js';
import { normalizePhone } from '@nts/shared';
import type { PaymentService } from './payment.service.js';

const settingsBody = z
  .object({
    spaceId: z
      .string()
      .trim()
      .regex(/^spc-[A-Za-z0-9_-]{1,60}$/, 'A Monime space id looks like spc-…'),
    apiToken: z
      .string()
      .trim()
      .regex(
        /^mon(_test)?_[A-Za-z0-9._-]{8,300}$/,
        'A Monime access token starts with mon_ or mon_test_',
      )
      .optional(),
    webhookSecret: z.string().min(32).max(256).optional(),
    enabled: z.boolean().default(true),
  })
  .strict();

const qmoneyBody = z
  .object({
    /** The QMoney number customers pay, or null to stop offering QMoney. */
    number: z
      .string()
      .trim()
      .max(40)
      .refine((v) => normalizePhone(v) !== null, 'Enter a valid phone number')
      .transform((v) => normalizePhone(v) as string)
      .nullable(),
    accountName: z.string().trim().min(1).max(80).nullable().optional(),
  })
  .strict();

export interface PaymentRouterDeps {
  db: Db;
  payments: PaymentService;
}

/** Company payment settings and per-booking payments, under /tenants/:tenantId. */
export function paymentRouter({ db, payments }: PaymentRouterDeps): ExpressRouter {
  const t = Router({ mergeParams: true });
  t.use(requireAuth, tenantScope(db));
  const audit = createDenialAuditor(db);
  const perm = (p: Permission) => requireTenantPermission(p, audit.permissionDenied);
  const scope = (req: Request): TenantScope => {
    if (!req.tenant) throw AppError.unauthenticated();
    return req.tenant;
  };

  t.get('/payment-settings', perm('payment.manage'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await payments.getSettings(scope(req)));
  });
  t.put('/payment-settings', perm('payment.manage'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await payments.putSettings(scope(req), settingsBody.parse(req.body), req.id));
  });

  t.get('/payment-settings/qmoney', perm('payment.read'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await payments.getQmoney(scope(req)));
  });
  t.put('/payment-settings/qmoney', perm('payment.manage'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await payments.putQmoney(scope(req), qmoneyBody.parse(req.body), req.id));
  });
  t.post('/bookings/:id/payments', perm('booking.manage'), async (req, res) => {
    res.status(201).json(await payments.start(scope(req), uuidParam(req, 'id'), req.id));
  });
  t.get('/bookings/:id/payments', perm('booking.read'), async (req, res) => {
    res.json({ payments: await payments.listForBooking(scope(req), uuidParam(req, 'id')) });
  });
  t.post('/payments/:id/refresh', perm('booking.manage'), async (req, res) => {
    res.json(await payments.refresh(scope(req), uuidParam(req, 'id')));
  });

  const r = Router();
  r.use('/tenants/:tenantId', t);
  return r;
}

/**
 * Public webhook receiver. Authenticated only by the HMAC signature of the raw body; the company
 * in the path just selects which secret to verify with.
 */
export function webhookRouter({ payments }: Pick<PaymentRouterDeps, 'payments'>): ExpressRouter {
  const r = Router();
  r.post('/webhooks/monime/:tenantId', async (req, res) => {
    const tenantId = z.uuid().safeParse(req.params.tenantId);
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!tenantId.success || !raw) {
      res.status(401).json({ status: 'invalid_signature' });
      return;
    }
    const out = await payments.handleWebhook(tenantId.data, raw, req.header('monime-signature'));
    res.status(out.status).json(out.body);
  });
  return r;
}

export const requestSchemas = { settingsBody, qmoneyBody };
