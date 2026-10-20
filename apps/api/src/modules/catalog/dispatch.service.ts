import { withDb, type Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import type { TenantScope } from '../tenants/tenant.guards.js';

const ctxOf = (s: TenantScope) => ({ tenantId: s.tenantId, userId: s.userId });
const dateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export type DispatchFlag = 'NO_VEHICLE' | 'NO_DRIVER' | 'DELAYED' | 'VEHICLE_DOCUMENT_EXPIRED';

const OPEN = new Set(['SCHEDULED', 'BOARDING', 'IN_TRANSIT']);

/** Read-only operational views for dispatchers. */
export class DispatchService {
  constructor(private readonly db: Db) {}

  /** Everything running on one service date, with what still needs a dispatcher's attention. */
  async board(s: TenantScope, date: string) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const trips = await tx.trip.findMany({
        where: { tenantId: s.tenantId, serviceDate: dateOnly(date) },
        include: {
          route: {
            select: {
              name: true,
              origin: { select: { name: true } },
              destination: { select: { name: true } },
            },
          },
          vehicle: { select: { registration: true, seatingCapacity: true } },
          crew: {
            where: { releasedAt: null },
            include: { employee: { select: { fullName: true } } },
          },
        },
        orderBy: { departureAt: 'asc' },
        take: 500,
      });
      const vehicleIds = [
        ...new Set(trips.map((t) => t.vehicleId).filter((v): v is string => v !== null)),
      ];
      const expired = vehicleIds.length
        ? await tx.vehicleDocument.findMany({
            where: {
              tenantId: s.tenantId,
              vehicleId: { in: vehicleIds },
              expiresOn: { lt: dateOnly(date) },
            },
            select: { vehicleId: true },
          })
        : [];
      const expiredVehicles = new Set(expired.map((d) => d.vehicleId));

      const rows = trips.map((t) => {
        const flags: DispatchFlag[] = [];
        if (OPEN.has(t.status)) {
          if (!t.vehicleId) flags.push('NO_VEHICLE');
          if (!t.crew.some((c) => c.role === 'DRIVER')) flags.push('NO_DRIVER');
          if (t.delayMinutes > 0) flags.push('DELAYED');
          if (t.vehicleId && expiredVehicles.has(t.vehicleId))
            flags.push('VEHICLE_DOCUMENT_EXPIRED');
        }
        return {
          id: t.id,
          route: t.route.name,
          origin: t.route.origin.name,
          destination: t.route.destination.name,
          departureAt: t.departureAt.toISOString(),
          arrivalAt: t.arrivalAt.toISOString(),
          status: t.status,
          delayMinutes: t.delayMinutes,
          vehicle: t.vehicle
            ? {
                id: t.vehicleId,
                registration: t.vehicle.registration,
                seats: t.vehicle.seatingCapacity,
              }
            : null,
          crew: t.crew.map((c) => ({
            employeeId: c.employeeId,
            fullName: c.employee.fullName,
            role: c.role,
          })),
          flags,
        };
      });
      const byStatus: Record<string, number> = {};
      for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      return {
        date,
        summary: {
          total: rows.length,
          byStatus,
          needingAttention: rows.filter((r) => r.flags.length > 0).length,
        },
        trips: rows,
      };
    });
  }

  /** A trip's operational timeline, newest first. */
  async events(s: TenantScope, tripId: string) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const trip = await tx.trip.findFirst({
        where: { id: tripId, tenantId: s.tenantId },
        select: { id: true },
      });
      if (!trip) throw AppError.notFound();
      const rows = await tx.tripEvent.findMany({
        where: { tenantId: s.tenantId, tripId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return rows.map((e) => ({
        id: e.id,
        kind: e.kind,
        details: e.details,
        at: e.createdAt.toISOString(),
      }));
    });
  }
}
