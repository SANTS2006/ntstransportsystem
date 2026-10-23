import { withDb, type Db } from '../../platform/db.js';
import { mapDbErrors } from '../../platform/db-errors.js';
import { AppError } from '../../platform/errors.js';
import { enqueueOutbox } from '../../platform/outbox.js';
import { writeAudit } from '../audit/audit.js';
import type { Page } from '../catalog/catalog.service.js';
import type { TenantScope } from '../tenants/tenant.guards.js';

export const COMPLAINT_CATEGORIES = [
  'DELAY',
  'VEHICLE',
  'STAFF_CONDUCT',
  'REFUND',
  'SAFETY',
  'OTHER',
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];
export type ComplaintStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'CLOSED';

/** Stops one account flooding a company with open complaints. */
/** Shown as the message when a passenger sends a voice message instead of typing. */
export const VOICE_ONLY_TEXT = 'Voice message (listen to the attached recording)';

export const MAX_OPEN_COMPLAINTS_PER_PASSENGER = 5;

const ctxOf = (s: TenantScope) => ({ tenantId: s.tenantId, userId: s.userId });

const messageDto = (m: { id: string; authorKind: string; body: string; createdAt: Date }) => ({
  id: m.id,
  from: m.authorKind === 'STAFF' ? ('COMPANY' as const) : ('YOU' as const),
  body: m.body,
  at: m.createdAt.toISOString(),
});

/**
 * Complaints about bookings and the conversation with the company's support staff. Passenger
 * reads span companies, so (like bookings) they run in platform scope with fixed filters to the
 * caller's own rows; every write happens under the owning company's row-level security.
 */
export class ComplaintService {
  constructor(private readonly db: Db) {}

  // ---- Passenger side ------------------------------------------------------------------------

  async create(
    userId: string,
    input: {
      bookingId: string;
      category: ComplaintCategory;
      subject: string;
      body?: string | undefined;
      voice?: boolean | undefined;
    },
    requestId?: string,
  ) {
    const booking = await withDb(this.db, { platform: true }, (tx) =>
      tx.booking.findFirst({
        where: { id: input.bookingId, createdByUserId: userId },
        select: { id: true, tenantId: true, status: true },
      }),
    );
    if (!booking) throw AppError.notFound(); // someone else's booking looks like a missing one
    if (booking.status === 'PENDING_PAYMENT' || booking.status === 'EXPIRED') {
      throw AppError.conflict('You can only report a problem on a booking that was paid for');
    }
    const open = await withDb(this.db, { platform: true }, (tx) =>
      tx.complaint.count({ where: { userId, status: { in: ['OPEN', 'IN_REVIEW'] } } }),
    );
    if (open >= MAX_OPEN_COMPLAINTS_PER_PASSENGER) {
      throw AppError.conflict(
        'You have several open complaints already. Please wait for a reply before sending more.',
      );
    }
    return withDb(this.db, { tenantId: booking.tenantId, userId }, async (tx) => {
      const c = await tx.complaint.create({
        data: {
          tenantId: booking.tenantId,
          bookingId: booking.id,
          userId,
          category: input.category,
          subject: input.subject,
        },
      });
      await tx.complaintMessage.createMany({
        data: [
          {
            tenantId: booking.tenantId,
            complaintId: c.id,
            authorId: userId,
            authorKind: 'PASSENGER',
            // A voice-only complaint says so; the recording follows as an attachment.
            body: input.body ?? VOICE_ONLY_TEXT,
          },
        ],
      });
      await enqueueOutbox(tx, {
        tenantId: booking.tenantId,
        type: 'complaint.created',
        payload: { complaintId: c.id },
        dedupeKey: `complaint.created:${c.id}`,
      });
      await writeAudit(tx, {
        action: 'complaint.created',
        outcome: 'SUCCESS',
        tenantId: booking.tenantId,
        actorUserId: userId,
        targetType: 'complaint',
        targetId: c.id,
        requestId,
        summary: { category: input.category },
      });
      return { id: c.id };
    });
  }

  private static readonly passengerInclude = {
    tenant: { select: { name: true } },
    booking: { select: { reference: true } },
  } as const;

  async listOwn(userId: string) {
    const rows = await withDb(this.db, { platform: true }, (tx) =>
      tx.complaint.findMany({
        where: { userId },
        include: ComplaintService.passengerInclude,
        orderBy: { updatedAt: 'desc' },
        take: 50,
      }),
    );
    return rows.map((c) => ({
      id: c.id,
      company: c.tenant.name,
      bookingReference: c.booking.reference,
      category: c.category,
      subject: c.subject,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }));
  }

