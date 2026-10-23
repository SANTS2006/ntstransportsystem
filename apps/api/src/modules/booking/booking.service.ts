import { createHash, randomBytes } from 'node:crypto';
import { withDb, type Db, type Tx } from '../../platform/db.js';
import { mapDbErrors } from '../../platform/db-errors.js';
import { AppError } from '../../platform/errors.js';
import { enqueueOutbox } from '../../platform/outbox.js';
import { writeAudit } from '../audit/audit.js';
import { issueTicketsInTx, voidTicketsInTx } from '../ticket/ticket-core.js';
import type { Page } from '../catalog/catalog.service.js';
import type { TenantScope } from '../tenants/tenant.guards.js';

const ctxOf = (s: TenantScope) => ({ tenantId: s.tenantId, userId: s.userId });
export const MAX_SEATS_PER_BOOKING = 8;
export const HOLD_MINUTES = 15;
const SEAT_TAKEN = 'One of those seats was just taken. Please choose different seats.';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U

function newReference(): string {
  const bytes = randomBytes(10);
  return Array.from(bytes, (b) => ALPHABET[b % 32]).join('');
}

export interface BookingInput {
  tripId: string;
  serviceClass?: string | undefined;
  contact: { name: string; phone: string; email?: string | undefined };
  passengers: { fullName: string; seatLabel: string }[];
  /** Where the passengers get on and off. Both or neither; with them the price is set by stop. */
  boardingLocationId?: string | undefined;
  alightingLocationId?: string | undefined;
}

type BookingRow = Awaited<ReturnType<Tx['booking']['findFirstOrThrow']>> & {
  passengers: { seatLabel: string; fullName: string; fareMinor: number; releasedAt: Date | null }[];
  /** The desk payment, when the booking was paid at the counter. */
  payments?: { method: string | null; amountMinor: number; refundedAt: Date | null }[];
  /** A passenger's "I paid by QMoney" notice that staff have not looked at yet. */
  claims?: { method: string; reference: string; createdAt: Date }[];
};

/** Loads only the desk payment (at most one per booking) next to a booking. */
const DESK_PAYMENT = { where: { provider: 'DESK' }, take: 1 } as const;
const OPEN_CLAIM = {
  where: { status: 'PENDING' },
  orderBy: { createdAt: 'desc' },
  take: 1,
} as const;

const toDto = (b: BookingRow) => ({
  id: b.id,
  reference: b.reference,
  tripId: b.tripId,
  status: b.status,
  contactName: b.contactName,
  contactPhone: b.contactPhone,
  contactEmail: b.contactEmail,
  totalMinor: b.totalMinor,
  currency: b.currency,
  boardingLocationId: b.boardingLocationId,
  alightingLocationId: b.alightingLocationId,
  holdExpiresAt: b.holdExpiresAt?.toISOString() ?? null,
  createdAt: b.createdAt.toISOString(),
  passengers: b.passengers.map((p) => ({
    seatLabel: p.seatLabel,
    fullName: p.fullName,
    fareMinor: p.fareMinor,
  })),
  claim: b.claims?.[0]
    ? {
        method: b.claims[0].method,
        reference: b.claims[0].reference,
        createdAt: b.claims[0].createdAt.toISOString(),
      }
    : null,
  desk: b.payments?.[0]
    ? {
        method: b.payments[0].method,
        amountMinor: b.payments[0].amountMinor,
        refundedAt: b.payments[0].refundedAt?.toISOString() ?? null,
      }
    : null,
});

