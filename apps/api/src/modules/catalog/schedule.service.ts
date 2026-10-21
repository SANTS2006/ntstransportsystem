import { withDb, type Db, type Tx } from '../../platform/db.js';
import { mapDbErrors } from '../../platform/db-errors.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../audit/audit.js';
import type { TenantScope } from '../tenants/tenant.guards.js';
import { assertSoldSeatsFit, cancelBookingsForTrip } from '../booking/booking.service.js';
import { enqueueOutbox } from '../../platform/outbox.js';
import type { Page } from './catalog.service.js';
import { assertVehicleCompatible } from './compat.js';
import { recordTripEvent } from './trip-events.js';
import { eachDate, weekdayBit, zonedTimeToUtc } from './time.js';

type TripStatus = 'SCHEDULED' | 'BOARDING' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';

export interface ScheduleInput {
  routeId: string;
  departureTime: string;
  daysOfWeek: number;
  validFrom: string;
  validTo?: string | undefined;
  defaultVehicleId?: string | undefined;
  serviceClass?: string | undefined;
}

/** Legal trip status transitions. Anything else is refused. */
export const TRIP_TRANSITIONS: Record<TripStatus, readonly TripStatus[]> = {
  SCHEDULED: ['BOARDING', 'CANCELLED'],
  BOARDING: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

const MAX_GENERATE_DAYS = 62;
const dateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const ctxOf = (s: TenantScope) => ({ tenantId: s.tenantId, userId: s.userId });
const overlaps = (a: { dep: number; arr: number }, b: { dep: number; arr: number }) =>
  a.dep < b.arr && b.dep < a.arr;

const EXCLUSION_MSG = 'That vehicle is already assigned to an overlapping trip';

export class ScheduleService {
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

  // ---- Schedules ---------------------------------------------------------------------------

  async listSchedules(s: TenantScope, page: Page) {
    const rows = await withDb(this.db, ctxOf(s), (tx) =>
      tx.schedule.findMany({
        where: { tenantId: s.tenantId },
        include: {
          route: { select: { name: true } },
          defaultVehicle: { select: { registration: true } },
        },
        orderBy: [{ departureTime: 'asc' }],
        take: page.limit,
        skip: page.offset,
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      routeId: r.routeId,
      route: r.route.name,
      departureTime: r.departureTime,
      daysOfWeek: r.daysOfWeek,
      validFrom: isoDate(r.validFrom),
      validTo: r.validTo ? isoDate(r.validTo) : null,
      defaultVehicleId: r.defaultVehicleId,
      defaultVehicle: r.defaultVehicle?.registration ?? null,
      serviceClass: r.serviceClass,
      status: r.status,
    }));
  }

  async createSchedule(s: TenantScope, input: ScheduleInput, requestId?: string) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const route = await tx.route.findFirst({
            where: { id: input.routeId, tenantId: s.tenantId },
          });
          if (!route) throw AppError.validation('Route not found');
          if (route.status !== 'PUBLISHED')
            throw AppError.conflict('Schedules can only be created for a published route');
          if (input.defaultVehicleId) {
            const v = await tx.vehicle.findFirst({
              where: { id: input.defaultVehicleId, tenantId: s.tenantId },
            });
            if (!v) throw AppError.validation('Vehicle not found');
            if (v.status !== 'ACTIVE')
              throw AppError.conflict('The default vehicle is not in service');
            assertVehicleCompatible(
              { allowedVehicleTypes: route.allowedVehicleTypes, minSeats: route.minSeats },
              v,
            );
          }
          const sch = await tx.schedule.create({
            data: {
              tenantId: s.tenantId,
              routeId: input.routeId,
              departureTime: input.departureTime,
              daysOfWeek: input.daysOfWeek,
              validFrom: dateOnly(input.validFrom),
              validTo: input.validTo ? dateOnly(input.validTo) : null,
              defaultVehicleId: input.defaultVehicleId ?? null,
              serviceClass: input.serviceClass ?? null,
            },
          });
          await this.audit(tx, s, 'catalog.schedule_created', 'schedule', sch.id, requestId);
          return { id: sch.id };
        }),
      { check: 'Departure time, weekdays or validity dates are invalid' },
    );
  }

  async setScheduleStatus(
    s: TenantScope,
    id: string,
    status: 'ACTIVE' | 'PAUSED',
    requestId?: string,
  ) {
    await withDb(this.db, ctxOf(s), async (tx) => {
      const res = await tx.schedule.updateMany({
        where: { id, tenantId: s.tenantId },
        data: { status },
      });
      if (res.count !== 1) throw AppError.notFound();
      await this.audit(
        tx,
        s,
        `catalog.schedule_${status === 'PAUSED' ? 'paused' : 'resumed'}`,
        'schedule',
        id,
        requestId,
      );
    });
  }

  // ---- Trips -------------------------------------------------------------------------------

  /**
   * Materialises trips for a schedule over [from, to]. Idempotent: existing (schedule, date)
   * trips are left alone. The default vehicle is attached only where it is free; dates where it
   * would clash are created unassigned and reported, so a dispatcher can resolve them.
   * (The database exclusion constraint remains the final guard against concurrent double-booking.)
   */
  async generateTrips(
    s: TenantScope,
    scheduleId: string,
    from: string,
    to: string,
    requestId?: string,
  ) {
    if (from > to) throw AppError.validation('The start date must not be after the end date');
    return mapDbErrors(
      () =>
        withDb(
          this.db,
          ctxOf(s),
          async (tx) => {
            const schedule = await tx.schedule.findFirst({
              where: { id: scheduleId, tenantId: s.tenantId },
              include: { route: true, defaultVehicle: true },
            });
            if (!schedule) throw AppError.notFound();
            if (schedule.status !== 'ACTIVE') throw AppError.conflict('This schedule is paused');
            if (schedule.route.status !== 'PUBLISHED')
              throw AppError.conflict('The route is not published');
            const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: s.tenantId } });

            const lo = from > isoDate(schedule.validFrom) ? from : isoDate(schedule.validFrom);
            const validTo = schedule.validTo ? isoDate(schedule.validTo) : null;
            const hi = validTo && validTo < to ? validTo : to;
            if (lo > hi)
              return {
                created: 0,
                skippedExisting: 0,
                skippedBlackout: [] as string[],
                unassignedVehicle: [] as string[],
              };
            let dates: string[];
            try {
              dates = eachDate(lo, hi, MAX_GENERATE_DAYS);
            } catch {
              throw AppError.validation(`Generate at most ${MAX_GENERATE_DAYS} days at a time`);
            }
            dates = dates.filter((d) => (weekdayBit(d) & schedule.daysOfWeek) !== 0);

            // Service calendar: company-wide blackouts and ones for this route.
            const blackouts = await tx.serviceBlackout.findMany({
              where: {
                tenantId: s.tenantId,
                OR: [{ routeId: null }, { routeId: schedule.routeId }],
                startsOn: { lte: dateOnly(hi) },
                endsOn: { gte: dateOnly(lo) },
              },
              select: { startsOn: true, endsOn: true },
            });
            const inBlackout = (d: string) =>
              blackouts.some((b) => d >= isoDate(b.startsOn) && d <= isoDate(b.endsOn));
            const skippedBlackout = dates.filter(inBlackout);
            dates = dates.filter((d) => !inBlackout(d));

            const existing = await tx.trip.findMany({
              where: { scheduleId, serviceDate: { in: dates.map(dateOnly) } },
              select: { serviceDate: true },
            });
            const have = new Set(existing.map((e) => isoDate(e.serviceDate)));

            const planned = dates
              .filter((d) => !have.has(d))
              .map((d) => {
                const dep = zonedTimeToUtc(d, schedule.departureTime, tenant.timezone);
                return {
                  date: d,
                  dep,
                  arr: new Date(dep.getTime() + schedule.route.durationMin * 60_000),
                };
              });

            let vehicle =
              schedule.defaultVehicle && schedule.defaultVehicle.status === 'ACTIVE'
                ? schedule.defaultVehicle
                : null;
            let incompatible = false;
            if (vehicle) {
              try {
                assertVehicleCompatible(
                  {
                    allowedVehicleTypes: schedule.route.allowedVehicleTypes,
                    minSeats: schedule.route.minSeats,
                  },
                  vehicle,
                );
              } catch {
                vehicle = null; // e.g. the vehicle was changed after the schedule was created
                incompatible = true;
              }
            }
            const unassigned: string[] = incompatible ? planned.map((p) => p.date) : [];
            const assigned = new Set<string>();
            if (vehicle && planned.length > 0) {
              const first = planned[0]!.dep;
              const last = planned[planned.length - 1]!.arr;
              const busy = (
                await tx.trip.findMany({
                  where: {
                    tenantId: s.tenantId,
                    vehicleId: vehicle.id,
                    status: { not: 'CANCELLED' },
                    departureAt: { lt: last },
                    arrivalAt: { gt: first },
                  },
                  select: { departureAt: true, arrivalAt: true },
                })
              ).map((t) => ({ dep: t.departureAt.getTime(), arr: t.arrivalAt.getTime() }));
              for (const p of planned) {
                const slot = { dep: p.dep.getTime(), arr: p.arr.getTime() };
                if (busy.some((b) => overlaps(b, slot))) {
                  unassigned.push(p.date);
                } else {
                  busy.push(slot); // also prevents two planned trips clashing with each other
                  assigned.add(p.date);
                }
              }
            }

            if (planned.length > 0) {
              await tx.trip.createMany({
                data: planned.map((p) => ({
                  tenantId: s.tenantId,
                  scheduleId,
                  routeId: schedule.routeId,
                  serviceDate: dateOnly(p.date),
                  departureAt: p.dep,
                  arrivalAt: p.arr,
                  vehicleId: assigned.has(p.date) && vehicle ? vehicle.id : null,
                })),
                skipDuplicates: true,
              });
            }
            await this.audit(tx, s, 'trips.generated', 'schedule', scheduleId, requestId, {
              created: planned.length,
              skipped: have.size,
              blackout: skippedBlackout.length,
              unassigned: unassigned.length,
            });
            return {
              created: planned.length,
              skippedExisting: have.size,
              skippedBlackout,
              unassignedVehicle: unassigned,
            };
          },
          { timeoutMs: 60_000 },
        ),
      { exclusion: EXCLUSION_MSG },
    );
  }

  async listTrips(
    s: TenantScope,
    page: Page,
    filter: {
      from?: string | undefined;
      to?: string | undefined;
      routeId?: string | undefined;
      status?: TripStatus | undefined;
      vehicleId?: string | undefined;
    },
  ) {
    const rows = await withDb(this.db, ctxOf(s), (tx) =>
      tx.trip.findMany({
        where: {
          tenantId: s.tenantId,
          ...(filter.from || filter.to
            ? {
                serviceDate: {
                  ...(filter.from ? { gte: dateOnly(filter.from) } : {}),
                  ...(filter.to ? { lte: dateOnly(filter.to) } : {}),
                },
              }
            : {}),
          ...(filter.routeId ? { routeId: filter.routeId } : {}),
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.vehicleId ? { vehicleId: filter.vehicleId } : {}),
        },
        include: {
          route: { select: { name: true } },
          vehicle: { select: { registration: true, seatingCapacity: true } },
        },
        orderBy: { departureAt: 'asc' },
        take: page.limit,
        skip: page.offset,
      }),
    );
    return rows.map((t) => ({
      id: t.id,
      routeId: t.routeId,
      route: t.route.name,
      serviceDate: isoDate(t.serviceDate),
      departureAt: t.departureAt.toISOString(),
      arrivalAt: t.arrivalAt.toISOString(),
      status: t.status,
      delayMinutes: t.delayMinutes,
      vehicleId: t.vehicleId,
      vehicle: t.vehicle?.registration ?? null,
      seats: t.vehicle?.seatingCapacity ?? null,
    }));
  }

  /** Assign or clear a trip's vehicle. In-service vehicles only; overlap is enforced by the database. */
  async assignVehicle(
    s: TenantScope,
    tripId: string,
    vehicleId: string | null,
    requestId?: string,
  ) {
    await mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const trip = await tx.trip.findFirst({ where: { id: tripId, tenantId: s.tenantId } });
          if (!trip) throw AppError.notFound();
          if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED')
            throw AppError.conflict('This trip can no longer be changed');
          if (vehicleId) {
            const v = await tx.vehicle.findFirst({
              where: { id: vehicleId, tenantId: s.tenantId },
            });
            if (!v) throw AppError.validation('Vehicle not found');
            if (v.status !== 'ACTIVE') throw AppError.conflict('That vehicle is not in service');
            const route = await tx.route.findFirstOrThrow({
              where: { id: trip.routeId, tenantId: s.tenantId },
            });
            assertVehicleCompatible(
              { allowedVehicleTypes: route.allowedVehicleTypes, minSeats: route.minSeats },
              v,
            );
          }
          await assertSoldSeatsFit(tx, s.tenantId, tripId, vehicleId);
          await tx.trip.update({ where: { id: tripId }, data: { vehicleId } });
          await recordTripEvent(tx, s, tripId, 'VEHICLE_ASSIGNED', {
            from: trip.vehicleId,
            to: vehicleId,
          });
          await this.audit(tx, s, 'trips.vehicle_assigned', 'trip', tripId, requestId, {
            vehicle: vehicleId,
          });
        }),
      { exclusion: EXCLUSION_MSG },
    );
  }

  async setStatus(s: TenantScope, tripId: string, status: TripStatus, requestId?: string) {
    await withDb(this.db, ctxOf(s), async (tx) => {
      const trip = await tx.trip.findFirst({ where: { id: tripId, tenantId: s.tenantId } });
      if (!trip) throw AppError.notFound();
      if (!TRIP_TRANSITIONS[trip.status].includes(status)) {
        throw AppError.conflict(
          `A ${trip.status.toLowerCase().replace('_', ' ')} trip cannot become ${status.toLowerCase().replace('_', ' ')}`,
        );
      }
      // Compare-and-set so two dispatchers cannot both apply a transition from the same state.
      const res = await tx.trip.updateMany({
        where: { id: tripId, status: trip.status },
        data: { status },
      });
      if (res.count !== 1) throw AppError.conflict('The trip changed; please refresh and retry');
      // A cancelled trip frees its crew: their duty slot is released for other trips.
      if (status === 'CANCELLED') {
        await cancelBookingsForTrip(tx, s.tenantId, tripId, s.userId);
        await tx.tripCrew.updateMany({
          where: { tenantId: s.tenantId, tripId, releasedAt: null },
          data: { releasedAt: new Date() },
        });
      }
      await recordTripEvent(tx, s, tripId, 'STATUS_CHANGED', { from: trip.status, to: status });
      if (status === 'CANCELLED') {
        await enqueueOutbox(tx, {
          tenantId: s.tenantId,
          type: 'trip.cancelled',
          payload: { tripId },
          dedupeKey: `trip.cancelled:${tripId}`,
        });
      }
      await this.audit(tx, s, `trips.${status.toLowerCase()}`, 'trip', tripId, requestId, {
        from: trip.status,
      });
    });
  }

  async setDelay(s: TenantScope, tripId: string, delayMinutes: number, requestId?: string) {
    await withDb(this.db, ctxOf(s), async (tx) => {
      const trip = await tx.trip.findFirst({ where: { id: tripId, tenantId: s.tenantId } });
      if (!trip) throw AppError.notFound();
      if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED')
        throw AppError.conflict('This trip can no longer be changed');
      await tx.trip.update({ where: { id: tripId }, data: { delayMinutes } });
      await recordTripEvent(tx, s, tripId, 'DELAY_SET', {
        from: trip.delayMinutes,
        to: delayMinutes,
      });
      // Passengers are told through the outbox (consumed once bookings exist).
      if (delayMinutes !== trip.delayMinutes) {
        await enqueueOutbox(tx, {
          tenantId: s.tenantId,
          type: 'trip.delayed',
          payload: { tripId, delayMinutes },
          dedupeKey: `trip.delayed:${tripId}:${delayMinutes}`,
        });
      }
      await this.audit(tx, s, 'trips.delay_set', 'trip', tripId, requestId, { delayMinutes });
    });
  }

  /**
   * Breakdown / swap: put a different vehicle on a trip that is still open (including one already
   * on the road). Records the reason on the trip timeline, optionally takes the old vehicle out of
   * service, and queues a passenger notice. Overlap is enforced by the database.
   */
  async replaceVehicle(
    s: TenantScope,
    tripId: string,
    newVehicleId: string,
    reason: string,
    markOldOutOfService: boolean,
    requestId?: string,
  ) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const trip = await tx.trip.findFirst({ where: { id: tripId, tenantId: s.tenantId } });
          if (!trip) throw AppError.notFound();
          if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED') {
            throw AppError.conflict('This trip can no longer be changed');
          }
          if (trip.vehicleId === newVehicleId)
            throw AppError.conflict('That vehicle is already on this trip');
          const v = await tx.vehicle.findFirst({
            where: { id: newVehicleId, tenantId: s.tenantId },
          });
          if (!v) throw AppError.validation('Vehicle not found');
          if (v.status !== 'ACTIVE') throw AppError.conflict('That vehicle is not in service');
          const route = await tx.route.findFirstOrThrow({
            where: { id: trip.routeId, tenantId: s.tenantId },
          });
          assertVehicleCompatible(
            { allowedVehicleTypes: route.allowedVehicleTypes, minSeats: route.minSeats },
            v,
          );

          const old = trip.vehicleId
            ? await tx.vehicle.findFirst({ where: { id: trip.vehicleId, tenantId: s.tenantId } })
            : null;
          await assertSoldSeatsFit(tx, s.tenantId, tripId, newVehicleId);
          await tx.trip.update({ where: { id: tripId }, data: { vehicleId: newVehicleId } });

          let oldVehicleOtherTrips = 0;
          if (old && markOldOutOfService && old.status === 'ACTIVE') {
            await tx.vehicle.update({ where: { id: old.id }, data: { status: 'MAINTENANCE' } });
            oldVehicleOtherTrips = await tx.trip.count({
              where: {
                tenantId: s.tenantId,
                vehicleId: old.id,
                id: { not: tripId },
                status: { in: ['SCHEDULED', 'BOARDING'] },
                departureAt: { gt: new Date() },
              },
            });
          }
          await recordTripEvent(tx, s, tripId, 'VEHICLE_REPLACED', {
            from: old?.registration ?? null,
            to: v.registration,
            reason: reason.slice(0, 300),
            oldVehicleOutOfService: markOldOutOfService && old?.status === 'ACTIVE',
          });
          await enqueueOutbox(tx, {
            tenantId: s.tenantId,
            type: 'trip.vehicle_replaced',
            payload: { tripId, from: old?.registration ?? null, to: v.registration },
            dedupeKey: `trip.vehicle_replaced:${tripId}:${newVehicleId}`,
          });
          await this.audit(tx, s, 'trips.vehicle_replaced', 'trip', tripId, requestId, {
            to: v.registration,
          });
          return {
            capacityReduced: old ? v.seatingCapacity < old.seatingCapacity : false,
            oldVehicleOtherTrips,
          };
        }),
      { exclusion: EXCLUSION_MSG },
    );
  }
}