  async getOwn(userId: string, id: string) {
    const c = await withDb(this.db, { platform: true }, (tx) =>
      tx.complaint.findFirst({
        where: { id, userId },
        include: {
          ...ComplaintService.passengerInclude,
          messages: { orderBy: { createdAt: 'asc' }, take: 200 },
        },
      }),
    );
    if (!c) throw AppError.notFound();
    return {
      id: c.id,
      company: c.tenant.name,
      bookingReference: c.booking.reference,
      category: c.category,
      subject: c.subject,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      messages: c.messages.map(messageDto),
    };
  }

  async addPassengerMessage(userId: string, id: string, body: string, requestId?: string) {
    const c = await withDb(this.db, { platform: true }, (tx) =>
      tx.complaint.findFirst({
        where: { id, userId },
        select: { id: true, tenantId: true, status: true },
      }),
    );
    if (!c) throw AppError.notFound();
    if (c.status === 'CLOSED')
      throw AppError.conflict('This complaint is closed. Please open a new one.');
    await withDb(this.db, { tenantId: c.tenantId, userId }, async (tx) => {
      const m = await tx.complaintMessage.create({
        data: {
          tenantId: c.tenantId,
          complaintId: c.id,
          authorId: userId,
          authorKind: 'PASSENGER',
          body,
        },
      });
      // A reply on a resolved complaint reopens it.
      await tx.complaint.updateMany({
        where: { id: c.id, tenantId: c.tenantId, status: 'RESOLVED' },
        data: { status: 'OPEN', resolvedAt: null },
      });
      await tx.complaint.updateMany({
        where: { id: c.id, tenantId: c.tenantId },
        data: { updatedAt: new Date() },
      });
      await enqueueOutbox(tx, {
        tenantId: c.tenantId,
        type: 'complaint.passenger_replied',
        payload: { complaintId: c.id },
        dedupeKey: `complaint.passenger_replied:${m.id}`,
      });
      await writeAudit(tx, {
        action: 'complaint.passenger_replied',
        outcome: 'SUCCESS',
        tenantId: c.tenantId,
        actorUserId: userId,
        targetType: 'complaint',
        targetId: c.id,
        requestId,
      });
    });
  }

  /** One rating per paid booking, and only once the trip has actually been completed. */
  async rate(
    userId: string,
    bookingId: string,
    input: { rating: number; comment?: string | undefined },
    requestId?: string,
  ) {
    const booking = await withDb(this.db, { platform: true }, (tx) =>
      tx.booking.findFirst({
        where: { id: bookingId, createdByUserId: userId },
        select: {
          id: true,
          tenantId: true,
          tripId: true,
          status: true,
          trip: { select: { status: true } },
        },
      }),
    );
    if (!booking) throw AppError.notFound();
    if (booking.status !== 'CONFIRMED' || booking.trip.status !== 'COMPLETED') {
      throw AppError.conflict('You can rate a trip after it has been completed');
    }
    return mapDbErrors(
      () =>
        withDb(this.db, { tenantId: booking.tenantId, userId }, async (tx) => {
          await tx.tripRating.createMany({
            data: [
              {
                tenantId: booking.tenantId,
                bookingId: booking.id,
                tripId: booking.tripId,
                userId,
                rating: input.rating,
                comment: input.comment ?? null,
              },
            ],
          });
          await writeAudit(tx, {
            action: 'trip.rated',
            outcome: 'SUCCESS',
            tenantId: booking.tenantId,
            actorUserId: userId,
            targetType: 'booking',
            targetId: booking.id,
            requestId,
            summary: { rating: input.rating },
          });
        }),
      { unique: 'You have already rated this trip', check: 'The rating must be between 1 and 5' },
    );
  }

  async ratingFor(userId: string, bookingId: string) {
    const r = await withDb(this.db, { platform: true }, (tx) =>
      tx.tripRating.findFirst({
        where: { bookingId, userId },
        select: { rating: true, comment: true },
      }),
    );
    return r ?? null;
  }

  // ---- Company side --------------------------------------------------------------------------

  async list(s: TenantScope, page: Page, status?: ComplaintStatus) {
    const rows = await withDb(this.db, ctxOf(s), (tx) =>
      tx.complaint.findMany({
        where: { tenantId: s.tenantId, ...(status ? { status } : {}) },
        include: { booking: { select: { reference: true, contactName: true } } },
        orderBy: [{ updatedAt: 'desc' }],
        take: page.limit,
        skip: page.offset,
      }),
    );
    return rows.map((c) => ({
      id: c.id,
      bookingReference: c.booking.reference,
      customer: c.booking.contactName,
      category: c.category,
      subject: c.subject,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }));
  }

