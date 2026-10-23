import type { Logger } from 'pino';

export type MailTemplate =
  | 'verify-email'
  | 'password-reset'
  | 'password-changed'
  | 'tenant-invitation'
  | 'company-admin-created'
  | 'booking-confirmed'
  | 'booking-cancelled'
  | 'trip-delayed'
  | 'trip-vehicle-changed'
  | 'refund-required'
  | 'complaint-received'
  | 'complaint-reply'
  | 'application-received'
  | 'application-update';

export interface MailMessage {
  to: string;
  template: MailTemplate;
  data: Record<string, string>;
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

/**
 * Development-only mailer: logs the message (including links) so flows can be exercised locally.
 * Nothing is sent. Production must use the Brevo adapter (Phase 7); config will refuse this one.
 */
export class DevLogMailer implements Mailer {
  constructor(private readonly logger: Logger) {}
  async send(msg: MailMessage) {
    // Passwords and codes are left out of the log even here.
    const safe = { ...msg.data };
    delete safe.password;
    delete safe.code;
    this.logger.warn({ template: msg.template, to: msg.to, data: safe }, 'DEV mail (not sent)');
  }
}
