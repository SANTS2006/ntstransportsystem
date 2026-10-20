import { withDb, type Db, type Tx } from '../../platform/db.js';
import { mapDbErrors } from '../../platform/db-errors.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../audit/audit.js';
import type { TenantScope } from '../tenants/tenant.guards.js';
import type { Page } from './catalog.service.js';

type VehicleType = 'BUS' | 'MINIBUS' | 'SHARED_TAXI' | 'TAXI' | 'SHUTTLE' | 'OTHER';
type VehicleStatus = 'ACTIVE' | 'MAINTENANCE' | 'RETIRED';

export interface VehicleInput {
  registration: string;
  label?: string | undefined;
  type: VehicleType;
  make?: string | undefined;
  model?: string | undefined;
  year?: number | undefined;
  seatingCapacity: number;
  odometerKm?: number | undefined;
  seatLayoutId?: string | undefined;
}
export interface VehiclePatch {
  label?: string | undefined;
  type?: VehicleType | undefined;
  make?: string | undefined;
  model?: string | undefined;
  year?: number | undefined;
  seatingCapacity?: number | undefined;
  odometerKm?: number | undefined;
  status?: VehicleStatus | undefined;
  seatLayoutId?: string | undefined;
}

export const normalizeRegistration = (r: string) => r.trim().toUpperCase();
const ctxOf = (s: TenantScope) => ({ tenantId: s.tenantId, userId: s.userId });

/** A vehicle linked to a seat layout must have exactly as many seats as the layout. */
async function assertLayoutMatches(tx: Tx, tenantId: string, layoutId: string, seats: number) {
  const layout = await tx.seatLayout.findFirst({
    where: { id: layoutId, tenantId },
    include: { _count: { select: { seats: true } } },
  });
  if (!layout) throw AppError.validation('Seat layout not found');
  if (layout._count.seats !== seats) {
    throw AppError.conflict(
      `The seat layout has ${layout._count.seats} seats but the vehicle has ${seats}`,
    );
  }
}

export class FleetService {
  constructor(private readonly db: Db) {}

  async list(
    s: TenantScope,
    page: Page,
    filter: { status?: VehicleStatus | undefined; q?: string | undefined } = {},
  ) {
    return withDb(this.db, ctxOf(s), (tx) =>
      tx.vehicle.findMany({
        where: {
          tenantId: s.tenantId,
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.q ? { registration: { contains: filter.q.toUpperCase() } } : {}),
        },
        orderBy: { registration: 'asc' },
        take: page.limit,
        skip: page.offset,
      }),
    );
  }

  async get(s: TenantScope, id: string) {
    const v = await withDb(this.db, ctxOf(s), (tx) =>
      tx.vehicle.findFirst({ where: { id, tenantId: s.tenantId } }),
    );
    if (!v) throw AppError.notFound();
    return v;
  }

  async create(s: TenantScope, input: VehicleInput, requestId?: string) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          if (input.seatLayoutId) {
            await assertLayoutMatches(tx, s.tenantId, input.seatLayoutId, input.seatingCapacity);
          }
          const v = await tx.vehicle.create({
            data: {
              tenantId: s.tenantId,
              registration: normalizeRegistration(input.registration),
              label: input.label ?? null,
              type: input.type,
              make: input.make ?? null,
              model: input.model ?? null,
              year: input.year ?? null,
              seatingCapacity: input.seatingCapacity,
              odometerKm: input.odometerKm ?? 0,
              seatLayoutId: input.seatLayoutId ?? null,
            },
          });
          await writeAudit(tx, {
            action: 'fleet.vehicle_created',
            outcome: 'SUCCESS',
            tenantId: s.tenantId,
            actorUserId: s.userId,
            targetType: 'vehicle',
            targetId: v.id,
            requestId,
          });
          return v;
        }),
      {
        unique: 'A vehicle with this registration already exists',
        check: 'Capacity, year or odometer is out of range',
      },
    );
  }

  /**
   * Updates a vehicle. The odometer can only move forward, and a vehicle cannot leave service
   * (maintenance or retired) while it is assigned to upcoming trips: those must be reassigned first.
   */
  async update(s: TenantScope, id: string, patch: VehiclePatch, requestId?: string) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const v = await tx.vehicle.findFirst({ where: { id, tenantId: s.tenantId } });
          if (!v) throw AppError.notFound();
          if (v.status === 'RETIRED' && patch.status !== undefined && patch.status !== 'RETIRED') {
            throw AppError.conflict('A retired vehicle cannot be returned to service');
          }
          if (patch.odometerKm !== undefined && patch.odometerKm < v.odometerKm) {
            throw AppError.conflict('The odometer reading cannot go backwards');
          }
          if (patch.status && patch.status !== 'ACTIVE' && v.status === 'ACTIVE') {
            const upcoming = await tx.trip.count({
              where: {
                tenantId: s.tenantId,
                vehicleId: id,
                status: { in: ['SCHEDULED', 'BOARDING'] },
                departureAt: { gt: new Date() },
              },
            });
            if (upcoming > 0) {
              throw AppError.conflict(
                `This vehicle is assigned to ${upcoming} upcoming trip(s). Reassign them first.`,
              );
            }
          }
          const layoutId = patch.seatLayoutId ?? v.seatLayoutId;
          if (
            layoutId &&
            (patch.seatLayoutId !== undefined || patch.seatingCapacity !== undefined)
          ) {
            await assertLayoutMatches(
              tx,
              s.tenantId,
              layoutId,
              patch.seatingCapacity ?? v.seatingCapacity,
            );
          }
          const data = Object.fromEntries(
            Object.entries(patch).filter(([, val]) => val !== undefined),
          );
          if (Object.keys(data).length === 0) throw AppError.validation('Nothing to update');
          const updated = await tx.vehicle.update({ where: { id }, data });
          await writeAudit(tx, {
            action: 'fleet.vehicle_updated',
            outcome: 'SUCCESS',
            tenantId: s.tenantId,
            actorUserId: s.userId,
            targetType: 'vehicle',
            targetId: id,
            requestId,
            summary: {
              fields: Object.keys(data).join(','),
              ...(patch.status ? { status: patch.status } : {}),
            },
          });
          return updated;
        }),
      { check: 'Capacity, year or odometer is out of range' },
    );
  }
}