/** Status change + history row, only if the booking is still in `from` (atomic compare-and-set). */
async function transition(
  tx: Tx,
  tenantId: string,
  bookingId: string,
  from: ('PENDING_PAYMENT' | 'CONFIRMED')[],
  to: 'CONFIRMED' | 'CANCELLED' | 'EXPIRED',
  reason: string | null,
  actorUserId: string | null,
): Promise<{ from: string } | null> {
  const current = await tx.booking.findFirst({ where: { id: bookingId, tenantId } });
  if (!current || !from.includes(current.status as 'PENDING_PAYMENT' | 'CONFIRMED')) return null;
  const res = await tx.booking.updateMany({
    where: { id: bookingId, tenantId, status: current.status },
    data: { status: to, ...(to === 'CONFIRMED' ? {} : { holdExpiresAt: null }) },
  });
  if (res.count !== 1) return null; // someone else changed it first
  if (to !== 'CONFIRMED') {
    await voidTicketsInTx(tx, tenantId, bookingId, reason ?? to.toLowerCase());
    await tx.payment.updateMany({
      where: { tenantId, bookingId, status: { in: ['CREATED', 'PENDING'] } },
      data: { status: 'CANCELLED' },
    });
    await tx.bookingPassenger.updateMany({
      where: { tenantId, bookingId, releasedAt: null },
      data: { releasedAt: new Date() },
    });
  }
  await tx.bookingStatusHistory.createMany({
    data: [{ tenantId, bookingId, fromStatus: current.status, toStatus: to, reason, actorUserId }],
  });
  return { from: current.status };
}

/** Releases holds on the given seats whose payment window has passed, so they can be sold again. */
async function expireHeldSeats(tx: Tx, tenantId: string, tripId: string, seats: string[]) {
  const stale = await tx.bookingPassenger.findMany({
    where: {
      tenantId,
      tripId,
      seatLabel: { in: seats },
      releasedAt: null,
      booking: { status: 'PENDING_PAYMENT', holdExpiresAt: { lt: new Date() } },
    },
    select: { bookingId: true },
  });
  for (const id of new Set(stale.map((x) => x.bookingId))) {
    await transition(
      tx,
      tenantId,
      id,
      ['PENDING_PAYMENT'],
      'EXPIRED',
      'Payment window passed',
      null,
    );
  }
}

/** Seat labels a trip can sell: its vehicle's seat layout, or 1..capacity when none is linked. */
async function sellableSeats(tx: Tx, tenantId: string, vehicleId: string) {
  const vehicle = await tx.vehicle.findFirstOrThrow({ where: { id: vehicleId, tenantId } });
  if (vehicle.seatLayoutId) {
    const seats = await tx.seatLayoutSeat.findMany({
      where: { tenantId, layoutId: vehicle.seatLayoutId },
      orderBy: [{ rowNo: 'asc' }, { colNo: 'asc' }],
    });
    return seats.map((x) => ({ label: x.label, accessible: x.accessible }));
  }
  return Array.from({ length: vehicle.seatingCapacity }, (_, i) => ({
    label: String(i + 1),
    accessible: false,
  }));
}

/** A vehicle change must not strand passengers: every sold seat has to exist on the new vehicle. */
export async function assertSoldSeatsFit(
  tx: Tx,
  tenantId: string,
  tripId: string,
  vehicleId: string | null,
) {
  const sold = await tx.bookingPassenger.findMany({
    where: {
      tenantId,
      tripId,
      releasedAt: null,
      booking: { status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] } },
    },
    select: { seatLabel: true },
  });
  if (sold.length === 0) return;
  if (vehicleId === null)
    throw AppError.conflict('Seats are already sold on this trip: it needs a vehicle');
  const valid = new Set((await sellableSeats(tx, tenantId, vehicleId)).map((x) => x.label));
  const missing = sold.filter((x) => !valid.has(x.seatLabel)).map((x) => x.seatLabel);
  if (missing.length > 0) {
    throw AppError.conflict(
      `Seats ${missing.join(', ')} are already sold but do not exist on that vehicle`,
    );
  }
}

/**
 * Confirms a booking inside the caller's transaction. 'confirmed' and 'already' both mean the
 * passenger holds the seats; 'unavailable' means the hold lapsed or the booking was released.
 */
