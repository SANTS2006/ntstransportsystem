import { withDb, type Db } from '../../platform/db.js';
import type { ClaimedEvent, OutboxHandler } from '../../platform/outbox.js';
import { inboxLink, inboxText } from './inbox-text.js';
import type { Mailer } from './mailer.js';

const money = (minor: number, currency: string) =>
  `${currency} ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const when = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(
    d,
  );

const payloadOf = (e: ClaimedEvent) => (e.payload ?? {}) as Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Turns domain events from the outbox into emails. Handlers are idempotent: every recipient send
 * is recorded in notification_deliveries, so a retried event skips people already notified (and
 * only the ones that failed are retried). A crash between sending and recording can send one
 * duplicate; that was chosen over ever losing a notice.
 */
export class NotificationService {
  constructor(
    private readonly db: Db,
    private readonly mailer: Mailer,
    private readonly appUrl: string,
  ) {}

  handlers(): Record<string, OutboxHandler> {
    return {
      'booking.confirmed': (e) => this.bookingConfirmed(e),
      'booking.cancelled': (e) => this.bookingCancelled(e),
      'trip.delayed': (e) => this.tripDelayed(e),
      'trip.vehicle_replaced': (e) => this.vehicleReplaced(e),
      'payment.refund_required': (e) => this.refundRequired(e),
      'complaint.created': (e) => this.complaintToStaff(e),
      'complaint.passenger_replied': (e) => this.complaintToStaff(e),
      'complaint.replied': (e) => this.complaintToPassenger(e),
      'application.received': (e) => this.applicationToHr(e),
      'application.status_changed': (e) => this.applicationToApplicant(e),
      // Cancelling a trip cancels each booking, and each of those sends its own notice.
      'trip.cancelled': async () => undefined,
    };
  }

  /** Recipients of this event that were already notified (a retry skips them). */
  private async sentKeys(e: ClaimedEvent): Promise<Set<string>> {
    const rows = await withDb(this.db, { tenantId: e.tenantId }, (tx) =>
      tx.notificationDelivery.findMany({
        where: { outboxEventId: e.id },
        select: { recipientKey: true },
      }),
    );
    return new Set(rows.map((r) => r.recipientKey));
  }

  private async deliver(
    e: ClaimedEvent,
    sent: Set<string>,
    recipientKey: string,
    template: Parameters<Mailer['send']>[0]['template'],
    to: string | null,
    data: Record<string, string>,
    userId: string | null = null,
  ): Promise<void> {
    if (sent.has(recipientKey)) return;
    // The in-app copy goes first: it is idempotent, so a retry after a failed send adds nothing.
    await this.inbox(e, recipientKey, template, to, data, userId);
    // Accounts reached only by phone number have no address: the in-app notice is theirs.
    if (to) await this.mailer.send({ to, template, data });
    sent.add(recipientKey);
    await withDb(this.db, { tenantId: e.tenantId }, (tx) =>
      tx.notificationDelivery.createMany({
        data: [{ tenantId: e.tenantId, outboxEventId: e.id, recipientKey, template }],
        skipDuplicates: true,
      }),
    );
  }

  /** Adds the notice to the recipient's in-app inbox when they have an account. */
  private async inbox(
    e: ClaimedEvent,
    recipientKey: string,
    template: Parameters<Mailer['send']>[0]['template'],
    to: string | null,
    data: Record<string, string>,
    userId: string | null,
  ): Promise<void> {
    const text = inboxText(template, data);
    if (!text) return;
    await withDb(this.db, { platform: true }, async (tx) => {
      const user = userId
        ? { id: userId }
        : to
          ? await tx.user.findUnique({
              where: { email: to.toLowerCase() },
              select: { id: true },
            })
          : null;
      if (!user) return;
      await tx.inboxNotification.createMany({
        data: [
          {
            tenantId: e.tenantId,
            userId: user.id,
            outboxEventId: e.id,
            dedupeKey: recipientKey,
            template,
            title: text.title,
            body: text.body,
            link: inboxLink(data.link),
          },
        ],
        skipDuplicates: true,
      });
    });
  }

  /**
   * Booking contact plus the passenger account that made it (never a staff member who booked for
   * them). An account with no email address (signed up by phone number) is reached in the app.
   */
  private async passengerRecipients(
    tenantId: string,
    b: { contactEmail: string | null; createdByUserId: string | null },
  ): Promise<{ key: string; email: string | null; userId: string | null }[]> {
    const out = new Map<string, { key: string; email: string | null; userId: string | null }>();
    if (b.contactEmail) {
      const email = b.contactEmail.toLowerCase();
      out.set(email, { key: email, email, userId: null });
    }
    if (b.createdByUserId) {
      const row = await withDb(this.db, { platform: true }, async (tx) => {
        const staff = await tx.membership.findFirst({
          where: { tenantId, userId: b.createdByUserId as string },
          select: { id: true },
        });
        if (staff) return null;
        return tx.user.findUnique({
          where: { id: b.createdByUserId as string },
          select: { email: true },
        });
      });
      const uid = b.createdByUserId;
      if (row?.email) {
        const email = row.email.toLowerCase();
        out.set(email, { key: email, email, userId: uid });
      } else if (row) {
        out.set(`user:${uid}`, { key: `user:${uid}`, email: null, userId: uid });
      }
    }
    return [...out.values()];
  }

  private static readonly bookingInclude = {
    tenant: { select: { timezone: true } },
    trip: {
      select: {
        departureAt: true,
        route: {
          select: {
            name: true,
            origin: { select: { city: true } },
            destination: { select: { city: true } },
          },
        },
      },
    },
    passengers: { orderBy: { seatLabel: 'asc' as const }, select: { seatLabel: true } },
  };

  private async loadBooking(tenantId: string, bookingId: string) {
    return withDb(this.db, { tenantId }, (tx) =>
      tx.booking.findFirst({
        where: { id: bookingId, tenantId },
        include: NotificationService.bookingInclude,
      }),
    );
  }

  private tripData(b: NonNullable<Awaited<ReturnType<NotificationService['loadBooking']>>>) {
    return {
      reference: b.reference,
      route: `${b.trip.route.origin.city} to ${b.trip.route.destination.city}`,
      departure: when(b.trip.departureAt, b.tenant.timezone),
      seats: b.passengers.map((p) => p.seatLabel).join(', '),
      link: `${this.appUrl.replace(/\/$/, '')}/app/bookings/${b.id}`,
    };
  }

  // ---- Handlers ------------------------------------------------------------------------------

  private async bookingConfirmed(e: ClaimedEvent) {
    const b = await this.loadBooking(e.tenantId, str(payloadOf(e).bookingId));
    if (!b) return;
    const sent = await this.sentKeys(e);
    const data = this.tripData(b);
    for (const r of await this.passengerRecipients(e.tenantId, b)) {
      await this.deliver(e, sent, `${b.id}:${r.key}`, 'booking-confirmed', r.email, data, r.userId);
    }
  }

  private async bookingCancelled(e: ClaimedEvent) {
    const p = payloadOf(e);
    const b = await this.loadBooking(e.tenantId, str(p.bookingId));
    if (!b) return;
    const sent = await this.sentKeys(e);
    const data = {
      ...this.tripData(b),
      reason: str(p.reason),
      refund: p.refundRequired === true ? 'yes' : 'no',
    };
    for (const r of await this.passengerRecipients(e.tenantId, b)) {
      await this.deliver(e, sent, `${b.id}:${r.key}`, 'booking-cancelled', r.email, data, r.userId);
    }
  }

  private async confirmedOnTrip(tenantId: string, tripId: string) {
    return withDb(this.db, { tenantId }, (tx) =>
      tx.booking.findMany({
        where: { tenantId, tripId, status: 'CONFIRMED' },
        include: NotificationService.bookingInclude,
        take: 500,
      }),
    );
  }

  private async tripDelayed(e: ClaimedEvent) {
    const p = payloadOf(e);
    const tripId = str(p.tripId);
    const minutes = num(p.delayMinutes);
    const current = await withDb(this.db, { tenantId: e.tenantId }, (tx) =>
      tx.trip.findFirst({
        where: { id: tripId, tenantId: e.tenantId },
        select: { delayMinutes: true, status: true },
      }),
    );
    // A newer delay has replaced this one (it has its own event), or the trip is no longer running.
    if (
      !current ||
      current.delayMinutes !== minutes ||
      ['CANCELLED', 'COMPLETED'].includes(current.status)
    )
      return;
    const sent = await this.sentKeys(e);
    for (const b of await this.confirmedOnTrip(e.tenantId, tripId)) {
      const data = { ...this.tripData(b), delayMinutes: String(minutes) };
      for (const r of await this.passengerRecipients(e.tenantId, b)) {
        await this.deliver(e, sent, `${b.id}:${r.key}`, 'trip-delayed', r.email, data, r.userId);
      }
    }
  }

  private async vehicleReplaced(e: ClaimedEvent) {
    const p = payloadOf(e);
    const vehicle = str(p.to);
    const sent = await this.sentKeys(e);
    for (const b of await this.confirmedOnTrip(e.tenantId, str(p.tripId))) {
      const data = { ...this.tripData(b), vehicle };
      for (const r of await this.passengerRecipients(e.tenantId, b)) {
        await this.deliver(
          e,
          sent,
          `${b.id}:${r.key}`,
          'trip-vehicle-changed',
          r.email,
          data,
          r.userId,
        );
      }
    }
  }

  private async complaintOf(e: ClaimedEvent) {
    const id = str(payloadOf(e).complaintId);
    return withDb(this.db, { tenantId: e.tenantId }, (tx) =>
      tx.complaint.findFirst({
        where: { id, tenantId: e.tenantId },
        select: {
          id: true,
          userId: true,
          category: true,
          booking: { select: { reference: true } },
        },
      }),
    );
  }

  /** New complaint or a customer follow-up: tell the support staff (the text itself is not emailed). */
  private async complaintToStaff(e: ClaimedEvent) {
    const c = await this.complaintOf(e);
    if (!c) return;
    const staff = await withDb(this.db, { platform: true }, (tx) =>
      tx.membership.findMany({
        where: {
          tenantId: e.tenantId,
          status: 'ACTIVE',
          role: { permissions: { some: { permission: 'support.manage' } } },
        },
        select: { user: { select: { email: true } } },
        take: 20,
      }),
    );
    const data = {
      reference: c.booking.reference,
      category: c.category.toLowerCase().replace('_', ' '),
      link: `${this.appUrl.replace(/\/$/, '')}/c/${e.tenantId}/complaints`,
    };
    const sent = await this.sentKeys(e);
    for (const m of staff) {
      if (!m.user.email) continue;
      await this.deliver(
        e,
        sent,
        `staff:${m.user.email.toLowerCase()}`,
        'complaint-received',
        m.user.email,
        data,
      );
    }
  }

  /** A staff reply: tell the passenger there is something to read. */
  private async complaintToPassenger(e: ClaimedEvent) {
    const c = await this.complaintOf(e);
    if (!c) return;
    const user = await withDb(this.db, { platform: true }, (tx) =>
      tx.user.findUnique({ where: { id: c.userId }, select: { email: true } }),
    );
    if (!user?.email) return;
    const sent = await this.sentKeys(e);
    await this.deliver(e, sent, `user:${c.userId}`, 'complaint-reply', user.email, {
      reference: c.booking.reference,
      link: `${this.appUrl.replace(/\/$/, '')}/app/complaints/${c.id}`,
    });
  }

  private async applicationOf(e: ClaimedEvent) {
    const id = str(payloadOf(e).applicationId);
    return withDb(this.db, { tenantId: e.tenantId }, (tx) =>
      tx.jobApplication.findFirst({
        where: { id, tenantId: e.tenantId },
        select: {
          id: true,
          userId: true,
          status: true,
          job: { select: { title: true } },
          tenant: { select: { name: true } },
        },
      }),
    );
  }

  /** A new application: tell HR (people with recruitment.manage). No applicant details in the mail. */
  private async applicationToHr(e: ClaimedEvent) {
    const a = await this.applicationOf(e);
    if (!a) return;
    const hr = await withDb(this.db, { platform: true }, (tx) =>
      tx.membership.findMany({
        where: {
          tenantId: e.tenantId,
          status: 'ACTIVE',
          role: { permissions: { some: { permission: 'recruitment.manage' } } },
        },
        select: { user: { select: { email: true } } },
        take: 20,
      }),
    );
    const data = {
      job: a.job.title,
      link: `${this.appUrl.replace(/\/$/, '')}/c/${e.tenantId}/recruitment`,
    };
    const sent = await this.sentKeys(e);
    for (const m of hr) {
      if (!m.user.email) continue;
      await this.deliver(
        e,
        sent,
        `hr:${m.user.email.toLowerCase()}`,
        'application-received',
        m.user.email,
        data,
      );
    }
  }

  /** The applicant hears about a status change (never HR's private notes). */
  private async applicationToApplicant(e: ClaimedEvent) {
    const a = await this.applicationOf(e);
    if (!a) return;
    const status = str(payloadOf(e).status);
    const user = await withDb(this.db, { platform: true }, (tx) =>
      tx.user.findUnique({ where: { id: a.userId }, select: { email: true } }),
    );
    if (!user?.email) return;
    const sent = await this.sentKeys(e);
    await this.deliver(e, sent, `user:${a.userId}:${status}`, 'application-update', user.email, {
      job: a.job.title,
      company: a.tenant.name,
      status,
      link: `${this.appUrl.replace(/\/$/, '')}/app/applications`,
    });
  }

  /** Tells the people who can act on it (roles with payment.manage) that a refund is owed. */
  private async refundRequired(e: ClaimedEvent) {
    const p = payloadOf(e);
    const b = await this.loadBooking(e.tenantId, str(p.bookingId));
    const staff = await withDb(this.db, { platform: true }, (tx) =>
      tx.membership.findMany({
        where: {
          tenantId: e.tenantId,
          status: 'ACTIVE',
          role: { permissions: { some: { permission: 'payment.manage' } } },
        },
        select: { user: { select: { email: true } } },
        take: 20,
      }),
    );
    const data = {
      reference: b?.reference ?? 'unknown',
      amount: money(num(p.amountMinor), str(p.currency) || 'SLE'),
      link: `${this.appUrl.replace(/\/$/, '')}/c/${e.tenantId}/bookings`,
    };
    const sent = await this.sentKeys(e);
    for (const m of staff) {
      if (!m.user.email) continue;
      await this.deliver(
        e,
        sent,
        `staff:${m.user.email.toLowerCase()}`,
        'refund-required',
        m.user.email,
        data,
      );
    }
  }
}
