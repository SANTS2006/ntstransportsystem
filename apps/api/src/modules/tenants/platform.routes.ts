import type { Request } from 'express';
import type { Router as ExpressRouter } from 'express';
import { Router } from '../../platform/router.js';
import { z } from 'zod';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { requireAuth } from '../authentication/session.middleware.js';
import { platformGuard, uuidParam } from './tenant.guards.js';
import { pageQuery } from './tenant.routes.js';
import { parseDate } from '../catalog/time.js';
import type { PlatformReportService } from '../report/platform-report.service.js';
import { TENANT_TRANSITIONS, type TenantAction, type TenantService } from './tenant.service.js';

const statusQuery = z
  .enum(['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'DEACTIVATED'])
  .optional();
const dateStr = z.string().refine((v) => {
  try {
    parseDate(v);
    return true;
  } catch {
    return false;
  }
}, 'Use a valid YYYY-MM-DD date');
const overviewQuery = z.object({ from: dateStr.optional(), to: dateStr.optional() });
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
const optionalReason = z.object({ reason: z.string().trim().max(300).optional() }).strict();

/** Actions that must carry a recorded justification. */
const REASON_REQUIRED: readonly TenantAction[] = ['reject', 'suspend', 'deactivate'];

export function platformRouter(
  db: Db,
  tenants: TenantService,
  reports?: PlatformReportService,
): ExpressRouter {
  const r = Router();
  // Lifecycle changes need OPERATIONS or SUPER_ADMIN; reads are open to support staff too.
  const readGuard = platformGuard(db, ['SUPER_ADMIN', 'OPERATIONS', 'SUPPORT']);
  const writeGuard = platformGuard(db, ['SUPER_ADMIN', 'OPERATIONS']);
  const actor = (req: Request) => {
    if (!req.platform) throw AppError.unauthenticated();
    return req.platform.userId;
  };

  r.get('/tenants', requireAuth, readGuard, async (req, res) => {
    const status = statusQuery.parse(req.query.status);
    res.json({ tenants: await tenants.listForPlatform(status, pageQuery(req)) });
  });

  if (reports) {
    r.get('/overview', requireAuth, readGuard, async (req, res) => {
      const q = overviewQuery.parse(req.query);
      const to = q.to ?? isoDay(new Date());
      const from = q.from ?? isoDay(new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000));
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(await reports.overview({ from, to }));
    });
  }

  for (const action of Object.keys(TENANT_TRANSITIONS) as TenantAction[]) {
    r.post(`/tenants/:id/${action}`, requireAuth, writeGuard, async (req, res) => {
      const body = REASON_REQUIRED.includes(action)
        ? reasonSchema.parse(req.body)
        : optionalReason.parse(req.body ?? {});
      res.json(
        await tenants.transition(actor(req), uuidParam(req, 'id'), action, body.reason, req.id),
      );
    });
  }
  return r;
}

/** Exposed so the OpenAPI document is generated from the exact schemas used for validation. */
export const requestSchemas = { reasonSchema, optionalReason };