  async get(s: TenantScope, id: string) {
    const c = await withDb(this.db, ctxOf(s), (tx) =>
      tx.complaint.findFirst({
        where: { id, tenantId: s.tenantId },
        include: {
          booking: { select: { reference: true, contactName: true, contactPhone: true } },
          messages: { orderBy: { createdAt: 'asc' }, take: 200 },
        },
      }),
    );
    if (!c) throw AppError.notFound();
    return {
      id: c.id,
      bookingId: c.bookingId,
      bookingReference: c.booking.reference,
      customer: c.booking.contactName,
      customerPhone: c.booking.contactPhone,
      category: c.category,
      subject: c.subject,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      messages: c.messages.map((m) => ({
        id: m.id,
        from: m.authorKind === 'STAFF' ? ('STAFF' as const) : ('CUSTOMER' as const),
        body: m.body,
        at: m.createdAt.toISOString(),
      })),
    };
  }

  /** A staff reply. The customer is emailed (without the text) that there is an answer to read. */
  async reply(s: TenantScope, id: string, body: string, requestId?: string) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const c = await tx.complaint.findFirst({ where: { id, tenantId: s.tenantId } });
      if (!c) throw AppError.notFound();
      if (c.status === 'CLOSED') throw AppError.conflict('This complaint is closed');
      const m = await tx.complaintMessage.create({
        data: {
          tenantId: s.tenantId,
          complaintId: id,
          authorId: s.userId,
          authorKind: 'STAFF',
          body,
        },
      });
      await tx.complaint.updateMany({
        where: { id, tenantId: s.tenantId, status: 'OPEN' },
        data: { status: 'IN_REVIEW' },
      });
      await tx.complaint.updateMany({
        where: { id, tenantId: s.tenantId },
        data: { updatedAt: new Date() },
      });
      await enqueueOutbox(tx, {
        tenantId: s.tenantId,
        type: 'complaint.replied',
        payload: { complaintId: id },
        dedupeKey: `complaint.replied:${m.id}`,
      });
      await writeAudit(tx, {
        action: 'complaint.replied',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'complaint',
        targetId: id,
        requestId,
      });
    });
  }

  async setStatus(s: TenantScope, id: string, status: ComplaintStatus, requestId?: string) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const c = await tx.complaint.findFirst({ where: { id, tenantId: s.tenantId } });
      if (!c) throw AppError.notFound();
      if (c.status === 'CLOSED') throw AppError.conflict('A closed complaint cannot be changed');
      if (c.status === status) return;
      const terminal = status === 'RESOLVED' || status === 'CLOSED';
      await tx.complaint.update({
        where: { id },
        data: { status, resolvedAt: terminal ? (c.resolvedAt ?? new Date()) : null },
      });
      await writeAudit(tx, {
        action: 'complaint.status_changed',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'complaint',
        targetId: id,
        requestId,
        summary: { from: c.status, to: status },
      });
    });
  }

  /** Average and distribution of ratings, per route. */
  async ratingsSummary(s: TenantScope) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const rows = await tx.tripRating.findMany({
        where: { tenantId: s.tenantId },
        select: { rating: true, tripId: true },
        take: 5000,
      });
      const trips = await tx.trip.findMany({
        where: { tenantId: s.tenantId, id: { in: [...new Set(rows.map((r) => r.tripId))] } },
        select: { id: true, route: { select: { name: true } } },
      });
      const routeOf = new Map(trips.map((t) => [t.id, t.route.name]));
      const byRoute = new Map<string, { count: number; sum: number }>();
      for (const r of rows) {
        const name = routeOf.get(r.tripId) ?? 'Unknown';
        const cur = byRoute.get(name) ?? { count: 0, sum: 0 };
        cur.count++;
        cur.sum += r.rating;
        byRoute.set(name, cur);
      }
      const distribution = [1, 2, 3, 4, 5].map((n) => ({
        rating: n,
        count: rows.filter((r) => r.rating === n).length,
      }));
      return {
        total: rows.length,
        average: rows.length
          ? Math.round((rows.reduce((a, r) => a + r.rating, 0) / rows.length) * 100) / 100
          : null,
        distribution,
        routes: [...byRoute.entries()]
          .map(([route, v]) => ({
            route,
            count: v.count,
            average: Math.round((v.sum / v.count) * 100) / 100,
          }))
          .sort((a, b) => b.count - a.count),
      };
    });
  }
}