export async function confirmBookingInTx(
  tx: Tx,
  tenantId: string,
  bookingId: string,
  by?: { reason: string; actorUserId: string },
): Promise<'confirmed' | 'already' | 'unavailable'> {
  const b = await tx.booking.findFirst({ where: { id: bookingId, tenantId } });
  if (!b) return 'unavailable';
  if (b.status === 'CONFIRMED') return 'already';
  if (b.status !== 'PENDING_PAYMENT') return 'unavailable';
  const r = await transition(
    tx,
    tenantId,
    bookingId,
    ['PENDING_PAYMENT'],
    'CONFIRMED',
    by?.reason ?? 'Payment received',
    by?.actorUserId ?? null,
  );
  if (!r) return 'unavailable';
  await issueTicketsInTx(tx, tenantId, bookingId);
  await enqueueOutbox(tx, {
    tenantId,
    type: 'booking.confirmed',
    payload: { bookingId },
    dedupeKey: `booking.confirmed:${bookingId}`,
  });
  return 'confirmed';
}

/** Cancels every open booking on a trip (trip cancelled). Returns how many were cancelled. */
export async function cancelBookingsForTrip(
  tx: Tx,
  tenantId: string,
  tripId: string,
  actorUserId: string | null,
): Promise<number> {
  const open = await tx.booking.findMany({
    where: { tenantId, tripId, status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] } },
    select: { id: true, status: true },
  });
  let n = 0;
  for (const b of open) {
    const r = await transition(
      tx,
      tenantId,
      b.id,
      ['PENDING_PAYMENT', 'CONFIRMED'],
      'CANCELLED',
      'Trip cancelled',
      actorUserId,
    );
    if (!r) continue;
    n++;
    await enqueueOutbox(tx, {
      tenantId,
      type: 'booking.cancelled',
      payload: {
        bookingId: b.id,
        reason: 'trip_cancelled',
        refundRequired: r.from === 'CONFIRMED',
      },
      dedupeKey: `booking.cancelled:${b.id}`,
    });
  }
  return n;
}

export class BookingService {
  constructor(private readonly db: Db) {}

  // ---- Fares ---------------------------------------------------------------------------------

