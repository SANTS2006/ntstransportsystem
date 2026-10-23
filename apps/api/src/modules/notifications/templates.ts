import type { MailMessage, MailTemplate } from './mailer.js';

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/** Only absolute http(s) links are allowed in mail; anything else (javascript:, data:) is refused. */
export function safeLink(raw: string | undefined): string {
  if (!raw) throw new Error('Missing link');
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsafe link scheme');
  return url.toString();
}

const layout = (heading: string, bodyHtml: string) => `<!doctype html>
<html lang="en"><body style="margin:0;background:#f8fafc;font-family:Poppins,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td><h1 style="font-size:20px;margin:0 0 16px;color:#0f766e">${escapeHtml(heading)}</h1>${bodyHtml}
<p style="font-size:12px;color:#64748b;margin:24px 0 0">If you did not expect this email you can safely ignore it.</p></td></tr>
</table></td></tr></table></body></html>`;

const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#0f766e;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">${escapeHtml(label)}</a></p>` +
  `<p style="font-size:12px;color:#64748b;word-break:break-all">Or paste this link into your browser:<br>${escapeHtml(href)}</p>`;

interface TripData {
  reference: string;
  route: string;
  departure: string;
  seats: string;
}
const trip = (d: Record<string, string>): TripData => ({
  reference: d.reference ?? '',
  route: d.route ?? '',
  departure: d.departure ?? '',
  seats: d.seats ?? '',
});
const tripBlock = (t: TripData) =>
  `<p style="margin:12px 0;line-height:1.6">Booking: <strong>${escapeHtml(t.reference)}</strong><br>Trip: ${escapeHtml(t.route)}<br>Departs: ${escapeHtml(t.departure)}${t.seats ? `<br>Seats: ${escapeHtml(t.seats)}` : ''}</p>`;
const tripText = (t: TripData) =>
  `Booking: ${t.reference}\nTrip: ${t.route}\nDeparts: ${t.departure}${t.seats ? `\nSeats: ${t.seats}` : ''}`;

/**
 * Subjects are deliberately generic: no names, company names, or tokens, because subjects show in
 * lock-screen previews and notification lists.
 */
