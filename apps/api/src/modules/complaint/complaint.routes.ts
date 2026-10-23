import type { Permission } from '@nts/shared';
import type { Request, Router as ExpressRouter } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import type { RateLimitStoreFactory } from '../../platform/redis.js';
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
import { COMPLAINT_CATEGORIES, type ComplaintService } from './complaint.service.js';

const trim = z.string().trim();

const createBody = z
  .object({
    bookingId: z.uuid(),
    category: z.enum(COMPLAINT_CATEGORIES),
    subject: trim.min(3).max(150),
    // Optional when the passenger is sending a voice message instead (`voice: true`).
    body: trim.min(5).max(4000).optional(),
    voice: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.body !== undefined || v.voice === true, {
    message: 'Describe what happened, or record a voice message',
    path: ['body'],
  });
const messageBody = z.object({ body: trim.min(1).max(4000) }).strict();
const ratingBody = z
  .object({ rating: z.number().int().min(1).max(5), comment: trim.max(1000).optional() })
  .strict();
const statusBody = z.object({ status: z.enum(['IN_REVIEW', 'RESOLVED', 'CLOSED']) }).strict();
const listQuery = z.object({
  status: z.enum(['OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED']).optional(),
});

export interface ComplaintRouterDeps {
  db: Db;
  complaints: ComplaintService;
  env: Pick<Env, 'RATE_LIMIT_SCALE'>;
  rateLimitStores?: RateLimitStoreFactory | undefined;
}

export function complaintRouter({
  db,
  complaints,
  env,
  rateLimitStores,
}: ComplaintRouterDeps): ExpressRouter {
  const limit = (name: string, max: number) =>
    rateLimit({
      windowMs: 60_000,
      limit: max * env.RATE_LIMIT_SCALE,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      ...(rateLimitStores ? { store: rateLimitStores(`complaint:${name}`) } : {}),
      passOnStoreError: true,
      handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests')),
    });
  const userId = (req: Request) => {
    if (!req.auth) throw AppError.unauthenticated();
    return req.auth.userId;
  };

  // ---- Company staff, under /tenants/:tenantId ------------------------------------------------
  const t = Router({ mergeParams: true });
  t.use(requireAuth, tenantScope(db));
  const audit = createDenialAuditor(db);
  const perm = (p: Permission) => requireTenantPermission(p, audit.permissionDenied);
  const scope = (req: Request): TenantScope => {
    if (!req.tenant) throw AppError.unauthenticated();
    return req.tenant;
  };
  t.get('/complaints', perm('support.manage'), async (req, res) => {
    const q = listQuery.parse(req.query);
    res.json({ complaints: await complaints.list(scope(req), pageQuery(req), q.status) });
  });
  t.get('/complaints/:id', perm('support.manage'), async (req, res) => {
    res.json(await complaints.get(scope(req), uuidParam(req, 'id')));
  });
  t.post('/complaints/:id/messages', perm('support.manage'), async (req, res) => {
    await complaints.reply(
      scope(req),
      uuidParam(req, 'id'),
      messageBody.parse(req.body).body,
      req.id,
    );
    res.status(201).end();
  });
  t.post('/complaints/:id/status', perm('support.manage'), async (req, res) => {
    await complaints.setStatus(
      scope(req),
      uuidParam(req, 'id'),
      statusBody.parse(req.body).status,
      req.id,
    );
    res.status(204).end();
  });
  t.get('/ratings/summary', perm('booking.read'), async (req, res) => {
    res.json(await complaints.ratingsSummary(scope(req)));
  });

  // ---- Passengers ------------------------------------------------------------------------------
  const r = Router();
  r.use('/tenants/:tenantId', t);
  r.post('/passenger/complaints', requireAuth, limit('create', 5), async (req, res) => {
    res.status(201).json(await complaints.create(userId(req), createBody.parse(req.body), req.id));
  });
  r.get('/passenger/complaints', requireAuth, async (req, res) => {
    res.json({ complaints: await complaints.listOwn(userId(req)) });
  });
  r.get('/passenger/complaints/:id', requireAuth, async (req, res) => {
    res.json(await complaints.getOwn(userId(req), z.uuid().parse(req.params.id)));
  });
  r.post(
    '/passenger/complaints/:id/messages',
    requireAuth,
    limit('message', 20),
    async (req, res) => {
      await complaints.addPassengerMessage(
        userId(req),
        z.uuid().parse(req.params.id),
        messageBody.parse(req.body).body,
        req.id,
      );
      res.status(201).end();
    },
  );
  r.get('/passenger/bookings/:id/rating', requireAuth, async (req, res) => {
    res.json({ rating: await complaints.ratingFor(userId(req), z.uuid().parse(req.params.id)) });
  });
  r.post('/passenger/bookings/:id/rating', requireAuth, limit('rate', 10), async (req, res) => {
    await complaints.rate(
      userId(req),
      z.uuid().parse(req.params.id),
      ratingBody.parse(req.body),
      req.id,
    );
    res.status(201).end();
  });
  return r;
}

export const requestSchemas = { createBody, messageBody, ratingBody, statusBody };
