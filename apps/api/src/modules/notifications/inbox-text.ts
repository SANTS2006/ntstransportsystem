import type { MailTemplate } from './mailer.js';

export interface InboxText {
  title: string;
  body: string;
}

const clamp = (v: string, max: number) => (v.length > max ? `${v.slice(0, max - 3)}...` : v);
const join = (...parts: (string | undefined)[]) => parts.filter((p) => p).join(' - ');

/**
 * What a notification says inside the app. The inbox is behind sign-in so it may name the trip,
 * unlike e-mail subjects. Account e-mails (verification, password reset, invitations) never
 * appear here. Returns null for templates that have no in-app form.
 */
export function inboxText(template: MailTemplate, d: Record<string, string>): InboxText | null {
  const trip = join(d.route, d.departure);
  const make = (title: string, body: string): InboxText => ({
    title: clamp(title, 120),
    body: clamp(body, 500),
  });
  switch (template) {
    case 'booking-confirmed':
      return make(
        'Booking confirmed',
        join(trip, d.seats ? `Seats ${d.seats}` : undefined, d.reference),
      );
    case 'booking-cancelled':
      return make('Booking cancelled', join(trip, d.reference));
    case 'trip-delayed':
      return make(
        'Trip update',
        join(
          trip,
          d.delayMinutes && d.delayMinutes !== '0'
            ? `Delayed about ${d.delayMinutes} min`
            : undefined,
        ),
      );
    case 'trip-vehicle-changed':
      return make('Vehicle changed', join(trip, d.vehicle ? `Now ${d.vehicle}` : undefined));
    case 'refund-required':
      return make('A payment needs a refund', join(d.reference, d.amount));
    case 'complaint-received':
      return make('Complaint needs attention', join(d.reference, d.category));
    case 'complaint-reply':
      return make('Reply to your complaint', d.reference ?? '');
    case 'application-received':
      return make('New job application', d.job ?? '');
    case 'application-update':
      return make('Update on your application', join(d.job, d.status));
    default:
      return null;
  }
}

/** The part of a mail link that is inside the app: a path, never another site. */
export function inboxLink(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return /^\/[A-Za-z0-9]/.test(u.pathname) ? `${u.pathname}${u.search}` : null;
  } catch {
    return null;
  }
}