  async listFares(s: TenantScope, routeId: string) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const route = await tx.route.findFirst({ where: { id: routeId, tenantId: s.tenantId } });
      if (!route) throw AppError.notFound();
      const fares = await tx.fare.findMany({
        where: { tenantId: s.tenantId, routeId },
        orderBy: { serviceClass: 'asc' },
      });
      return fares.map((f) => ({
        serviceClass: f.serviceClass,
        amountMinor: f.amountMinor,
        currency: f.currency,
        active: f.active,
      }));
    });
  }

  async setFare(
    s: TenantScope,
    routeId: string,
    serviceClass: string,
    amountMinor: number,
    currency: string,
    active: boolean,
    requestId?: string,
  ) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const route = await tx.route.findFirst({ where: { id: routeId, tenantId: s.tenantId } });
          if (!route) throw AppError.notFound();
          await tx.fare.upsert({
            where: {
              tenantId_routeId_serviceClass: { tenantId: s.tenantId, routeId, serviceClass },
            },
            create: { tenantId: s.tenantId, routeId, serviceClass, amountMinor, currency, active },
            update: { amountMinor, currency, active },
          });
          // Existing bookings keep the price they were sold at: only new sales see the change.
          await writeAudit(tx, {
            action: 'booking.fare_set',
            outcome: 'SUCCESS',
            tenantId: s.tenantId,
            actorUserId: s.userId,
            targetType: 'route',
            targetId: routeId,
            requestId,
            summary: { serviceClass, amountMinor, currency, active },
          });
        }),
      { check: 'Amount must be zero or more and the currency a 3-letter code' },
    );
  }

  // ---- Fares by stop ---------------------------------------------------------------------------

  /** The places along a route in the order the vehicle visits them: origin, stops, destination. */
  private async orderedStops(tx: Tx, tenantId: string, routeId: string) {
    const route = await tx.route.findFirst({
      where: { id: routeId, tenantId },
      include: {
        origin: { select: { id: true, name: true, city: true } },
        destination: { select: { id: true, name: true, city: true } },
        stops: {
          orderBy: { sequence: 'asc' },
          include: { location: { select: { id: true, name: true, city: true } } },
        },
      },
    });
    if (!route) throw AppError.notFound();
    return [route.origin, ...route.stops.map((x) => x.location), route.destination].map(
      (l, position) => ({ locationId: l.id, name: l.name, city: l.city, position }),
    );
  }

  /** The stops of a route and the price set for each pair of them. */
  async listStopFares(s: TenantScope, routeId: string) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const stops = await this.orderedStops(tx, s.tenantId, routeId);
      const fares = await tx.stopFare.findMany({ where: { tenantId: s.tenantId, routeId } });
      return {
        stops,
        fares: fares.map((f) => ({
          fromLocationId: f.fromLocationId,
          toLocationId: f.toLocationId,
          amountMinor: f.amountMinor,
          currency: f.currency,
        })),
      };
    });
  }

  /** Replaces the whole price list of a route. Each price is from an earlier stop to a later one. */
  async setStopFares(
    s: TenantScope,
    routeId: string,
    fares: { fromLocationId: string; toLocationId: string; amountMinor: number }[],
    requestId?: string,
  ) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const stops = await this.orderedStops(tx, s.tenantId, routeId);
          const at = new Map(stops.map((x) => [x.locationId, x.position]));
          const seen = new Set<string>();
          for (const f of fares) {
            const a = at.get(f.fromLocationId);
            const b = at.get(f.toLocationId);
            if (a === undefined || b === undefined) {
              throw AppError.validation('Every price must be between two stops of this route');
            }
            if (a >= b) {
              throw AppError.validation('A price goes from an earlier stop to a later one');
            }
            const key = `${f.fromLocationId}>${f.toLocationId}`;
            if (seen.has(key)) throw AppError.validation('Each pair of stops can be priced once');
            seen.add(key);
          }
          const tenant = await tx.tenant.findUniqueOrThrow({
            where: { id: s.tenantId },
            select: { defaultCurrency: true },
          });
          await tx.stopFare.deleteMany({ where: { tenantId: s.tenantId, routeId } });
          if (fares.length > 0) {
            await tx.stopFare.createMany({
              data: fares.map((f) => ({
                tenantId: s.tenantId,
                routeId,
                fromLocationId: f.fromLocationId,
                toLocationId: f.toLocationId,
                amountMinor: f.amountMinor,
                currency: tenant.defaultCurrency,
              })),
            });
          }
          // Existing bookings keep the price they were sold at.
          await writeAudit(tx, {
            action: 'booking.stop_fares_set',
            outcome: 'SUCCESS',
            tenantId: s.tenantId,
            actorUserId: s.userId,
            targetType: 'route',
            targetId: routeId,
            requestId,
            summary: { prices: fares.length },
          });
        }),
      { check: 'Amounts must be zero or more' },
    );
  }

  // ---- Availability --------------------------------------------------------------------------

  async seatMap(s: TenantScope, tripId: string) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const trip = await tx.trip.findFirst({ where: { id: tripId, tenantId: s.tenantId } });
      if (!trip) throw AppError.notFound();
      if (!trip.vehicleId) return { tripId, seats: [], sellable: false };
      const seats = await sellableSeats(tx, s.tenantId, trip.vehicleId);
      const taken = await tx.bookingPassenger.findMany({
        where: {
          tenantId: s.tenantId,
          tripId,
          releasedAt: null,
          booking: {
            OR: [
              { status: 'CONFIRMED' },
              { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: new Date() } },
            ],
          },
        },
        select: { seatLabel: true },
      });
      const takenSet = new Set(taken.map((t) => t.seatLabel));
      return {
        tripId,
        sellable: ['SCHEDULED', 'BOARDING'].includes(trip.status) && trip.departureAt > new Date(),
        seats: seats.map((x) => ({
          label: x.label,
          accessible: x.accessible,
          status: takenSet.has(x.label) ? ('TAKEN' as const) : ('AVAILABLE' as const),
        })),
      };
    });
  }

  // ---- Create --------------------------------------------------------------------------------

  /**
   * Creates a booking with a timed seat hold. Seats are claimed by inserting rows that race on a
   * partial unique index (trip, seat), so two buyers can never hold the same seat; the loser gets
   * a 409. A repeated Idempotency-Key returns the original booking instead of creating another.
   */
  async create(s: TenantScope, input: BookingInput, idempotencyKey?: string, requestId?: string) {
    const seats = input.passengers.map((p) => p.seatLabel);
    if (new Set(seats).size !== seats.length)
      throw AppError.validation('A seat can only be chosen once');
    if (seats.length < 1 || seats.length > MAX_SEATS_PER_BOOKING) {
      throw AppError.validation(`Choose between 1 and ${MAX_SEATS_PER_BOOKING} seats`);
    }
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          ...input,
          passengers: [...input.passengers].sort((a, b) => a.seatLabel.localeCompare(b.seatLabel)),
        }),
      )
      .digest('hex');

    const replay = async () => {
      if (!idempotencyKey) return null;
      return withDb(this.db, ctxOf(s), async (tx) => {
        const existing = await tx.booking.findFirst({
          where: { tenantId: s.tenantId, idempotencyKey },
          include: { passengers: true },
        });
        if (!existing) return null;
        if (existing.requestHash !== requestHash) {
          throw AppError.conflict('This Idempotency-Key was already used with a different request');
        }
        return toDto(existing);
      });
    };
    const prior = await replay();
    if (prior) return { booking: prior, replayed: true };

    try {
      const booking = await mapDbErrors(
        () =>
          withDb(this.db, ctxOf(s), async (tx) => {
            const trip = await tx.trip.findFirst({
              where: { id: input.tripId, tenantId: s.tenantId },
            });
            if (!trip) throw AppError.validation('Trip not found');
            if (
              !['SCHEDULED', 'BOARDING'].includes(trip.status) ||
              trip.departureAt <= new Date()
            ) {
              throw AppError.conflict('This trip is not open for booking');
            }
            if (!trip.vehicleId)
              throw AppError.conflict('This trip has no vehicle yet, so seats cannot be sold');
            const serviceClass = input.serviceClass ?? 'STANDARD';
            const boarding = input.boardingLocationId;
            const alighting = input.alightingLocationId;
            if (Boolean(boarding) !== Boolean(alighting)) {
              throw AppError.validation(
                'Choose both the stop to get on at and the stop to get off at',
              );
            }
            let fare: { amountMinor: number; currency: string } | null = null;
            if (boarding && alighting) {
              const stops = await this.orderedStops(tx, s.tenantId, trip.routeId);
              const a = stops.find((x) => x.locationId === boarding)?.position;
              const b = stops.find((x) => x.locationId === alighting)?.position;
              if (a === undefined || b === undefined || a >= b) {
                throw AppError.validation(
                  'Choose a stop to get on at and a later stop to get off at',
                );
              }
              fare = await tx.stopFare.findFirst({
                where: {
                  tenantId: s.tenantId,
                  routeId: trip.routeId,
                  fromLocationId: boarding,
                  toLocationId: alighting,
                },
              });
              if (!fare) throw AppError.conflict('No price is set between these two stops');
            } else {
              fare = await tx.fare.findFirst({
                where: { tenantId: s.tenantId, routeId: trip.routeId, serviceClass, active: true },
              });
              if (!fare) throw AppError.conflict('No fare is set for this route and class');
            }
            const valid = new Set(
              (await sellableSeats(tx, s.tenantId, trip.vehicleId)).map((x) => x.label),
            );
            const bad = seats.find((l) => !valid.has(l));
            if (bad) throw AppError.validation(`Seat ${bad} does not exist on this vehicle`);

            await expireHeldSeats(tx, s.tenantId, trip.id, seats);

            const holdExpiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000);
            const b = await tx.booking.create({
              data: {
                tenantId: s.tenantId,
                tripId: trip.id,
                reference: newReference(),
                contactName: input.contact.name,
                contactPhone: input.contact.phone,
                contactEmail: input.contact.email ?? null,
                totalMinor: fare.amountMinor * seats.length,
                currency: fare.currency,
                boardingLocationId: boarding ?? null,
                alightingLocationId: alighting ?? null,
                holdExpiresAt,
                idempotencyKey: idempotencyKey ?? null,
                requestHash,
                createdByUserId: s.userId,
              },
            });
            await tx.bookingPassenger.createMany({
              data: input.passengers.map((p) => ({
                tenantId: s.tenantId,
                bookingId: b.id,
                tripId: trip.id,
                seatLabel: p.seatLabel,
                fullName: p.fullName,
                fareMinor: fare.amountMinor,
              })),
            });
            await tx.bookingStatusHistory.createMany({
              data: [
                {
                  tenantId: s.tenantId,
                  bookingId: b.id,
                  fromStatus: null,
                  toStatus: 'PENDING_PAYMENT',
                  actorUserId: s.userId,
                },
              ],
            });
            await writeAudit(tx, {
              action: 'booking.created',
              outcome: 'SUCCESS',
              tenantId: s.tenantId,
              actorUserId: s.userId,
              targetType: 'booking',
              targetId: b.id,
              requestId,
              summary: { seats: seats.length, totalMinor: b.totalMinor },
            });
            return toDto({
              ...b,
              passengers: input.passengers.map((p) => ({
                ...p,
                fareMinor: fare.amountMinor,
                releasedAt: null,
              })),
            });
          }),
        { unique: SEAT_TAKEN },
      );
      return { booking, replayed: false };
    } catch (err) {
      // A concurrent request with the same key may have won the race: return its booking.
      const again = await replay();
      if (again) return { booking: again, replayed: true };
      throw err;
    }
  }

  // ---- Read ----------------------------------------------------------------------------------

  async list(
    s: TenantScope,
    page: Page,
    f: { status?: string | undefined; tripId?: string | undefined; q?: string | undefined },
  ) {
    const rows = await withDb(this.db, ctxOf(s), (tx) =>
      tx.booking.findMany({
        where: {
          tenantId: s.tenantId,
          ...(f.status ? { status: f.status as 'CONFIRMED' } : {}),
          ...(f.tripId ? { tripId: f.tripId } : {}),
          ...(f.q
            ? { OR: [{ reference: f.q.toUpperCase() }, { contactPhone: { contains: f.q } }] }
            : {}),
        },
        include: { passengers: true, payments: DESK_PAYMENT, claims: OPEN_CLAIM },
        orderBy: { createdAt: 'desc' },
        take: page.limit,
        skip: page.offset,
      }),
    );
    return rows.map(toDto);
  }

  async get(s: TenantScope, id: string) {
    const b = await withDb(this.db, ctxOf(s), (tx) =>
      tx.booking.findFirst({
        where: { id, tenantId: s.tenantId },
        include: {
          passengers: true,
          payments: DESK_PAYMENT,
          claims: OPEN_CLAIM,
          history: { orderBy: { createdAt: 'asc' } },
        },
      }),
    );
    if (!b) throw AppError.notFound();
    return {
      ...toDto(b),
      history: b.history.map((h) => ({
        from: h.fromStatus,
        to: h.toStatus,
        reason: h.reason,
        at: h.createdAt.toISOString(),
      })),
    };
  }

  // ---- Lifecycle -----------------------------------------------------------------------------

  async cancel(s: TenantScope, id: string, reason: string, requestId?: string) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const b = await tx.booking.findFirst({
        where: { id, tenantId: s.tenantId },
        include: { trip: true },
      });
      if (!b) throw AppError.notFound();
      if (b.trip.departureAt <= new Date() && b.status === 'CONFIRMED') {
        throw AppError.conflict('A confirmed booking cannot be cancelled after departure');
      }
      const r = await transition(
        tx,
        s.tenantId,
        id,
        ['PENDING_PAYMENT', 'CONFIRMED'],
        'CANCELLED',
        reason,
        s.userId,
      );
      if (!r) throw AppError.conflict('This booking can no longer be cancelled');
      // Money already paid is refunded by the payments module (Phase 6); this only flags it.
      const refundRequired = r.from === 'CONFIRMED';
      await enqueueOutbox(tx, {
        tenantId: s.tenantId,
        type: 'booking.cancelled',
        payload: { bookingId: id, reason: 'cancelled', refundRequired },
        dedupeKey: `booking.cancelled:${id}`,
      });
      await writeAudit(tx, {
        action: 'booking.cancelled',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'booking',
        targetId: id,
        requestId,
        summary: { refundRequired },
      });
      return { refundRequired };
    });
  }

  /**
   * Called by the payments module once a payment is verified as received. Not exposed over HTTP:
   * nobody can mark a booking paid by calling the API. Fails if the hold has lapsed.
   */
  async markPaid(tenantId: string, bookingId: string): Promise<void> {
    await withDb(this.db, { tenantId }, async (tx) => {
      const r = await confirmBookingInTx(tx, tenantId, bookingId);
      if (r === 'unavailable')
        throw AppError.conflict('The seat hold has expired or the booking was cancelled');
    });
  }

  /**
   * Staff take payment at the counter and the booking is confirmed on the spot. Unlike the online
   * path there is no provider to ask, so the safeguards are: a permission of its own, one desk
   * payment per booking (database-enforced), the amount is always the booking's own total (never
   * typed in), the payment row records the method and who took it, and the action is audited.
   * Any online checkout still open for the booking is closed; if that customer pays online anyway
   * it is flagged for a refund by the payments module.
   */
  async collectAtDesk(
    s: TenantScope,
    bookingId: string,
    input: {
      method: 'CASH' | 'MOBILE_MONEY' | 'BANK_TRANSFER' | 'ORANGE_MONEY' | 'AFRIMONEY' | 'QMONEY';
      reference?: string | undefined;
    },
    requestId?: string,
  ) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const b = await tx.booking.findFirst({ where: { id: bookingId, tenantId: s.tenantId } });
          if (!b) throw AppError.notFound();
          if (b.status === 'CONFIRMED') throw AppError.conflict('This booking is already paid');
          if (b.status !== 'PENDING_PAYMENT') {
            throw AppError.conflict('This booking was cancelled or its hold expired');
          }
          await tx.payment.updateMany({
            where: { tenantId: s.tenantId, bookingId, status: { in: ['CREATED', 'PENDING'] } },
            data: { status: 'CANCELLED', lastError: 'Paid at the desk' },
          });
          const now = new Date();
          const payment = await tx.payment.create({
            data: {
              tenantId: s.tenantId,
              bookingId,
              provider: 'DESK',
              status: 'PAID',
              amountMinor: b.totalMinor,
              currency: b.currency,
              idempotencyKey: `desk:${bookingId}`,
              paidAt: now,
              method: input.method,
              collectedBy: s.userId,
              reference: input.reference ?? null,
            },
          });
          const outcome = await confirmBookingInTx(tx, s.tenantId, bookingId, {
            reason: `Paid at the desk (${input.method.toLowerCase().replaceAll('_', ' ')})`,
            actorUserId: s.userId,
          });
          if (outcome !== 'confirmed') {
            throw AppError.conflict('This booking can no longer be confirmed');
          }
          // A passenger's QMoney notice for this booking is now dealt with.
          await tx.paymentClaim.updateMany({
            where: { tenantId: s.tenantId, bookingId, status: 'PENDING' },
            data: { status: 'CONFIRMED', resolvedAt: now, resolvedBy: s.userId },
          });
          await writeAudit(tx, {
            action: 'payment.collected_at_desk',
            outcome: 'SUCCESS',
            tenantId: s.tenantId,
            actorUserId: s.userId,
            targetType: 'payment',
            targetId: payment.id,
            requestId,
            summary: {
              bookingId,
              amountMinor: b.totalMinor,
              currency: b.currency,
              method: input.method,
            },
          });
          return {
            id: payment.id,
            bookingId,
            method: input.method,
            amountMinor: b.totalMinor,
            currency: b.currency,
            reference: input.reference ?? null,
            paidAt: now.toISOString(),
          };
        }),
      { unique: 'This booking is already paid' },
    );
  }

  /**
   * Records that the money for a cancelled, desk-paid booking was handed back. The whole amount
   * goes back (no partial refunds), once, and only for a cancelled booking; it is a record of
   * what the staff did, so it needs the stronger payment.manage permission and is audited.
   */
  async refundDesk(
    s: TenantScope,
    bookingId: string,
    input: { reference?: string | undefined },
    requestId?: string,
  ) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const b = await tx.booking.findFirst({ where: { id: bookingId, tenantId: s.tenantId } });
      if (!b) throw AppError.notFound();
      const pay = await tx.payment.findFirst({
        where: { tenantId: s.tenantId, bookingId, provider: 'DESK', status: 'PAID' },
      });
      if (!pay) throw AppError.conflict('This booking was not paid at the desk');
      if (b.status !== 'CANCELLED') {
        throw AppError.conflict('Cancel the booking first; only a cancelled booking is refunded');
      }
      const now = new Date();
      const res = await tx.payment.updateMany({
        where: { id: pay.id, tenantId: s.tenantId, refundedAt: null },
        data: { refundedAt: now, refundedBy: s.userId, refundReference: input.reference ?? null },
      });
      if (res.count !== 1) throw AppError.conflict('This payment was already refunded');
      await writeAudit(tx, {
        action: 'payment.desk_refund_recorded',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'payment',
        targetId: pay.id,
        requestId,
        summary: { bookingId, amountMinor: pay.amountMinor, method: pay.method },
      });
      return {
        id: pay.id,
        bookingId,
        method: pay.method,
        amountMinor: pay.amountMinor,
        currency: pay.currency,
        refundedAt: now.toISOString(),
        reference: input.reference ?? null,
      };
    });
  }

  /**
   * Background sweep: expires unpaid bookings whose hold ran out and frees their seats. Each
   * booking is handled in its own short transaction so a large backlog (or one bad row) cannot
   * make the whole sweep time out.
   */
  async expireDue(limit = 100, onlyTenantId?: string): Promise<number> {
    const due = await withDb(this.db, { platform: true }, (tx) =>
      tx.booking.findMany({
        where: {
          status: 'PENDING_PAYMENT',
          holdExpiresAt: { lt: new Date() },
          ...(onlyTenantId ? { tenantId: onlyTenantId } : {}),
        },
        select: { id: true, tenantId: true },
        orderBy: { holdExpiresAt: 'asc' },
        take: limit,
      }),
    );
    let n = 0;
    for (const b of due) {
      try {
        const done = await withDb(this.db, { tenantId: b.tenantId }, (tx) =>
          transition(
            tx,
            b.tenantId,
            b.id,
            ['PENDING_PAYMENT'],
            'EXPIRED',
            'Payment window passed',
            null,
          ),
        );
        if (done) n++;
      } catch {
        // Skipped rows are picked up by the next sweep.
      }
    }
    return n;
  }
}
