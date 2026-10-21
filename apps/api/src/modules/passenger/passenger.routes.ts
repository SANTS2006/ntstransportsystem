import type { Request, Router as ExpressRouter } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import { AppError } from '../../platform/errors.js';
import type { RateLimitStoreFactory } from '../../platform/redis.js';
import { Router } from '../../platform/router.js';
import { requireAuth } from '../authentication/session.middleware.js';
import { MAX_SEATS_PER_BOOKING } from '../booking/booking.service.js';
import { parseDate } from '../catalog/time.js';
import type { PassengerService } from './passenger.service.js';

const trim = z.string().trim();
const dateStr = z.string().refine((v) => {
  try {
    parseDate(v);
    return true;
  } catch {
    return false;
  }
}, 'Use a valid YYYY-MM-DD date');

const searchQuery = z.object({
  from: trim.min(1).max(80).optional(),
  to: trim.min(1).max(80).optional(),
  date: dateStr,
});
const bookingCreate = z
  .object({
    tenantId: z.uuid(),
    tripId: z.uuid(),
    serviceClass: trim.min(1).max(40).optional(),
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

export interface PassengerRouterDeps {
  passenger: PassengerService;
  env: Pick<Env, 'RATE_LIMIT_SCALE'>;
  rateLimitStores?: RateLimitStoreFactory | undefined;
}

/** Public trip search and signed-in passenger self-service. */
export function passengerRouter({
  passenger,
  env,
  rateLimitStores,
}: PassengerRouterDeps): ExpressRouter {
  const r = Router();
  const limit = (name: string, max: number) =>
    rateLimit({
      windowMs: 60_000,
      limit: max * env.RATE_LIMIT_SCALE,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      ...(rateLimitStores ? { store: rateLimitStores(`passenger:${name}`) } : {}),
      passOnStoreError: true,
      handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests')),
    });
  const userId = (req: Request) => {
    if (!req.auth) throw AppError.unauthenticated();
    return req.auth.userId;
  };

  // Public, read-only, rate limited.
  r.get('/public/trips', limit('search', 60), async (req, res) => {
    const q = searchQuery.parse(req.query);
    res.json({ trips: await passenger.search(q) });
  });
  r.get('/public/trips/:tenantId/:tripId', limit('detail', 60), async (req, res) => {
    const ids = z.object({ tenantId: z.uuid(), tripId: z.uuid() }).safeParse(req.params);
    if (!ids.success) throw AppError.notFound();
    res.json(await passenger.tripDetail(ids.data.tenantId, ids.data.tripId));
  });

  // Signed-in passengers.
  r.post('/passenger/bookings', requireAuth, limit('create', 10), async (req, res) => {
    const key = req.header('idempotency-key');
    if (key !== undefined && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) {
      throw AppError.validation('Idempotency-Key must be 8-100 letters, digits, - or _');
    }
    const b = bookingCreate.parse(req.body);
    const out = await passenger.create(
      userId(req),
      b.tenantId,
      {
        tripId: b.tripId,
        serviceClass: b.serviceClass,
        contact: b.contact,
        passengers: b.passengers,
      },
      key,
      req.id,
    );
    res.status(out.replayed ? 200 : 201).json(out.booking);
  });
  r.get('/passenger/bookings', requireAuth, async (req, res) => {
    res.json({ bookings: await passenger.list(userId(req)) });
  });
  r.get('/passenger/bookings/:id', requireAuth, async (req, res) => {
    res.json(await passenger.get(userId(req), z.uuid().parse(req.params.id)));
  });
  r.get('/passenger/bookings/:id/status', requireAuth, limit('status', 30), async (req, res) => {
    res.json(await passenger.status(userId(req), z.uuid().parse(req.params.id)));
  });
  r.post('/passenger/bookings/:id/pay', requireAuth, limit('pay', 10), async (req, res) => {
    res.status(201).json(await passenger.pay(userId(req), z.uuid().parse(req.params.id), req.id));
  });
  r.post('/passenger/bookings/:id/cancel', requireAuth, limit('cancel', 10), async (req, res) => {
    await passenger.cancel(userId(req), z.uuid().parse(req.params.id), req.id);
    res.status(204).end();
  });
  return r;
}

export const requestSchemas = { bookingCreate };