export function renderMail(msg: Pick<MailMessage, 'template' | 'data'>): RenderedMail {
  const t: MailTemplate = msg.template;
  switch (t) {
    case 'verify-email': {
      const link = safeLink(msg.data.link);
      return {
        subject: 'Confirm your email address',
        html: layout(
          'Confirm your email',
          `<p>Thanks for signing up. Confirm your address to finish creating your account. This link expires in 24 hours.</p>${button(link, 'Confirm email')}`,
        ),
        text: `Confirm your email address (link expires in 24 hours):\n${link}\n`,
      };
    }
    case 'password-reset': {
      const link = safeLink(msg.data.link);
      return {
        subject: 'Reset your password',
        html: layout(
          'Reset your password',
          `<p>We received a request to reset your password. This link expires in 30 minutes and can be used once.</p>${button(link, 'Choose a new password')}`,
        ),
        text: `Reset your password (link expires in 30 minutes, single use):\n${link}\n`,
      };
    }
    case 'password-changed':
      return {
        subject: 'Your password was changed',
        html: layout(
          'Password changed',
          '<p>The password on your account was just changed. If this was not you, reset your password immediately and contact support.</p>',
        ),
        text: 'The password on your account was just changed. If this was not you, reset your password immediately and contact support.\n',
      };
    case 'tenant-invitation': {
      const link = safeLink(msg.data.link);
      const company = msg.data.company ?? 'a company';
      return {
        subject: 'You have been invited to join a company',
        html: layout(
          'You have been invited',
          `<p>You have been invited to join <strong>${escapeHtml(company)}</strong>. Sign in with this email address to accept. The invitation expires in 7 days.</p>${button(link, 'Accept invitation')}`,
        ),
        text: `You have been invited to join ${company}. Sign in with this email address to accept (expires in 7 days):\n${link}\n`,
      };
    }
    case 'booking-confirmed': {
      const link = safeLink(msg.data.link);
      const d = trip(msg.data);
      return {
        subject: 'Your booking is confirmed',
        html: layout(
          'Booking confirmed',
          `<p>Your payment was received and your seats are confirmed.</p>${tripBlock(d)}<p>Your tickets with QR codes are ready to view or download.</p>${button(link, 'View my tickets')}`,
        ),
        text: `Your payment was received and your seats are confirmed.\n${tripText(d)}\nView your tickets: ${link}\n`,
      };
    }
    case 'booking-cancelled': {
      const link = safeLink(msg.data.link);
      const d = trip(msg.data);
      const why =
        msg.data.reason === 'trip_cancelled'
          ? 'The trip was cancelled by the operator.'
          : 'The booking was cancelled.';
      const refund =
        msg.data.refund === 'yes'
          ? 'You paid for this booking. The company will arrange your refund; contact them with your booking reference if you do not hear back.'
          : 'No payment was taken for this booking.';
      return {
        subject: 'Your booking was cancelled',
        html: layout(
          'Booking cancelled',
          `<p>${escapeHtml(why)}</p>${tripBlock(d)}<p>${escapeHtml(refund)}</p>${button(link, 'View my bookings')}`,
        ),
        text: `${why}\n${tripText(d)}\n${refund}\nMy bookings: ${link}\n`,
      };
    }
    case 'trip-delayed': {
      const link = safeLink(msg.data.link);
      const d = trip(msg.data);
      const mins = escapeHtml(msg.data.delayMinutes ?? '0');
      const line =
        msg.data.delayMinutes === '0'
          ? 'The delay on your trip has been cleared: it will leave at the original time.'
          : `Your trip is delayed by about ${msg.data.delayMinutes ?? '?'} minutes.`;
      return {
        subject: 'Update on your trip',
        html: layout(
          'Trip update',
          `<p>${msg.data.delayMinutes === '0' ? escapeHtml(line) : `Your trip is delayed by about <strong>${mins} minutes</strong>.`}</p>${tripBlock(d)}${button(link, 'View my booking')}`,
        ),
        text: `${line}\n${tripText(d)}\nMy booking: ${link}\n`,
      };
    }
    case 'trip-vehicle-changed': {
      const link = safeLink(msg.data.link);
      const d = trip(msg.data);
      return {
        subject: 'Update on your trip',
        html: layout(
          'Vehicle changed',
          `<p>The vehicle for your trip has been changed. Your seat and tickets are still valid; please check the registration when boarding.</p>${tripBlock(d)}${msg.data.vehicle ? `<p>New vehicle: <strong>${escapeHtml(msg.data.vehicle)}</strong></p>` : ''}${button(link, 'View my booking')}`,
        ),
        text: `The vehicle for your trip has been changed. Your seat and tickets are still valid.\n${tripText(d)}\n${msg.data.vehicle ? `New vehicle: ${msg.data.vehicle}\n` : ''}My booking: ${link}\n`,
      };
    }
    case 'refund-required': {
      const link = safeLink(msg.data.link);
      return {
        subject: 'A payment needs a refund',
        html: layout(
          'Refund needed',
          `<p>A customer paid for booking <strong>${escapeHtml(msg.data.reference ?? '')}</strong> (${escapeHtml(msg.data.amount ?? '')}) but the seats had already been released, so the booking could not be confirmed. Please refund this payment from your Monime dashboard and contact the customer.</p>${button(link, 'Open bookings')}`,
        ),
        text: `A customer paid for booking ${msg.data.reference ?? ''} (${msg.data.amount ?? ''}) but the seats had already been released. Please refund this payment from your Monime dashboard and contact the customer.\n${link}\n`,
      };
    }
    case 'complaint-received': {
      const link = safeLink(msg.data.link);
      return {
        subject: 'A complaint needs attention',
        html: layout(
          'Complaint received',
          `<p>A customer has sent a complaint about booking <strong>${escapeHtml(msg.data.reference ?? '')}</strong>${msg.data.category ? ` (${escapeHtml(msg.data.category)})` : ''}. Please read and reply.</p>${button(link, 'Open complaints')}`,
        ),
        text: `A customer has sent a complaint about booking ${msg.data.reference ?? ''}. Please read and reply.\n${link}\n`,
      };
    }
    case 'complaint-reply': {
      const link = safeLink(msg.data.link);
      return {
        subject: 'You have a reply to your complaint',
        html: layout(
          'New reply',
          `<p>The company has replied to your complaint about booking <strong>${escapeHtml(msg.data.reference ?? '')}</strong>. Sign in to read the reply.</p>${button(link, 'Read the reply')}`,
        ),
        text: `The company has replied to your complaint about booking ${msg.data.reference ?? ''}. Sign in to read the reply:\n${link}\n`,
      };
    }
    case 'application-received': {
      const link = safeLink(msg.data.link);
      return {
        subject: 'A new job application',
        html: layout(
          'New application',
          `<p>Someone has applied for <strong>${escapeHtml(msg.data.job ?? 'a job')}</strong>. Review the application and decide the next step.</p>${button(link, 'Open applications')}`,
        ),
        text: `Someone has applied for ${msg.data.job ?? 'a job'}. Review the application:\n${link}\n`,
      };
    }
    case 'application-update': {
      const link = safeLink(msg.data.link);
      const line =
        {
          SHORTLISTED: 'You have been shortlisted.',
          INTERVIEW:
            'You have been invited to an interview. The company will contact you with the details.',
          OFFERED: 'You have been made an offer. The company will contact you.',
          HIRED:
            'Congratulations, you have been hired. The company will be in touch about your start.',
          REJECTED:
            'The company has decided not to continue with your application. Thank you for applying.',
        }[msg.data.status ?? ''] ?? 'There is an update on your application.';
      return {
        subject: 'Update on your application',
        html: layout(
          'Application update',
          `<p>Your application for <strong>${escapeHtml(msg.data.job ?? 'the job')}</strong> at <strong>${escapeHtml(msg.data.company ?? 'the company')}</strong>: ${escapeHtml(line)}</p>${button(link, 'View my applications')}`,
        ),
        text: `Your application for ${msg.data.job ?? 'the job'} at ${msg.data.company ?? 'the company'}: ${line}\nMy applications: ${link}\n`,
      };
    }
    default: {
      const never: never = t;
      throw new Error(`Unknown mail template: ${String(never)}`);
    }
  }
}
