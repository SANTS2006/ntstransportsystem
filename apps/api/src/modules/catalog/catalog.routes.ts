import type { Permission } from '@nts/shared';
import type { Request } from 'express';
import type { Router as ExpressRouter } from 'express';
import { Router } from '../../platform/router.js';
import { z } from 'zod';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { requireAuth } from '../authentication/session.middleware.js';
import { createDenialAuditor } from '../tenants/tenant.audit.js';
import {
  requireTenantPermission,
  tenantScope,
  uuidParam,
  type TenantScope,
} from '../tenants/tenant.guards.js';
import { pageQuery } from '../tenants/tenant.routes.js';
import type { CatalogService } from './catalog.service.js';
import type { FleetService } from './fleet.service.js';
import type { ScheduleService } from './schedule.service.js';
import { isValidTimezone, parseDate } from './time.js';

const trim = z.string().trim();
const dateStr = z.string().refine((v) => {
  try {
    parseDate(v);
    return true;
  } catch {
    return false;
  }
}, 'Use a valid YYYY-MM-DD date');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');
const uuid = z.uuid();

const locationBase = z.object({
  name: trim.min(2).max(120),
  kind: z.enum(['TERMINAL', 'STATION', 'STOP', 'DEPOT']),
  city: trim.min(1).max(80),
  address: trim.max(200).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  active: z.boolean().optional(),
});
const locationCreate = locationBase
  .strict()
  .refine(
    (v) => (v.latitude === undefined) === (v.longitude === undefined),
    'Give both latitude and longitude, or neither',
  );
const locationPatch = locationBase.partial().strict();

const vehicleTypeEnum = z.enum(['BUS', 'MINIBUS', 'SHARED_TAXI', 'TAXI', 'SHUTTLE', 'OTHER']);

const routeBase = z.object({
  name: trim.min(2).max(120),
  originId: uuid,
  destinationId: uuid,
  distanceM: z.number().int().min(1).max(5_000_000),
  durationMin: z.number().int().min(1).max(2_880),
  stops: z
    .array(z.object({ locationId: uuid, offsetMin: z.number().int().min(1).max(2_880) }).strict())
    .max(40),
  allowedVehicleTypes: z.array(vehicleTypeEnum).max(6).optional(),
  minSeats: z.number().int().min(1).max(200).optional(),
});
const routeCreate = routeBase.strict();
const routePatch = routeBase.partial().strict();

const vehicleBase = z.object({
  registration: trim.min(2).max(20),
  label: trim.max(60).optional(),
  type: z.enum(['BUS', 'MINIBUS', 'SHARED_TAXI', 'TAXI', 'SHUTTLE', 'OTHER']),
  make: trim.max(60).optional(),
  model: trim.max(60).optional(),
  year: z.number().int().min(1950).max(2100).optional(),
  seatingCapacity: z.number().int().min(1).max(200),
  odometerKm: z.number().int().min(0).max(10_000_000).optional(),
  seatLayoutId: uuid.optional(),
});
const vehicleCreate = vehicleBase.strict();
const vehiclePatch = vehicleBase
  .omit({ registration: true })
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'MAINTENANCE', 'RETIRED']).optional() })
  .strict();

const scheduleCreate = z
  .object({
    routeId: uuid,
    departureTime: hhmm,
    daysOfWeek: z.number().int().min(1).max(127),
    validFrom: dateStr,
    validTo: dateStr.optional(),
    defaultVehicleId: uuid.optional(),
    serviceClass: trim.max(40).optional(),
  })
  .strict()
  .refine((v) => !v.validTo || v.validTo >= v.validFrom, 'validTo must not be before validFrom');
