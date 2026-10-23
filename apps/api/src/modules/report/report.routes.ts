import type { Permission } from '@nts/shared';
import type { Request, Response, Router as ExpressRouter } from 'express';
import { z } from 'zod';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { Router } from '../../platform/router.js';
import { requireAuth } from '../authentication/session.middleware.js';
import { parseDate } from '../catalog/time.js';
import { createDenialAuditor } from '../tenants/tenant.audit.js';
import {
  requireTenantPermission,
  tenantScope,
  type TenantScope,
} from '../tenants/tenant.guards.js';
import { toCsv } from './csv.js';
import type { ReportService } from './report.service.js';

const dateStr = z.string().refine((v) => {
  try {
    parseDate(v);
    return true;
  } catch {
    return false;
  }
}, 'Use a valid YYYY-MM-DD date');
const rangeQuery = z.object({ from: dateStr, to: dateStr });
const salesQuery = rangeQuery.extend({ by: z.enum(['day', 'route']).default('day') });

const major = (minor: number) => (minor / 100).toFixed(2);

export interface ReportRouterDeps {
  db: Db;
  reports: ReportService;
}

/** Company reports under /tenants/:tenantId/reports, for roles with finance.report.read. */
export function reportRouter({ db, reports }: ReportRouterDeps): ExpressRouter {
  const t = Router({ mergeParams: true });
  t.use(requireAuth, tenantScope(db));
  const audit = createDenialAuditor(db);
  const perm = (p: Permission) => requireTenantPermission(p, audit.permissionDenied);
  const scope = (req: Request): TenantScope => {
    if (!req.tenant) throw AppError.unauthenticated();
    return req.tenant;
  };
  const noStore = (res: Response) => res.setHeader('Cache-Control', 'private, no-store');
  const csv = (res: Response, name: string, body: string) => {
    noStore(res);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.end(body);
  };

  t.get('/reports/summary', perm('finance.report.read'), async (req, res) => {
    noStore(res);
    res.json(await reports.summary(scope(req), rangeQuery.parse(req.query)));
  });
  t.get('/reports/sales', perm('finance.report.read'), async (req, res) => {
    const q = salesQuery.parse(req.query);
    noStore(res);
    res.json(await reports.sales(scope(req), { from: q.from, to: q.to }, q.by));
  });
  t.get('/reports/sales.csv', perm('finance.report.read'), async (req, res) => {
    const q = salesQuery.parse(req.query);
    const r = await reports.sales(scope(req), { from: q.from, to: q.to }, q.by);
    csv(
      res,
      `sales-${q.by}-${q.from}-${q.to}.csv`,
      toCsv(
        [q.by === 'day' ? 'Date' : 'Route', 'Bookings', 'Seats', 'Revenue'],
        r.rows.map((x) => [x.key, x.bookings, x.seats, major(x.revenueMinor)]),
      ),
    );
  });
  t.get('/reports/occupancy', perm('finance.report.read'), async (req, res) => {
    const q = rangeQuery.parse(req.query);
    noStore(res);
    res.json(await reports.occupancy(scope(req), q));
  });
  t.get('/reports/occupancy.csv', perm('finance.report.read'), async (req, res) => {
    const q = rangeQuery.parse(req.query);
    const r = await reports.occupancy(scope(req), q);
    csv(
      res,
      `occupancy-${q.from}-${q.to}.csv`,
      toCsv(
        [
          'Departure (UTC)',
          'Route',
          'Status',
          'Capacity',
          'Seats sold',
          'Boarded',
          'Occupancy %',
          'Revenue',
        ],
        r.trips.map((x) => [
          x.departureAt,
          x.route,
          x.status,
          x.capacity,
          x.sold,
          x.boarded,
          x.occupancyPct,
          major(x.revenueMinor),
        ]),
      ),
    );
  });

  const r = Router();
  r.use('/tenants/:tenantId', t);
  return r;
}

export const requestSchemas = {};
