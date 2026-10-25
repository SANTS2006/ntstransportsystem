import type { Logger } from 'pino';

export type MailTemplate =
  | 'verify-email'
  | 'password-reset'
  | 'password-changed'
  | 'tenant-invitation'
  | 'company-admin-created'
  | 'staff-added'
  | 'platform-message'
  | 'booking-confirmed'
  | 'booking-cancelled'
  | 'trip-delayed'
  | 'trip-vehicle-changed'
  | 'refund-required'
  | 'complaint-received'
  | 'complaint-reply'
  | 'application-received'
  | 'application-update';

/** Who an e-mail is from: the company it belongs to, or the system itself. */
export interface MailBrand {
  name: string;
  /** An absolute address of the logo picture, when there is one. */
  logoUrl: string | null;
  /** #rrggbb */
  primary: string;
  accent: string;
  /** The brand's own web address (a company's page, or the system's). */
  siteUrl: string;
}

export interface MailAttachment {
  name: string;
  contentBase64: string;
}

export interface MailMessage {
  to: string;
  template: MailTemplate;
  data: Record<string, string>;
  /** The company this mail is about; it decides the brand (name, logo, colours). Absent: the system. */
  tenantId?: string | undefined;
  brand?: MailBrand | undefined;
  attachments?: MailAttachment[] | undefined;
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
