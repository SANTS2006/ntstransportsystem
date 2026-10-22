import { withDb, type Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../audit/audit.js';
import type { TenantScope } from '../tenants/tenant.guards.js';
import {
  formatTicketCode,
  issueTicketsInTx,
  normalizeTicketCode,
  parseTicketToken,
  ticketToken,
} from './ticket-core.js';

const ctxOf = (s: TenantScope) => ({ tenantId: s.tenantId, userId: s.userId });
/** Boarding opens this long before departure. */
export const BOARDING_OPENS_MIN = 180;

export type ScanReason =
  | 'INVALID_CODE'
  | 'NOT_FOUND'
  | 'VOID'
  | 'BOOKING_NOT_CONFIRMED'
  | 'TRIP_NOT_RUNNING'
  | 'WRONG_TRIP'
  | 'TOO_EARLY'
  | 'TRIP_ENDED'
  | 'ALREADY_BOARDED';

const MESSAGES: Record<ScanReason, string> = {
  INVALID_CODE: 'This code is not a valid ticket.',
  NOT_FOUND: 'No ticket was found for this code.',
  VOID: 'This ticket was cancelled.',
  BOOKING_NOT_CONFIRMED: 'This booking is not confirmed.',
  TRIP_NOT_RUNNING: 'This trip is cancelled or already finished.',
  WRONG_TRIP: 'This ticket is for a different trip.',
  TOO_EARLY: 'Boarding has not opened yet for this trip.',
  TRIP_ENDED: 'This trip has already ended.',
  ALREADY_BOARDED: 'This ticket has already been used.',
};

export type ScanResult =
  | {
      ok: true;
      ticket: { id: string; seat: string; passengerName: string; code: string };
      trip: { id: string; route: string; departureAt: string };
    }
  | { ok: false; reason: ScanReason; message: string; boardedAt?: string | undefined };

export interface TicketDto {
  id: string;
  seat: string;
  passengerName: string;
  code: string;
  status: 'ISSUED' | 'BOARDED' | 'VOID';
  token: string;
}

export class TicketService {
  constructor(
    private readonly db: Db,
    private readonly key: Buffer,
  ) {}

  private dto(t: {
    id: string;
    tenantId: string;
    seatLabel: string;
    passengerName: string;
    code: string;
    status: 'ISSUED' | 'BOARDED' | 'VOID';
  }): TicketDto {
    return {
      id: t.id,
      seat: t.seatLabel,
      passengerName: t.passengerName,
      code: formatTicketCode(t.code),
      status: t.status,
      token: ticketToken(this.key, t.tenantId, t.id),
    };
  }

  /**
   * Tickets of a confirmed booking. Issues any that are missing first (idempotent), so a booking
   * confirmed before tickets existed, or a rare insert race, heals itself on first view.
   */
  async listForBooking(s: TenantScope, bookingId: string): Promise<TicketDto[]> {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const b = await tx.booking.findFirst({ where: { id: bookingId, tenantId: s.tenantId } });
      if (!b) throw AppError.notFound();
      if (b.status !== 'CONFIRMED') return [];
      await issueTicketsInTx(tx, s.tenantId, bookingId);
      const rows = await tx.ticket.findMany({
        where: { tenantId: s.tenantId, bookingId },
        orderBy: { seatLabel: 'asc' },
      });
      return rows.map((t) => this.dto(t));
    });
  }

  /** Everything a PDF needs, read in one transaction. */
  async documentData(s: TenantScope, bookingId: string) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const b = await tx.booking.findFirst({
        where: { id: bookingId, tenantId: s.tenantId },
        include: {
          tenant: { select: { name: true, timezone: true } },
          trip: {
            select: {
              departureAt: true,
              arrivalAt: true,
              route: {
                select: {
                  name: true,
                  origin: { select: { name: true, city: true } },
                  destination: { select: { name: true, city: true } },
                },
              },
            },
          },
          passengers: { where: { releasedAt: null }, orderBy: { seatLabel: 'asc' } },
          payments: { where: { status: 'PAID' }, orderBy: { paidAt: 'desc' }, take: 1 },
        },
      });
      if (!b) throw AppError.notFound();
      if (b.status !== 'CONFIRMED')
        throw AppError.conflict('Tickets are only available for confirmed bookings');
      await issueTicketsInTx(tx, s.tenantId, bookingId);
      const tickets = await tx.ticket.findMany({
        where: { tenantId: s.tenantId, bookingId },
        orderBy: { seatLabel: 'asc' },
      });
      return {
        company: b.tenant.name,
        timezone: b.tenant.timezone,
        reference: b.reference,
        contactName: b.contactName,
        contactPhone: b.contactPhone,
        route: b.trip.route.name,
        origin: b.trip.route.origin,
        destination: b.trip.route.destination,
        departureAt: b.trip.departureAt,
        arrivalAt: b.trip.arrivalAt,
        currency: b.currency,
        totalMinor: b.totalMinor,
        passengers: b.passengers.map((p) => ({
          seat: p.seatLabel,
          name: p.fullName,
          fareMinor: p.fareMinor,
        })),
        payment: b.payments[0]
          ? {
              id: b.payments[0].id,
              paidAt: b.payments[0].paidAt,
              amountMinor: b.payments[0].amountMinor,
            }
          : null,
        tickets: tickets.map((t) => this.dto(t)),
      };
    });
  }

  // ---- Boarding ------------------------------------------------------------------------------

  /**
   * Validates a scanned QR token (or a typed code) and marks the ticket boarded. The signature is
   * checked before anything is read. Every outcome, accepted or refused, is written to the audit
   * log; a ticket can be boarded exactly once even if two scanners read it at the same moment.
   */
  async scan(
    s: TenantScope,
    input: { token?: string | undefined; code?: string | undefined; tripId?: string | undefined },
    requestId?: string,
  ): Promise<ScanResult> {
    const refuse = async (
      reason: ScanReason,
      extra: { boardedAt?: Date | undefined; ticketId?: string } = {},
    ) => {
      await withDb(this.db, ctxOf(s), (tx) =>
        writeAudit(tx, {
          action: 'ticket.scan_rejected',
          outcome: 'FAILURE',
          tenantId: s.tenantId,
          actorUserId: s.userId,
          targetType: 'ticket',
          ...(extra.ticketId ? { targetId: extra.ticketId } : {}),
          requestId,
          summary: { reason },
        }),
      );
      return {
        ok: false as const,
        reason,
        message: MESSAGES[reason],
        boardedAt: extra.boardedAt?.toISOString(),
      };
    };

    let where: { id: string } | { code: string };
    if (input.token) {
      const parsed = parseTicketToken(this.key, input.token);
      // A token signed for another company is treated like any unknown ticket.
      if (!parsed || parsed.tenantId !== s.tenantId) return refuse('INVALID_CODE');
      where = { id: parsed.ticketId };
    } else if (input.code) {
      const code = normalizeTicketCode(input.code);
      if (!/^[0-9A-Z]{10}$/.test(code)) return refuse('INVALID_CODE');
      where = { code };
    } else {
      return refuse('INVALID_CODE');
    }

    const outcome = await withDb(this.db, ctxOf(s), async (tx) => {
      const t = await tx.ticket.findFirst({
        where: { tenantId: s.tenantId, ...where },
        include: {
          booking: { select: { status: true } },
          passenger: { select: { releasedAt: true } },
        },
      });
      if (!t) return { reason: 'NOT_FOUND' as const };
      const trip = await tx.trip.findFirst({
        where: { id: t.tripId, tenantId: s.tenantId },
        select: {
          id: true,
          status: true,
          departureAt: true,
          arrivalAt: true,
          route: { select: { name: true } },
        },
      });
      if (!trip) return { reason: 'NOT_FOUND' as const };
      const ticketId = t.id;
      if (t.status === 'VOID' || t.passenger.releasedAt)
        return { reason: 'VOID' as const, ticketId };
      if (t.booking.status !== 'CONFIRMED')
        return { reason: 'BOOKING_NOT_CONFIRMED' as const, ticketId };
      if (['CANCELLED', 'COMPLETED'].includes(trip.status))
        return { reason: 'TRIP_NOT_RUNNING' as const, ticketId };
      if (input.tripId && input.tripId !== trip.id)
        return { reason: 'WRONG_TRIP' as const, ticketId };
      if (t.status === 'BOARDED')
        return {
          reason: 'ALREADY_BOARDED' as const,
          ticketId,
          boardedAt: t.boardedAt ?? undefined,
        };
      const now = Date.now();
      if (now < trip.departureAt.getTime() - BOARDING_OPENS_MIN * 60_000)
        return { reason: 'TOO_EARLY' as const, ticketId };
      if (now > trip.arrivalAt.getTime()) return { reason: 'TRIP_ENDED' as const, ticketId };

      // Compare-and-set: of two simultaneous scans only one changes the row.
      const boardedAt = new Date();
      const res = await tx.ticket.updateMany({
        where: { id: t.id, tenantId: s.tenantId, status: 'ISSUED' },
        data: { status: 'BOARDED', boardedAt, boardedByUserId: s.userId },
      });
      if (res.count !== 1) {
        const again = await tx.ticket.findFirst({
          where: { id: t.id },
          select: { boardedAt: true },
        });
        return {
          reason: 'ALREADY_BOARDED' as const,
          ticketId,
          boardedAt: again?.boardedAt ?? undefined,
        };
      }
      await writeAudit(tx, {
        action: 'ticket.boarded',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'ticket',
        targetId: t.id,
        requestId,
        summary: { seat: t.seatLabel },
      });
      return {
        ok: true as const,
        ticket: {
          id: t.id,
          seat: t.seatLabel,
          passengerName: t.passengerName,
          code: formatTicketCode(t.code),
        },
        trip: { id: trip.id, route: trip.route.name, departureAt: trip.departureAt.toISOString() },
      };
    });

    if (outcome.ok === true) return outcome;
    return refuse(outcome.reason, {
      boardedAt: 'boardedAt' in outcome ? outcome.boardedAt : undefined,
      ...('ticketId' in outcome ? { ticketId: outcome.ticketId } : {}),
    });
  }

  /** Who is on a trip and who has boarded. */
  async manifest(s: TenantScope, tripId: string) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const trip = await tx.trip.findFirst({
        where: { id: tripId, tenantId: s.tenantId },
        select: { id: true, status: true, departureAt: true, route: { select: { name: true } } },
      });
      if (!trip) throw AppError.notFound();
      const rows = await tx.ticket.findMany({
        where: { tenantId: s.tenantId, tripId, status: { in: ['ISSUED', 'BOARDED'] } },
        orderBy: { seatLabel: 'asc' },
      });
      return {
        trip: {
          id: trip.id,
          route: trip.route.name,
          status: trip.status,
          departureAt: trip.departureAt.toISOString(),
        },
        counts: {
          total: rows.length,
          boarded: rows.filter((r) => r.status === 'BOARDED').length,
        },
        passengers: rows.map((r) => ({
          ticketId: r.id,
          seat: r.seatLabel,
          name: r.passengerName,
          code: formatTicketCode(r.code),
          status: r.status,
          boardedAt: r.boardedAt?.toISOString() ?? null,
        })),
      };
    });
  }
}
