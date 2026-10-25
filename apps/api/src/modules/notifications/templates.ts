import type { MailBrand, MailMessage, MailTemplate } from './mailer.js';

/** The look of e-mail that comes from the system itself (platform staff, platform sign-in). */
export const SYSTEM_BRAND_COLORS = { primary: '#0075df', accent: '#fc8b01' } as const;
export const systemBrand = (siteUrl: string): MailBrand => ({
  name: 'NTS Transport',
  logoUrl: `${siteUrl.replace(/\/$/, '')}/nts-wordmark.png`,
  ...SYSTEM_BRAND_COLORS,
  siteUrl,
});

const HEX = /^#[0-9a-fA-F]{6}$/;
const colour = (v: string, fallback: string) => (HEX.test(v) ? v : fallback);

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

const layoutFor = (brand: MailBrand, heading: string, bodyHtml: string) => {
  const primary = colour(brand.primary, SYSTEM_BRAND_COLORS.primary);
  const accent = colour(brand.accent, SYSTEM_BRAND_COLORS.accent);
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.name)}" style="max-height:48px;max-width:180px;display:block;margin:0 0 6px">`
    : '';
  return `<!doctype html>
<html lang="en"><body style="margin:0;background:#f1f5f9;font-family:Poppins,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="height:6px;background:${primary};background-image:linear-gradient(90deg,${primary},${accent});font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:24px 32px 8px">${logo}<div style="font-size:15px;font-weight:700;color:${primary}">${escapeHtml(brand.name)}</div></td></tr>
<tr><td style="padding:8px 32px 32px"><h1 style="font-size:22px;margin:8px 0 16px;color:${primary}">${escapeHtml(heading)}</h1>${bodyHtml}
<p style="font-size:12px;color:#64748b;margin:28px 0 0">If you did not expect this email you can safely ignore it.</p></td></tr>
<tr><td style="background:#f8fafc;padding:16px 32px;font-size:12px;color:#64748b">Sent by <strong style="color:#334155">${escapeHtml(brand.name)}</strong> · <a href="${escapeHtml(brand.siteUrl)}" style="color:${primary}">${escapeHtml(brand.siteUrl.replace(/^https?:\/\//, ''))}</a></td></tr>
</table></td></tr></table></body></html>`;
};

const buttonFor = (brand: MailBrand, href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:${colour(brand.primary, SYSTEM_BRAND_COLORS.primary)};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;display:inline-block;font-weight:600">${escapeHtml(label)}</a></p>` +
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
export function renderMail(
  msg: Pick<MailMessage, 'template' | 'data'> & { brand?: MailBrand | undefined },
): RenderedMail {
  const brand = msg.brand ?? systemBrand('https://app.invalid');
  const out = renderBody(msg, brand);
  return {
    ...out,
    subject: out.subject.replace(/NTS Transport/g, brand.name),
    text: `${out.text.replace(/\s+$/, '')}\n\n— ${brand.name}\n${brand.siteUrl}\n`,
  };
}

function renderBody(msg: Pick<MailMessage, 'template' | 'data'>, brand: MailBrand): RenderedMail {
  const layout = (heading: string, bodyHtml: string) => layoutFor(brand, heading, bodyHtml);
  const button = (href: string, label: string) => buttonFor(brand, href, label);
  const t: MailTemplate = msg.template;
  switch (t) {
    case 'verify-email': {
      const link = safeLink(msg.data.link);
      const code = typeof msg.data.code === 'string' ? msg.data.code : '';
      if (/^[A-Z0-9]{6}$/.test(code)) {
        return {
          subject: `Your ${brand.name} confirmation code`,
          html: layout(
            'Confirm your email',
            `<p>Thanks for signing up. Enter this code on the verification page to finish creating your account. It expires in 10 minutes.</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;color:${colour(brand.primary, SYSTEM_BRAND_COLORS.primary)};background:#f1f5f9;border-radius:12px;padding:14px 18px;display:inline-block">${code}</p><p>Or <a href="${link}">confirm with this link</a> (valid for 24 hours).</p>`,
          ),
          text: `Your confirmation code is ${code}. It expires in 10 minutes. Never share it.\nOr use this link (24 hours): ${link}\n`,
        };
      }
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
    case 'company-admin-created': {
      const link = safeLink(msg.data.link);
      const company = msg.data.company ?? 'your company';
      const name = msg.data.name ?? '';
      const email = msg.data.email ?? '';
      const password = msg.data.password ?? '';
      const details = password
        ? `<p>Sign in with:</p><p>Email: <strong>${escapeHtml(email)}</strong><br>Temporary password: <strong>${escapeHtml(password)}</strong></p><p>You will be asked to choose your own password the first time you sign in.</p>`
        : `<p>You already have an NTS account, so sign in with your usual email (<strong>${escapeHtml(email)}</strong>) and password.</p>`;
      return {
        subject: `${company} is ready on NTS Transport`,
        html: layout(
          'Your company is ready',
          `<p>Hello ${escapeHtml(name)}, <strong>${escapeHtml(company)}</strong> has been registered on NTS Transport and you are its administrator.</p>${details}${button(link, 'Open your company sign-in page')}`,
        ),
        text: `${company} has been registered on NTS Transport and you are its administrator.\nSign-in page: ${link}\nEmail: ${email}\n${password ? `Temporary password: ${password}\nYou will be asked to choose your own password at first sign-in.\n` : 'Use your usual password.\n'}`,
      };
    }
    case 'staff-added': {
      const link = safeLink(msg.data.link);
      const company = msg.data.company ?? 'your company';
      const row = (k: string, v: string | undefined) =>
        v
          ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${escapeHtml(k)}</td><td style="padding:4px 0"><strong>${escapeHtml(v)}</strong></td></tr>`
          : '';
      const password = msg.data.password ?? '';
      const details = `<table role="presentation" style="font-size:14px;margin:12px 0">${row('Name', msg.data.name)}${row('Staff number', msg.data.employeeNumber)}${row('Job', msg.data.job)}${row('Phone', msg.data.phone)}${row('Sign in with', msg.data.email)}${row('Temporary password', password)}</table>`;
      return {
        subject: `You have been added to the ${company} team`,
        html: layout(
          'Welcome to the team',
          `<p>Hello ${escapeHtml(msg.data.name ?? '')}, you have been added to the <strong>${escapeHtml(company)}</strong> team.</p>${details}${
            password
              ? '<p>Sign in with the temporary password above. You will be asked to choose your own password straight away.</p>'
              : '<p>You already have an account with this email: sign in with your usual password.</p>'
          }${button(link, 'Sign in to ' + company)}`,
        ),
        text: `You have been added to the ${company} team.\nName: ${msg.data.name ?? ''}\nStaff number: ${msg.data.employeeNumber ?? ''}\nJob: ${msg.data.job ?? ''}\nSign in with: ${msg.data.email ?? ''}\n${password ? `Temporary password: ${password}\nYou will be asked to choose your own password at first sign-in.\n` : 'Use your usual password.\n'}Sign in: ${link}\n`,
      };
    }
    case 'platform-message': {
      const body = (msg.data.message ?? '')
        .split(/\n{2,}/)
        .map(
          (p) =>
            `<p style="line-height:1.6;margin:0 0 12px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`,
        )
        .join('');
      const subject = (msg.data.subject ?? 'A message from NTS Transport').slice(0, 150);
      return {
        subject,
        html: layout(subject, body),
        text: `${msg.data.message ?? ''}\n`,
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
