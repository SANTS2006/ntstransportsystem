import { withDb, type Db, type Tx } from '../../platform/db.js';
import { mapDbErrors } from '../../platform/db-errors.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../audit/audit.js';
import type { TenantScope } from '../tenants/tenant.guards.js';

type LocationKind = 'TERMINAL' | 'STATION' | 'STOP' | 'DEPOT';
/** Like Partial<T>, but allows explicit `undefined` (what optional zod fields produce). */
export type Patch<T> = { [K in keyof T]?: T[K] | undefined };

export interface Page {
  limit: number;
  offset: number;
}

export interface LocationInput {
  name: string;
  kind: LocationKind;
  city: string;
  address?: string | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
  active?: boolean | undefined;
}

export interface RouteStopInput {
  locationId: string;
  offsetMin: number;
}
export interface RouteInput {
  name: string;
  originId: string;
  destinationId: string;
  distanceM: number;
  durationMin: number;
  stops: RouteStopInput[];
  /** Empty means any vehicle type may run the route. */
  allowedVehicleTypes?: string[] | undefined;
  minSeats?: number | undefined;
}

type VehicleTypeValue = 'BUS' | 'MINIBUS' | 'SHARED_TAXI' | 'TAXI' | 'SHUTTLE' | 'OTHER';

const ctxOf = (s: TenantScope) => ({ tenantId: s.tenantId, userId: s.userId });

export class CatalogService {
  constructor(private readonly db: Db) {}

  private audit(
    tx: Tx,
    s: TenantScope,
    action: string,
    targetType: string,
    targetId: string,
    requestId?: string,
    summary?: Record<string, string | number | boolean | null>,
  ) {
    return writeAudit(tx, {
      action,
      outcome: 'SUCCESS',
      tenantId: s.tenantId,
      actorUserId: s.userId,
      targetType,
      targetId,
      requestId,
      ...(summary ? { summary } : {}),
    });
  }

  // ---- Locations ---------------------------------------------------------------------------

  async listLocations(s: TenantScope, page: Page, q?: string) {
    return withDb(this.db, ctxOf(s), (tx) =>
      tx.location.findMany({
        where: {
          tenantId: s.tenantId,
          ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
        },
        orderBy: { name: 'asc' },
        take: page.limit,
        skip: page.offset,
      }),
    );
  }

