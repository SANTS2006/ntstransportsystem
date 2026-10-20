import { withDb, type Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../audit/audit.js';
import type { TenantScope } from '../tenants/tenant.guards.js';
import { mapDbErrors } from '../../platform/db-errors.js';

const ctxOf = (s: TenantScope) => ({ tenantId: s.tenantId, userId: s.userId });
const dateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export interface BlackoutInput {
  routeId?: string | undefined;
  startsOn: string;
  endsOn: string;
  reason: string;
}

/** Service calendar: dates on which no trips run, company-wide or for a single route. */
export class CalendarService {
  constructor(private readonly db: Db) {}

  async list(s: TenantScope, from?: string, to?: string) {
    const rows = await withDb(this.db, ctxOf(s), (tx) =>
      tx.serviceBlackout.findMany({
        where: {
          tenantId: s.tenantId,
          ...(from ? { endsOn: { gte: dateOnly(from) } } : {}),
          ...(to ? { startsOn: { lte: dateOnly(to) } } : {}),
        },
        include: { route: { select: { name: true } } },
        orderBy: { startsOn: 'asc' },
        take: 200,
      }),
    );
    return rows.map((b) => ({
      id: b.id,
      routeId: b.routeId,
      route: b.route?.name ?? null,
      startsOn: isoDate(b.startsOn),
      endsOn: isoDate(b.endsOn),
      reason: b.reason,
    }));
  }

  /**
   * Adds a blackout. Existing trips are never cancelled silently: the response says how many open
   * trips fall inside the range so a dispatcher can decide (cancel, or keep running).
   */
  async create(s: TenantScope, input: BlackoutInput, requestId?: string) {
    if (input.endsOn < input.startsOn)
      throw AppError.validation('The end date must not be before the start date');
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          if (input.routeId) {
            const route = await tx.route.findFirst({
              where: { id: input.routeId, tenantId: s.tenantId },
              select: { id: true },
            });
            if (!route) throw AppError.validation('Route not found');
          }
          const b = await tx.serviceBlackout.create({
            data: {
              tenantId: s.tenantId,
              routeId: input.routeId ?? null,
              startsOn: dateOnly(input.startsOn),
              endsOn: dateOnly(input.endsOn),
              reason: input.reason.trim(),
            },
          });
          const affected = await tx.trip.count({
            where: {
              tenantId: s.tenantId,
              ...(input.routeId ? { routeId: input.routeId } : {}),
              serviceDate: { gte: dateOnly(input.startsOn), lte: dateOnly(input.endsOn) },
              status: { in: ['SCHEDULED', 'BOARDING'] },
            },
          });
          await writeAudit(tx, {
            action: 'catalog.blackout_created',
            outcome: 'SUCCESS',
            tenantId: s.tenantId,
            actorUserId: s.userId,
            targetType: 'blackout',
            targetId: b.id,
            requestId,
            summary: { openTripsAffected: affected },
          });
          return { id: b.id, openTripsAffected: affected };
        }),
      { check: 'Reason or dates are out of range' },
    );
  }

  async remove(s: TenantScope, id: string, requestId?: string) {
    await withDb(this.db, ctxOf(s), async (tx) => {
      const res = await tx.serviceBlackout.deleteMany({ where: { id, tenantId: s.tenantId } });
      if (res.count !== 1) throw AppError.notFound();
      await writeAudit(tx, {
        action: 'catalog.blackout_removed',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'blackout',
        targetId: id,
        requestId,
      });
    });
  }
}
