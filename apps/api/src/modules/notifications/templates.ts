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
    default: {
      const never: never = t;
      throw new Error(`Unknown mail template: ${String(never)}`);
    }
  }
}