  async createLocation(s: TenantScope, input: LocationInput, requestId?: string) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const loc = await tx.location.create({
            data: {
              tenantId: s.tenantId,
              name: input.name,
              kind: input.kind,
              city: input.city,
              address: input.address ?? null,
              latitude: input.latitude ?? null,
              longitude: input.longitude ?? null,
              active: input.active ?? true,
            },
          });
          await this.audit(tx, s, 'catalog.location_created', 'location', loc.id, requestId);
          return loc;
        }),
      {
        unique: 'A location with this name already exists',
        check: 'Latitude and longitude must be given together and be valid',
      },
    );
  }

  async updateLocation(
    s: TenantScope,
    id: string,
    patch: Patch<LocationInput>,
    requestId?: string,
  ) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const existing = await tx.location.findFirst({ where: { id, tenantId: s.tenantId } });
          if (!existing) throw AppError.notFound();
          const data = {
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
            ...(patch.city !== undefined ? { city: patch.city } : {}),
            ...(patch.address !== undefined ? { address: patch.address } : {}),
            ...(patch.latitude !== undefined ? { latitude: patch.latitude } : {}),
            ...(patch.longitude !== undefined ? { longitude: patch.longitude } : {}),
            ...(patch.active !== undefined ? { active: patch.active } : {}),
          };
          if (Object.keys(data).length === 0) throw AppError.validation('Nothing to update');
          const loc = await tx.location.update({ where: { id }, data });
          await this.audit(tx, s, 'catalog.location_updated', 'location', id, requestId, {
            fields: Object.keys(data).join(','),
          });
          return loc;
        }),
      {
        unique: 'A location with this name already exists',
        check: 'Latitude and longitude must be given together and be valid',
      },
    );
  }

  async deleteLocation(s: TenantScope, id: string, requestId?: string) {
    await withDb(this.db, ctxOf(s), async (tx) => {
      const existing = await tx.location.findFirst({ where: { id, tenantId: s.tenantId } });
      if (!existing) throw AppError.notFound();
      const used =
        (await tx.route.count({
          where: { tenantId: s.tenantId, OR: [{ originId: id }, { destinationId: id }] },
        })) + (await tx.routeStop.count({ where: { tenantId: s.tenantId, locationId: id } }));
      if (used > 0)
        throw AppError.conflict('This location is used by a route. Deactivate it instead.');
      await tx.location.delete({ where: { id } });
      await this.audit(tx, s, 'catalog.location_deleted', 'location', id, requestId);
    });
  }

  // ---- Routes ------------------------------------------------------------------------------

  /** Validates endpoints and stops: all exist and are active in this tenant, order and offsets make sense. */
  private async validateRouteShape(
    tx: Tx,
    s: TenantScope,
    input: Pick<RouteInput, 'originId' | 'destinationId' | 'durationMin' | 'stops'>,
  ) {
    if (input.originId === input.destinationId)
      throw AppError.validation('Origin and destination must differ');
    const ids = [input.originId, input.destinationId, ...input.stops.map((x) => x.locationId)];
    if (new Set(input.stops.map((x) => x.locationId)).size !== input.stops.length) {
      throw AppError.validation('A stop can appear only once on a route');
    }
    if (
      input.stops.some(
        (x) => x.locationId === input.originId || x.locationId === input.destinationId,
      )
    ) {
      throw AppError.validation('Stops must be intermediate: not the origin or destination');
    }
    let prev = 0;
    for (const stop of input.stops) {
      if (stop.offsetMin <= prev)
        throw AppError.validation('Stop times must increase along the route');
      if (stop.offsetMin >= input.durationMin)
        throw AppError.validation('Every stop must be reached before the route ends');
      prev = stop.offsetMin;
    }
    const found = await tx.location.findMany({ where: { tenantId: s.tenantId, id: { in: ids } } });
    if (found.length !== new Set(ids).size)
      throw AppError.validation('One or more locations do not exist');
    if (found.some((l) => !l.active))
      throw AppError.validation('Inactive locations cannot be used on a route');
  }

  async listRoutes(s: TenantScope, page: Page, status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED') {
    const rows = await withDb(this.db, ctxOf(s), (tx) =>
      tx.route.findMany({
        where: { tenantId: s.tenantId, ...(status ? { status } : {}) },
        include: {
          origin: { select: { name: true } },
          destination: { select: { name: true } },
          _count: { select: { stops: true } },
        },
        orderBy: { name: 'asc' },
        take: page.limit,
        skip: page.offset,
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      originId: r.originId,
      origin: r.origin.name,
      destinationId: r.destinationId,
      destination: r.destination.name,
      distanceM: r.distanceM,
      durationMin: r.durationMin,
      minSeats: r.minSeats,
      allowedVehicleTypes: r.allowedVehicleTypes,
      stopCount: r._count.stops,
    }));
  }

  async getRoute(s: TenantScope, id: string) {
    const r = await withDb(this.db, ctxOf(s), (tx) =>
      tx.route.findFirst({
        where: { id, tenantId: s.tenantId },
        include: {
          origin: { select: { name: true } },
          destination: { select: { name: true } },
          stops: {
            orderBy: { sequence: 'asc' },
            include: { location: { select: { name: true } } },
          },
        },
      }),
    );
    if (!r) throw AppError.notFound();
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      originId: r.originId,
      origin: r.origin.name,
      destinationId: r.destinationId,
      destination: r.destination.name,
      distanceM: r.distanceM,
      durationMin: r.durationMin,
      allowedVehicleTypes: r.allowedVehicleTypes,
      minSeats: r.minSeats,
      stops: r.stops.map((x) => ({
        sequence: x.sequence,
        locationId: x.locationId,
        location: x.location.name,
        offsetMin: x.offsetMin,
      })),
    };
  }

  async createRoute(s: TenantScope, input: RouteInput, requestId?: string) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          await this.validateRouteShape(tx, s, input);
          const route = await tx.route.create({
            data: {
              tenantId: s.tenantId,
              name: input.name,
              originId: input.originId,
              destinationId: input.destinationId,
              distanceM: input.distanceM,
              durationMin: input.durationMin,
              allowedVehicleTypes: (input.allowedVehicleTypes ?? []) as VehicleTypeValue[],
              minSeats: input.minSeats ?? 1,
              status: 'DRAFT',
            },
          });
          if (input.stops.length > 0) {
            await tx.routeStop.createMany({
              data: input.stops.map((x, i) => ({
                tenantId: s.tenantId,
                routeId: route.id,
                locationId: x.locationId,
                sequence: i + 1,
                offsetMin: x.offsetMin,
              })),
            });
          }
          await this.audit(tx, s, 'catalog.route_created', 'route', route.id, requestId, {
            stops: input.stops.length,
          });
          return { id: route.id, name: route.name, status: route.status };
        }),
      {
        unique: 'A route with this name already exists',
        check: 'Distance and duration must be positive',
      },
    );
  }

  /** Only DRAFT routes are editable; a published route must be archived and replaced. */
  async updateRoute(s: TenantScope, id: string, patch: Patch<RouteInput>, requestId?: string) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const route = await tx.route.findFirst({
            where: { id, tenantId: s.tenantId },
            include: { stops: true },
          });
          if (!route) throw AppError.notFound();
          if (route.status !== 'DRAFT') throw AppError.conflict('Only draft routes can be edited');
          const next = {
            originId: patch.originId ?? route.originId,
            destinationId: patch.destinationId ?? route.destinationId,
            durationMin: patch.durationMin ?? route.durationMin,
            stops:
              patch.stops ??
              route.stops
                .sort((a, b) => a.sequence - b.sequence)
                .map((x) => ({ locationId: x.locationId, offsetMin: x.offsetMin })),
          };
          await this.validateRouteShape(tx, s, next);
          await tx.route.update({
            where: { id },
            data: {
              ...(patch.name !== undefined ? { name: patch.name } : {}),
              originId: next.originId,
              destinationId: next.destinationId,
              ...(patch.distanceM !== undefined ? { distanceM: patch.distanceM } : {}),
              durationMin: next.durationMin,
              ...(patch.allowedVehicleTypes !== undefined
                ? { allowedVehicleTypes: patch.allowedVehicleTypes as VehicleTypeValue[] }
                : {}),
              ...(patch.minSeats !== undefined ? { minSeats: patch.minSeats } : {}),
            },
          });
          if (patch.stops !== undefined) {
            await tx.routeStop.deleteMany({ where: { routeId: id } });
            if (patch.stops.length > 0) {
              await tx.routeStop.createMany({
                data: patch.stops.map((x, i) => ({
                  tenantId: s.tenantId,
                  routeId: id,
                  locationId: x.locationId,
                  sequence: i + 1,
                  offsetMin: x.offsetMin,
                })),
              });
            }
          }
          await this.audit(tx, s, 'catalog.route_updated', 'route', id, requestId);
        }),
      {
        unique: 'A route with this name already exists',
        check: 'Distance and duration must be positive',
      },
    );
  }

  async setRouteStatus(
    s: TenantScope,
    id: string,
    action: 'publish' | 'archive',
    requestId?: string,
  ) {
    await withDb(this.db, ctxOf(s), async (tx) => {
      const route = await tx.route.findFirst({
        where: { id, tenantId: s.tenantId },
        include: { origin: true, destination: true },
      });
      if (!route) throw AppError.notFound();
      if (action === 'publish') {
        if (route.status !== 'DRAFT')
          throw AppError.conflict('Only a draft route can be published');
        if (!route.origin.active || !route.destination.active)
          throw AppError.conflict('Origin and destination must be active');
        await tx.route.update({ where: { id }, data: { status: 'PUBLISHED' } });
      } else {
        if (route.status === 'ARCHIVED') throw AppError.conflict('Route is already archived');
        const live = await tx.schedule.count({
          where: { tenantId: s.tenantId, routeId: id, status: 'ACTIVE' },
        });
        if (live > 0)
          throw AppError.conflict('Pause or remove this route’s active schedules first');
        await tx.route.update({ where: { id }, data: { status: 'ARCHIVED' } });
      }
      await this.audit(
        tx,
        s,
        `catalog.route_${action === 'publish' ? 'published' : 'archived'}`,
        'route',
        id,
        requestId,
      );
    });
  }

  async deleteRoute(s: TenantScope, id: string, requestId?: string) {
    await mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const route = await tx.route.findFirst({ where: { id, tenantId: s.tenantId } });
          if (!route) throw AppError.notFound();
          if (route.status !== 'DRAFT')
            throw AppError.conflict('Only draft routes can be deleted; archive others');
          await tx.route.delete({ where: { id } }); // stops cascade
          await this.audit(tx, s, 'catalog.route_deleted', 'route', id, requestId);
        }),
      { foreign_key: 'This route is referenced by schedules or trips' },
    );
  }
}