const generateBody = z.object({ from: dateStr, to: dateStr }).strict();
const assignBody = z.object({ vehicleId: uuid.nullable() }).strict();
const statusBody = z
  .object({ status: z.enum(['BOARDING', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED']) })
  .strict();
const replaceBody = z
  .object({
    vehicleId: uuid,
    reason: trim.min(2).max(300),
    markOldOutOfService: z.boolean().default(false),
  })
  .strict();
const delayBody = z.object({ delayMinutes: z.number().int().min(0).max(1_440) }).strict();

const listQuery = z.object({
  q: trim.max(60).optional(),
  status: z.string().max(20).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  routeId: uuid.optional(),
  vehicleId: uuid.optional(),
});

export interface CatalogRouterDeps {
  db: Db;
  catalog: CatalogService;
  fleet: FleetService;
  schedules: ScheduleService;
}

/** Transport catalog, fleet and trips, all under /tenants/:tenantId and gated by tenant permissions. */
export function catalogRouter({ db, catalog, fleet, schedules }: CatalogRouterDeps): ExpressRouter {
  const t = Router({ mergeParams: true });
  t.use(requireAuth, tenantScope(db));
  const audit = createDenialAuditor(db);
  const perm = (p: Permission) => requireTenantPermission(p, audit.permissionDenied);
  const scope = (req: Request): TenantScope => {
    if (!req.tenant) throw AppError.unauthenticated();
    return req.tenant;
  };
  const query = (req: Request) => listQuery.parse(req.query);
  const enumOf = <T extends string>(
    v: string | undefined,
    allowed: readonly T[],
  ): T | undefined => {
    if (v === undefined) return undefined;
    if (!(allowed as readonly string[]).includes(v))
      throw AppError.validation('Invalid filter value');
    return v as T;
  };

  // Locations
  t.get('/locations', perm('route.read'), async (req, res) => {
    res.json({ locations: await catalog.listLocations(scope(req), pageQuery(req), query(req).q) });
  });
  t.post('/locations', perm('route.manage'), async (req, res) => {
    res
      .status(201)
      .json(await catalog.createLocation(scope(req), locationCreate.parse(req.body), req.id));
  });
  t.patch('/locations/:id', perm('route.manage'), async (req, res) => {
    res.json(
      await catalog.updateLocation(
        scope(req),
        uuidParam(req, 'id'),
        locationPatch.parse(req.body),
        req.id,
      ),
    );
  });
  t.delete('/locations/:id', perm('route.manage'), async (req, res) => {
    await catalog.deleteLocation(scope(req), uuidParam(req, 'id'), req.id);
    res.status(204).end();
  });

  // Routes
  t.get('/routes', perm('route.read'), async (req, res) => {
    const status = enumOf(query(req).status, ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const);
    res.json({ routes: await catalog.listRoutes(scope(req), pageQuery(req), status) });
  });
  t.post('/routes', perm('route.manage'), async (req, res) => {
    res
      .status(201)
      .json(await catalog.createRoute(scope(req), routeCreate.parse(req.body), req.id));
  });
  t.get('/routes/:id', perm('route.read'), async (req, res) => {
    res.json(await catalog.getRoute(scope(req), uuidParam(req, 'id')));
  });
  t.patch('/routes/:id', perm('route.manage'), async (req, res) => {
    await catalog.updateRoute(scope(req), uuidParam(req, 'id'), routePatch.parse(req.body), req.id);
    res.status(204).end();
  });
  t.post('/routes/:id/publish', perm('route.manage'), async (req, res) => {
    await catalog.setRouteStatus(scope(req), uuidParam(req, 'id'), 'publish', req.id);
    res.status(204).end();
  });
  t.post('/routes/:id/archive', perm('route.manage'), async (req, res) => {
    await catalog.setRouteStatus(scope(req), uuidParam(req, 'id'), 'archive', req.id);
    res.status(204).end();
  });
  t.delete('/routes/:id', perm('route.manage'), async (req, res) => {
    await catalog.deleteRoute(scope(req), uuidParam(req, 'id'), req.id);
    res.status(204).end();
  });

  // Vehicles
  t.get('/vehicles', perm('fleet.read'), async (req, res) => {
    const q = query(req);
    const status = enumOf(q.status, ['ACTIVE', 'MAINTENANCE', 'RETIRED'] as const);
    res.json({ vehicles: await fleet.list(scope(req), pageQuery(req), { status, q: q.q }) });
  });
  t.post('/vehicles', perm('fleet.manage'), async (req, res) => {
    res.status(201).json(await fleet.create(scope(req), vehicleCreate.parse(req.body), req.id));
  });
  t.get('/vehicles/:id', perm('fleet.read'), async (req, res) => {
    res.json(await fleet.get(scope(req), uuidParam(req, 'id')));
  });
  t.patch('/vehicles/:id', perm('fleet.manage'), async (req, res) => {
    res.json(
      await fleet.update(scope(req), uuidParam(req, 'id'), vehiclePatch.parse(req.body), req.id),
    );
  });

  // Schedules
  t.get('/schedules', perm('route.read'), async (req, res) => {
    res.json({ schedules: await schedules.listSchedules(scope(req), pageQuery(req)) });
  });
  t.post('/schedules', perm('route.manage'), async (req, res) => {
    res
      .status(201)
      .json(await schedules.createSchedule(scope(req), scheduleCreate.parse(req.body), req.id));
  });
  t.post('/schedules/:id/pause', perm('route.manage'), async (req, res) => {
    await schedules.setScheduleStatus(scope(req), uuidParam(req, 'id'), 'PAUSED', req.id);
    res.status(204).end();
  });
  t.post('/schedules/:id/resume', perm('route.manage'), async (req, res) => {
    await schedules.setScheduleStatus(scope(req), uuidParam(req, 'id'), 'ACTIVE', req.id);
    res.status(204).end();
  });
  t.post('/schedules/:id/generate', perm('trip.manage'), async (req, res) => {
    const b = generateBody.parse(req.body);
    res.json(await schedules.generateTrips(scope(req), uuidParam(req, 'id'), b.from, b.to, req.id));
  });

  // Trips
  t.get('/trips', perm('trip.read'), async (req, res) => {
    const q = query(req);
    const status = enumOf(q.status, [
      'SCHEDULED',
      'BOARDING',
      'IN_TRANSIT',
      'COMPLETED',
      'CANCELLED',
    ] as const);
    res.json({
      trips: await schedules.listTrips(scope(req), pageQuery(req), {
        from: q.from,
        to: q.to,
        routeId: q.routeId,
        status,
        vehicleId: q.vehicleId,
      }),
    });
  });
  t.post('/trips/:id/vehicle', perm('trip.manage'), async (req, res) => {
    await schedules.assignVehicle(
      scope(req),
      uuidParam(req, 'id'),
      assignBody.parse(req.body).vehicleId,
      req.id,
    );
    res.status(204).end();
  });
  t.post('/trips/:id/status', perm('trip.manage'), async (req, res) => {
    await schedules.setStatus(
      scope(req),
      uuidParam(req, 'id'),
      statusBody.parse(req.body).status,
      req.id,
    );
    res.status(204).end();
  });
  t.post('/trips/:id/delay', perm('trip.manage'), async (req, res) => {
    await schedules.setDelay(
      scope(req),
      uuidParam(req, 'id'),
      delayBody.parse(req.body).delayMinutes,
      req.id,
    );
    res.status(204).end();
  });

  t.post('/trips/:id/replace-vehicle', perm('trip.manage'), async (req, res) => {
    const b = replaceBody.parse(req.body);
    res.json(
      await schedules.replaceVehicle(
        scope(req),
        uuidParam(req, 'id'),
        b.vehicleId,
        b.reason,
        b.markOldOutOfService,
        req.id,
      ),
    );
  });

  const r = Router();
  r.use('/tenants/:tenantId', t);
  return r;
}

// Exposed for tests of timezone validation at the boundary.
export { isValidTimezone };

/** Exposed so the OpenAPI document is generated from the exact schemas used for validation. */
export const requestSchemas = {
  locationCreate,
  locationPatch,
  routeCreate,
  routePatch,
  vehicleCreate,
  vehiclePatch,
  scheduleCreate,
  generateBody,
  assignBody,
  statusBody,
  delayBody,
  replaceBody,
};
