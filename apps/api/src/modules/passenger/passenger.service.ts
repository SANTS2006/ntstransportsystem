import { withDb, type Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import type { BookingService } from '../booking/booking.service.js';
import { type BookingInput } from '../booking/booking.service.js';
import type { PayMethod } from '../payment/methods.js';
import type { PaymentService } from '../payment/payment.service.js';
import type { TicketService } from '../ticket/ticket.service.js';
import { receiptPdfFor, ticketsPdfFor } from '../ticket/ticket.routes.js';
import type { TenantScope } from '../tenants/tenant.guards.js';

const MAX_OPEN_BOOKINGS_PER_PASSENGER = 3;

/**
 * Passengers are signed-in users who are not necessarily members of any company. Reads here span
 * companies, so they run in platform scope with fixed, explicit filters (only sellable trips of
 * active companies; only the caller's own bookings). Writes go through the normal tenant-scoped
 * services, under the selling company's row-level security.
 */
export class PassengerService {
  constructor(
    private readonly db: Db,
    private readonly bookings: BookingService,
    private readonly payments: PaymentService,
    private readonly tickets: TicketService,
  ) {}

  /** A scope for acting as a passenger inside one company: no company permissions at all. */
  private scopeFor(tenantId: string, userId: string): TenantScope {
    return {
      tenantId,
      userId,
      permissions: new Set(),
      roleKey: 'passenger',
      roleId: '',
      tenantStatus: 'ACTIVE',
    };
  }

  private sellableTripFilter(now: Date) {
    return {
      status: { in: ['SCHEDULED', 'BOARDING'] as ('SCHEDULED' | 'BOARDING')[] },
      departureAt: { gt: now },
      vehicleId: { not: null },
      route: { status: 'PUBLISHED' as const, fares: { some: { active: true } } },
      tenant: {
        status: 'ACTIVE' as const,
        // Bookable online when the company takes Monime payments or publishes a QMoney number.
        OR: [
          { paymentSettings: { is: { enabled: true } } },
          { manualPayment: { is: { qmoneyNumber: { not: null } } } },
        ],
      },
    };
  }

  /** Public search. Only trips that can actually be bought online are returned. */
  async search(q: { from?: string | undefined; to?: string | undefined; date: string }) {
    const now = new Date();
    return withDb(this.db, { platform: true }, async (tx) => {
      const trips = await tx.trip.findMany({
        where: {
          ...this.sellableTripFilter(now),
          serviceDate: new Date(`${q.date}T00:00:00.000Z`),
          route: {
            ...this.sellableTripFilter(now).route,
            ...(q.from
              ? { origin: { city: { contains: q.from, mode: 'insensitive' as const } } }
              : {}),
            ...(q.to
              ? { destination: { city: { contains: q.to, mode: 'insensitive' as const } } }
              : {}),
          },
        },
        include: {
          tenant: { select: { name: true, timezone: true } },
          vehicle: { select: { seatingCapacity: true } },
          route: {
            select: {
              name: true,
              origin: { select: { name: true, city: true } },
              destination: { select: { name: true, city: true } },
              fares: {
                where: { active: true },
                select: { serviceClass: true, amountMinor: true, currency: true },
              },
            },
          },
        },
        orderBy: { departureAt: 'asc' },
        take: 50,
      });
      const taken = trips.length
        ? await tx.bookingPassenger.groupBy({
            by: ['tripId'],
            where: {
              tripId: { in: trips.map((t) => t.id) },
              releasedAt: null,
              booking: {
                OR: [
                  { status: 'CONFIRMED' },
                  { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } },
                ],
              },
            },
            _count: true,
          })
        : [];
      const takenBy = new Map(taken.map((t) => [t.tripId, t._count]));
      return trips.map((t) => {
        const fare = t.route.fares.find((f) => f.serviceClass === 'STANDARD') ?? t.route.fares[0]!;
        return {
          tripId: t.id,
          tenantId: t.tenantId,
          company: t.tenant.name,
          timezone: t.tenant.timezone,
          route: t.route.name,
          origin: t.route.origin,
          destination: t.route.destination,
          departureAt: t.departureAt.toISOString(),
          arrivalAt: t.arrivalAt.toISOString(),
          delayMinutes: t.delayMinutes,
          fareMinor: fare.amountMinor,
          currency: fare.currency,
          seatsLeft: Math.max(0, (t.vehicle?.seatingCapacity ?? 0) - (takenBy.get(t.id) ?? 0)),
        };
      });
    });
  }

  /** One sellable trip: summary plus seat map. */
  async tripDetail(tenantId: string, tripId: string) {
    const now = new Date();
    const t = await withDb(this.db, { platform: true }, (tx) =>
      tx.trip.findFirst({
        where: { id: tripId, tenantId, ...this.sellableTripFilter(now) },
        include: {
          tenant: { select: { name: true, timezone: true } },
          route: {
            select: {
              name: true,
              origin: { select: { name: true, city: true } },
              destination: { select: { name: true, city: true } },
              fares: {
                where: { active: true },
                select: { serviceClass: true, amountMinor: true, currency: true },
              },
            },
          },
        },
      }),
    );
    if (!t) throw AppError.notFound();
    const fare = t.route.fares.find((f) => f.serviceClass === 'STANDARD') ?? t.route.fares[0]!;
    const map = await this.bookings.seatMap(this.scopeFor(tenantId, ''), tripId);
    return {
      tripId: t.id,
      tenantId,
      company: t.tenant.name,
      timezone: t.tenant.timezone,
      route: t.route.name,
      origin: t.route.origin,
      destination: t.route.destination,
      departureAt: t.departureAt.toISOString(),
      arrivalAt: t.arrivalAt.toISOString(),
      delayMinutes: t.delayMinutes,
      fareMinor: fare.amountMinor,
      currency: fare.currency,
      sellable: map.sellable,
      seats: map.seats,
    };
  }

  async create(
    userId: string,
    tenantId: string,
    input: BookingInput,
    idempotencyKey?: string,
    requestId?: string,
  ) {
    const now = new Date();
    const ok = await withDb(this.db, { platform: true }, async (tx) => {
      const trip = await tx.trip.findFirst({
        where: { id: input.tripId, tenantId, ...this.sellableTripFilter(now) },
        select: { id: true },
      });
      if (!trip) return null;
      // Stops one account from holding the whole bus: open (unpaid, unexpired) bookings are capped.
      const open = await tx.booking.count({
        where: { createdByUserId: userId, status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } },
      });
      return { open };
    });
    if (!ok) throw AppError.notFound('That trip is not available for online booking');
    if (ok.open >= MAX_OPEN_BOOKINGS_PER_PASSENGER) {
      // A retry of an earlier request (same key) is replayed, not counted against the cap.
      const retry = idempotencyKey
        ? await withDb(this.db, { platform: true }, (tx) =>
            tx.booking.findFirst({
              where: { tenantId, createdByUserId: userId, idempotencyKey },
              select: { id: true },
            }),
          )
        : null;
      if (!retry) {
        throw AppError.conflict(
          'You have unpaid bookings. Pay for or cancel them before booking more.',
        );
      }
    }
    return this.bookings.create(this.scopeFor(tenantId, userId), input, idempotencyKey, requestId);
  }

  private static readonly include = {
    passengers: true,
    tenant: { select: { name: true, timezone: true } },
    trip: {
      select: {
        departureAt: true,
        arrivalAt: true,
        delayMinutes: true,
        status: true,
        route: {
          select: {
            name: true,
            origin: { select: { name: true, city: true } },
            destination: { select: { name: true, city: true } },
          },
        },
      },
    },
    payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } },
    claims: {
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { method: true, reference: true, createdAt: true },
    },
  } as const;

  private async ownBooking(userId: string, bookingId: string) {
    const b = await withDb(this.db, { platform: true }, (tx) =>
      tx.booking.findFirst({
        where: { id: bookingId, createdByUserId: userId },
        include: PassengerService.include,
      }),
    );
    if (!b) throw AppError.notFound(); // someone else's booking looks exactly like a missing one
    return b;
  }

  private dto(b: Awaited<ReturnType<PassengerService['ownBooking']>>) {
    return {
      id: b.id,
      tenantId: b.tenantId,
      reference: b.reference,
      status: b.status,
      company: b.tenant.name,
      timezone: b.tenant.timezone,
      route: b.trip.route.name,
      origin: b.trip.route.origin,
      destination: b.trip.route.destination,
      departureAt: b.trip.departureAt.toISOString(),
      arrivalAt: b.trip.arrivalAt.toISOString(),
      delayMinutes: b.trip.delayMinutes,
      tripStatus: b.trip.status,
      totalMinor: b.totalMinor,
      currency: b.currency,
      holdExpiresAt:
        b.status === 'PENDING_PAYMENT' ? (b.holdExpiresAt?.toISOString() ?? null) : null,
      paymentStatus: b.payments[0]?.status ?? null,
      claim: b.claims[0]
        ? {
            method: b.claims[0].method,
            reference: b.claims[0].reference,
            createdAt: b.claims[0].createdAt.toISOString(),
          }
        : null,
      passengers: b.passengers
        .filter((p) => p.releasedAt === null)
        .map((p) => ({ seatLabel: p.seatLabel, fullName: p.fullName })),
    };
  }

  async list(userId: string) {
    const rows = await withDb(this.db, { platform: true }, (tx) =>
      tx.booking.findMany({
        where: { createdByUserId: userId },
        include: PassengerService.include,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
    return rows.map((r) => this.dto(r));
  }

  async get(userId: string, bookingId: string) {
    return this.dto(await this.ownBooking(userId, bookingId));
  }

  async ticketList(userId: string, bookingId: string) {
    const b = await this.ownBooking(userId, bookingId);
    return this.tickets.listForBooking(this.scopeFor(b.tenantId, userId), bookingId);
  }
  async ticketsPdf(userId: string, bookingId: string) {
    const b = await this.ownBooking(userId, bookingId);
    return ticketsPdfFor(this.tickets, this.scopeFor(b.tenantId, userId), bookingId);
  }
  async receiptPdf(userId: string, bookingId: string) {
    const b = await this.ownBooking(userId, bookingId);
    return receiptPdfFor(this.tickets, this.scopeFor(b.tenantId, userId), bookingId);
  }

  async pay(userId: string, bookingId: string, requestId?: string, method?: PayMethod | 'ONLINE') {
    const b = await this.ownBooking(userId, bookingId);
    return this.payments.start(this.scopeFor(b.tenantId, userId), bookingId, requestId, method);
  }

  /** The booking and every way its owner can pay it. */
  async paymentOptions(userId: string, bookingId: string) {
    const b = await this.ownBooking(userId, bookingId);
    const options =
      b.status === 'PENDING_PAYMENT'
        ? await this.payments.options(this.scopeFor(b.tenantId, userId))
        : [];
    return { booking: this.dto(b), options };
  }

  /** "I paid by QMoney, here is the transaction number": tells staff what to look for. */
  async manualPayment(
    userId: string,
    bookingId: string,
    input: { reference: string },
    requestId?: string,
  ) {
    const b = await this.ownBooking(userId, bookingId);
    return this.payments.submitClaim(
      this.scopeFor(b.tenantId, userId),
      bookingId,
      input,
      requestId,
    );
  }

  async cancel(userId: string, bookingId: string, requestId?: string) {
    const b = await this.ownBooking(userId, bookingId);
    if (b.status !== 'PENDING_PAYMENT') {
      throw AppError.conflict(
        'Only unpaid bookings can be cancelled online. Please contact the company.',
      );
    }
    await this.bookings.cancel(
      this.scopeFor(b.tenantId, userId),
      bookingId,
      'Cancelled by passenger',
      requestId,
    );
  }

  /**
   * Status for the page the customer returns to after paying. If a payment is still open it is
   * re-checked with the provider (the redirect itself proves nothing), then the booking is read.
   */
  async status(userId: string, bookingId: string) {
    const b = await this.ownBooking(userId, bookingId);
    if (b.status === 'PENDING_PAYMENT' && b.payments[0]?.status === 'PENDING') {
      const open = await withDb(this.db, { platform: true }, (tx) =>
        tx.payment.findFirst({ where: { bookingId, status: 'PENDING' }, select: { id: true } }),
      );
      if (open) await this.payments.settle(b.tenantId, open.id).catch(() => undefined);
    }
    return this.dto(await this.ownBooking(userId, bookingId));
  }
}
