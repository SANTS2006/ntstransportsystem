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
import { pageQuery } from '../tenants/tenant.routes.js';
import { MAX_SEATS_PER_BOOKING, type BookingService } from './booking.service.js';

const trim = z.string().trim();
const uuid = z.uuid();

const fareBody = z
  .object({
    amountMinor: z.number().int().min(0).max(100_000_000),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('SLE'),
    active: z.boolean().default(true),
  })
  .strict();

const stopFaresBody = z
  .object({
    fares: z
      .array(
        z
          .object({
            fromLocationId: uuid,
            toLocationId: uuid,
            amountMinor: z.number().int().min(0).max(1_000_000_000),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

const bookingCreate = z
  .object({
    tripId: uuid,
    serviceClass: trim.min(1).max(40).optional(),
    boardingLocationId: uuid.optional(),
    alightingLocationId: uuid.optional(),
    contact: z
      .object({
        name: trim.min(2).max(120),
        phone: trim.regex(/^\+?[0-9 ()-]{6,20}$/, 'Enter a valid phone number'),
        email: z.email().max(254).optional(),
      })
      .strict(),
    passengers: z
      .array(z.object({ fullName: trim.min(2).max(120), seatLabel: trim.min(1).max(8) }).strict())
      .min(1)
      .max(MAX_SEATS_PER_BOOKING),
  })
  .strict();

const cancelBody = z.object({ reason: trim.min(2).max(300) }).strict();
const deskRefundBody = z.object({ reference: trim.min(1).max(80).optional() }).strict();
const deskPaymentBody = z
  .object({
    method: z.enum([
      'CASH',
      'MOBILE_MONEY',
      'BANK_TRANSFER',
      'ORANGE_MONEY',
      'AFRIMONEY',
      'QMONEY',
    ]),
    reference: trim.min(1).max(80).optional(),
  })
  .strict();
const listQuery = z.object({
  status: z.enum(['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED']).optional(),
  tripId: uuid.optional(),
  q: trim.max(40).optional(),
});
const serviceClassParam = z.string().trim().min(1).max(40);

export interface BookingRouterDeps {
  db: Db;
  bookings: BookingService;
}

/** Staff-side bookings, fares and seat availability, under /tenants/:tenantId. */
export function bookingRouter({ db, bookings }: BookingRouterDeps): ExpressRouter {
  const t = Router({ mergeParams: true });
  t.use(requireAuth, tenantScope(db));
  const audit = createDenialAuditor(db);
  const perm = (p: Permission) => requireTenantPermission(p, audit.permissionDenied);
  const scope = (req: Request): TenantScope => {
    if (!req.tenant) throw AppError.unauthenticated();
    return req.tenant;
  };

  t.get('/routes/:id/fares', perm('route.read'), async (req, res) => {
    res.json({ fares: await bookings.listFares(scope(req), uuidParam(req, 'id')) });
  });
  t.get('/routes/:id/stop-fares', perm('route.read'), async (req, res) => {
    res.json(await bookings.listStopFares(scope(req), uuidParam(req, 'id')));
  });
  t.put('/routes/:id/stop-fares', perm('route.manage'), async (req, res) => {
    const b = stopFaresBody.parse(req.body);
    await bookings.setStopFares(scope(req), uuidParam(req, 'id'), b.fares, req.id);
    res.status(204).end();
  });
  t.put('/routes/:id/fares/:serviceClass', perm('route.manage'), async (req, res) => {
    const b = fareBody.parse(req.body);
    await bookings.setFare(
      scope(req),
      uuidParam(req, 'id'),
      serviceClassParam.parse(req.params.serviceClass),
      b.amountMinor,
      b.currency,
      b.active,
      req.id,
    );
    res.status(204).end();
  });

  t.get('/trips/:id/seats', perm('booking.read'), async (req, res) => {
    res.json(await bookings.seatMap(scope(req), uuidParam(req, 'id')));
  });

  t.post('/bookings', perm('booking.manage'), async (req, res) => {
    const key = req.header('idempotency-key');
    if (key !== undefined && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) {
      throw AppError.validation('Idempotency-Key must be 8-100 letters, digits, - or _');
    }
    const r = await bookings.create(scope(req), bookingCreate.parse(req.body), key, req.id);
    res.status(r.replayed ? 200 : 201).json(r.booking);
  });
  t.get('/bookings', perm('booking.read'), async (req, res) => {
    const q = listQuery.parse(req.query);
    res.json({ bookings: await bookings.list(scope(req), pageQuery(req), q) });
  });
  t.get('/bookings/:id', perm('booking.read'), async (req, res) => {
    res.json(await bookings.get(scope(req), uuidParam(req, 'id')));
  });
  t.post('/bookings/:id/cancel', perm('booking.manage'), async (req, res) => {
    res.json(
      await bookings.cancel(
        scope(req),
        uuidParam(req, 'id'),
        cancelBody.parse(req.body).reason,
        req.id,
      ),
    );
  });

  t.post('/bookings/:id/desk-payment', perm('payment.collect'), async (req, res) => {
    const body = deskPaymentBody.parse(req.body);
    res
      .status(201)
      .json(await bookings.collectAtDesk(scope(req), uuidParam(req, 'id'), body, req.id));
  });

  t.post('/bookings/:id/desk-refund', perm('payment.manage'), async (req, res) => {
    const body = deskRefundBody.parse(req.body ?? {});
    res.json(await bookings.refundDesk(scope(req), uuidParam(req, 'id'), body, req.id));
  });

  const r = Router();
  r.use('/tenants/:tenantId', t);
  return r;
}

/** Exposed so the OpenAPI document is generated from the exact schemas used for validation. */
export const requestSchemas = {
  fareBody,
  bookingCreate,
  stopFaresBody,
  cancelBody,
  deskPaymentBody,
  deskRefundBody,
};
