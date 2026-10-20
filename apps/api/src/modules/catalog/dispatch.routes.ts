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
import type { CalendarService } from './calendar.service.js';
import type { DispatchService } from './dispatch.service.js';
import type { SeatLayoutService } from './seatlayout.service.js';
import { parseDate } from './time.js';

const trim = z.string().trim();
const dateStr = z.string().refine((v) => {
  try {
    parseDate(v);
    return true;
  } catch {
    return false;
  }
}, 'Use a valid YYYY-MM-DD date');
const uuid = z.uuid();

const blackoutCreate = z
  .object({
    routeId: uuid.optional(),
    startsOn: dateStr,
    endsOn: dateStr,
    reason: trim.min(2).max(200),
  })
  .strict();

const seatLayoutCreate = z
  .object({
    name: trim.min(2).max(80),
    rows: z.number().int().min(1).max(60),
    columns: z.number().int().min(1).max(6),
    accessible: z.array(trim.min(2).max(4)).max(20).optional(),
  })
  .strict();

const rangeQuery = z.object({ from: dateStr.optional(), to: dateStr.optional() });
const dateQuery = z.object({ date: dateStr });

export interface DispatchRouterDeps {
  db: Db;
  calendar: CalendarService;
  layouts: SeatLayoutService;
  dispatch: DispatchService;
}

/** Service calendar, seat layouts and the dispatcher's day board, under /tenants/:tenantId. */
export function dispatchRouter({
  db,
  calendar,
  layouts,
  dispatch,
}: DispatchRouterDeps): ExpressRouter {
  const t = Router({ mergeParams: true });
  t.use(requireAuth, tenantScope(db));
  const audit = createDenialAuditor(db);
  const perm = (p: Permission) => requireTenantPermission(p, audit.permissionDenied);
  const scope = (req: Request): TenantScope => {
    if (!req.tenant) throw AppError.unauthenticated();
    return req.tenant;
  };

  t.get('/calendar/blackouts', perm('route.read'), async (req, res) => {
    const q = rangeQuery.parse(req.query);
    res.json({ items: await calendar.list(scope(req), q.from, q.to) });
  });
  t.post('/calendar/blackouts', perm('route.manage'), async (req, res) => {
    res.status(201).json(await calendar.create(scope(req), blackoutCreate.parse(req.body), req.id));
  });
  t.delete('/calendar/blackouts/:id', perm('route.manage'), async (req, res) => {
    await calendar.remove(scope(req), uuidParam(req, 'id'), req.id);
    res.status(204).end();
  });

  t.get('/seat-layouts', perm('fleet.read'), async (req, res) => {
    res.json({ items: await layouts.list(scope(req)) });
  });
  t.post('/seat-layouts', perm('fleet.manage'), async (req, res) => {
    res
      .status(201)
      .json(await layouts.create(scope(req), seatLayoutCreate.parse(req.body), req.id));
  });
  t.get('/seat-layouts/:id', perm('fleet.read'), async (req, res) => {
    res.json(await layouts.get(scope(req), uuidParam(req, 'id')));
  });
  t.delete('/seat-layouts/:id', perm('fleet.manage'), async (req, res) => {
    await layouts.remove(scope(req), uuidParam(req, 'id'), req.id);
    res.status(204).end();
  });

  t.get('/dispatch/board', perm('trip.read'), async (req, res) => {
    res.json(await dispatch.board(scope(req), dateQuery.parse(req.query).date));
  });
  t.get('/trips/:id/events', perm('trip.read'), async (req, res) => {
    res.json({ items: await dispatch.events(scope(req), uuidParam(req, 'id')) });
  });

  const r = Router();
  r.use('/tenants/:tenantId', t);
  return r;
}

/** Exposed so the OpenAPI document is generated from the exact schemas used for validation. */
export const requestSchemas = { blackoutCreate, seatLayoutCreate };
