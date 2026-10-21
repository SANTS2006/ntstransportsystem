import { createHash, randomBytes } from 'node:crypto';
import { withDb, type Db, type Tx } from '../../platform/db.js';
import { mapDbErrors } from '../../platform/db-errors.js';
import { AppError } from '../../platform/errors.js';
import { enqueueOutbox } from '../../platform/outbox.js';
import { writeAudit } from '../audit/audit.js';
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
}

type BookingRow = Awaited<ReturnType<Tx['booking']['findFirstOrThrow']>> & {
  passengers: { seatLabel: string; fullName: string; fareMinor: number; releasedAt: Date | null }[];
};

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
  holdExpiresAt: b.holdExpiresAt?.toISOString() ?? null,
  createdAt: b.createdAt.toISOString(),
  passengers: b.passengers.map((p) => ({
    seatLabel: p.seatLabel,
    fullName: p.fullName,
    fareMinor: p.fareMinor,
  })),
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
            const fare = await tx.fare.findFirst({
              where: { tenantId: s.tenantId, routeId: trip.routeId, serviceClass, active: true },
            });
            if (!fare) throw AppError.conflict('No fare is set for this route and class');
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
        include: { passengers: true },
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
        include: { passengers: true, history: { orderBy: { createdAt: 'asc' } } },
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
      const b = await tx.booking.findFirst({ where: { id: bookingId, tenantId } });
      if (!b) throw AppError.notFound();
      if (b.status === 'CONFIRMED') return; // idempotent
      if (b.status !== 'PENDING_PAYMENT' || !b.holdExpiresAt || b.holdExpiresAt <= new Date()) {
        throw AppError.conflict('The seat hold has expired or the booking was cancelled');
      }
      const r = await transition(
        tx,
        tenantId,
        bookingId,
        ['PENDING_PAYMENT'],
        'CONFIRMED',
        'Payment received',
        null,
      );
      if (!r) throw AppError.conflict('The booking changed while confirming');
      await enqueueOutbox(tx, {
        tenantId,
        type: 'booking.confirmed',
        payload: { bookingId },
        dedupeKey: `booking.confirmed:${bookingId}`,
      });
    });
  }

  /** Background sweep: expires unpaid bookings whose hold ran out and frees their seats. */
  async expireDue(limit = 200): Promise<number> {
    return withDb(this.db, { platform: true }, async (tx) => {
      const due = await tx.booking.findMany({
        where: { status: 'PENDING_PAYMENT', holdExpiresAt: { lt: new Date() } },
        select: { id: true, tenantId: true },
        take: limit,
      });
      let n = 0;
      for (const b of due) {
        if (
          await transition(
            tx,
            b.tenantId,
            b.id,
            ['PENDING_PAYMENT'],
            'EXPIRED',
            'Payment window passed',
            null,
          )
        )
          n++;
      }
      return n;
    });
  }
}
