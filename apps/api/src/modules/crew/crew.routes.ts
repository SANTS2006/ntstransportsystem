import type { Permission } from '@nts/shared';
import type { Request } from 'express';
import type { Router as ExpressRouter } from 'express';
import { Router } from '../../platform/router.js';
import { z } from 'zod';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { requireAuth } from '../authentication/session.middleware.js';
import { parseDate } from '../catalog/time.js';
import { createDenialAuditor } from '../tenants/tenant.audit.js';
import {
  requireTenantPermission,
  tenantScope,
  uuidParam,
  type TenantScope,
} from '../tenants/tenant.guards.js';
import { pageQuery } from '../tenants/tenant.routes.js';
import type { CrewService } from './crew.service.js';
import type { MaintenanceService } from './maintenance.service.js';

const trim = z.string().trim();
const uuid = z.uuid();
const dateStr = z.string().refine((v) => {
  try {
    parseDate(v);
    return true;
  } catch {
    return false;
  }
}, 'Use a valid YYYY-MM-DD date');

const employeeCreate = z
  .object({
    employeeNumber: trim.min(1).max(30),
    fullName: trim.min(2).max(120),
    role: z.enum(['DRIVER', 'CONDUCTOR', 'DISPATCHER', 'MECHANIC', 'OTHER']),
    phone: trim.max(30).optional(),
    hiredOn: dateStr.optional(),
  })
  .strict();
const employeePatch = z
  .object({
    fullName: trim.min(2).max(120).optional(),
    role: z.enum(['DRIVER', 'CONDUCTOR', 'DISPATCHER', 'MECHANIC', 'OTHER']).optional(),
    status: z.enum(['ACTIVE', 'ON_LEAVE', 'TERMINATED']).optional(),
    phone: trim.max(30).optional(),
  })
  .strict();
const licenceBody = z
  .object({ licenceNumber: trim.min(3).max(40), category: trim.min(1).max(20), expiresOn: dateStr })
  .strict();
const crewBody = z.object({ employeeId: uuid, role: z.enum(['DRIVER', 'CONDUCTOR']) }).strict();
const maintenanceCreate = z
  .object({
    vehicleId: uuid,
    kind: z.enum(['SERVICE', 'REPAIR', 'INSPECTION']),
    scheduledFor: dateStr,
    description: trim.min(2).max(500),
    vendor: trim.max(120).optional(),
  })
  .strict();
const completeBody = z
  .object({
    odometerKm: z.number().int().min(0).max(10_000_000).optional(),
    costMinor: z.number().int().min(0).max(2_000_000_000).optional(),
  })
  .strict();
const documentBody = z
  .object({
    vehicleId: uuid,
    kind: z.enum(['INSURANCE', 'INSPECTION_CERTIFICATE', 'ROAD_LICENCE', 'OTHER']),
    referenceNo: trim.min(1).max(60),
    expiresOn: dateStr,
  })
  .strict();
const listQuery = z.object({
  role: z.string().max(20).optional(),
  status: z.string().max(20).optional(),
  q: trim.max(60).optional(),
  vehicleId: uuid.optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export interface CrewRouterDeps {
  db: Db;
  crew: CrewService;
  maintenance: MaintenanceService;
}

/** Staff, crew assignment, maintenance, vehicle documents and fleet alerts under /tenants/:tenantId. */
export function crewRouter({ db, crew, maintenance }: CrewRouterDeps): ExpressRouter {
  const t = Router({ mergeParams: true });
  t.use(requireAuth, tenantScope(db));
  const audit = createDenialAuditor(db);
  const perm = (p: Permission) => requireTenantPermission(p, audit.permissionDenied);
  const scope = (req: Request): TenantScope => {
    if (!req.tenant) throw AppError.unauthenticated();
    return req.tenant;
  };
  const enumOf = <T extends string>(
    v: string | undefined,
    allowed: readonly T[],
  ): T | undefined => {
    if (v === undefined) return undefined;
    if (!(allowed as readonly string[]).includes(v))
      throw AppError.validation('Invalid filter value');
    return v as T;
  };

  // Employees: full records need HR permissions (salary/personal data will live here later).
  t.get('/employees', perm('hr.read'), async (req, res) => {
    const q = listQuery.parse(req.query);
    res.json({
      employees: await crew.listEmployees(scope(req), pageQuery(req), {
        role: enumOf(q.role, ['DRIVER', 'CONDUCTOR', 'DISPATCHER', 'MECHANIC', 'OTHER'] as const),
        status: enumOf(q.status, ['ACTIVE', 'ON_LEAVE', 'TERMINATED'] as const),
        q: q.q,
      }),
    });
  });
  t.post('/employees', perm('hr.manage'), async (req, res) => {
    res
      .status(201)
      .json(await crew.createEmployee(scope(req), employeeCreate.parse(req.body), req.id));
  });
  t.patch('/employees/:id', perm('hr.manage'), async (req, res) => {
    await crew.updateEmployee(
      scope(req),
      uuidParam(req, 'id'),
      employeePatch.parse(req.body),
      req.id,
    );
    res.status(204).end();
  });
  t.get('/employees/:id/licences', perm('hr.read'), async (req, res) => {
    res.json({ licences: await crew.listLicences(scope(req), uuidParam(req, 'id')) });
  });
  t.post('/employees/:id/licences', perm('hr.manage'), async (req, res) => {
    res
      .status(201)
      .json(
        await crew.addLicence(
          scope(req),
          uuidParam(req, 'id'),
          licenceBody.parse(req.body),
          req.id,
        ),
      );
  });

  // Crew: a minimal roster for dispatchers, and per-trip assignment.
  t.get('/crew/roster', perm('trip.read'), async (req, res) => {
    res.json({ roster: await crew.roster(scope(req)) });
  });
  t.get('/trips/:id/crew', perm('trip.read'), async (req, res) => {
    res.json({ crew: await crew.listTripCrew(scope(req), uuidParam(req, 'id')) });
  });
  t.post('/trips/:id/crew', perm('trip.manage'), async (req, res) => {
    const b = crewBody.parse(req.body);
    await audit.guard(req, 'trips.crew_assign_denied', () =>
      crew.assign(scope(req), uuidParam(req, 'id'), b.employeeId, b.role, req.id),
    );
    res.status(204).end();
  });
  t.delete('/trips/:id/crew/:employeeId', perm('trip.manage'), async (req, res) => {
    await crew.release(scope(req), uuidParam(req, 'id'), uuidParam(req, 'employeeId'), req.id);
    res.status(204).end();
  });

  // Maintenance
  t.get('/maintenance', perm('fleet.read'), async (req, res) => {
    const q = listQuery.parse(req.query);
    res.json({
      records: await maintenance.list(scope(req), pageQuery(req), {
        vehicleId: q.vehicleId,
        status: enumOf(q.status, ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const),
      }),
    });
  });
  t.post('/maintenance', perm('fleet.manage'), async (req, res) => {
    res
      .status(201)
      .json(await maintenance.create(scope(req), maintenanceCreate.parse(req.body), req.id));
  });
  t.post('/maintenance/:id/start', perm('fleet.manage'), async (req, res) => {
    await maintenance.start(scope(req), uuidParam(req, 'id'), req.id);
    res.status(204).end();
  });
  t.post('/maintenance/:id/complete', perm('fleet.manage'), async (req, res) => {
    await maintenance.complete(
      scope(req),
      uuidParam(req, 'id'),
      completeBody.parse(req.body ?? {}),
      req.id,
    );
    res.status(204).end();
  });
  t.post('/maintenance/:id/cancel', perm('fleet.manage'), async (req, res) => {
    await maintenance.cancel(scope(req), uuidParam(req, 'id'), req.id);
    res.status(204).end();
  });

  // Vehicle documents
  t.get('/vehicles/:id/documents', perm('fleet.read'), async (req, res) => {
    res.json({ documents: await maintenance.listDocuments(scope(req), uuidParam(req, 'id')) });
  });
  t.post('/vehicle-documents', perm('fleet.manage'), async (req, res) => {
    res
      .status(201)
      .json(await maintenance.addDocument(scope(req), documentBody.parse(req.body), req.id));
  });
  t.delete('/vehicle-documents/:id', perm('fleet.manage'), async (req, res) => {
    await maintenance.removeDocument(scope(req), uuidParam(req, 'id'), req.id);
    res.status(204).end();
  });

  // Alerts. Driver licence expiries are HR data: included only for callers who may read HR records.
  t.get('/fleet/alerts', perm('fleet.read'), async (req, res) => {
    const s = scope(req);
    res.json(
      await maintenance.alerts(s, listQuery.parse(req.query).days, s.permissions.has('hr.read')),
    );
  });

  const r = Router();
  r.use('/tenants/:tenantId', t);
  return r;
}

/** Exposed so the OpenAPI document is generated from the exact schemas used for validation. */
export const requestSchemas = {
  employeeCreate,
  employeePatch,
  licenceBody,
  crewBody,
  maintenanceCreate,
  completeBody,
  documentBody,
};
