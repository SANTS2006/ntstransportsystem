import type { Logger } from 'pino';

/** Sends one text message. Implementations must not log the message text outside development. */
export interface SmsSender {
  send(to: string, text: string): Promise<void>;
}

/**
 * Development/test-deployment sender: writes the message (including the code) to the log instead
 * of sending it. Anyone who can read the logs can read the codes.
 */
export class DevLogSms implements SmsSender {
  constructor(private readonly logger: Logger) {}
  async send(to: string, text: string): Promise<void> {
    this.logger.warn({ to, text }, 'DEV SMS (not sent)');
  }
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** A phone number or alphanumeric sender id you own in Twilio; or use a messaging service. */
  from?: string | undefined;
  messagingServiceSid?: string | undefined;
}

type FetchFn = typeof fetch;

/**
 * Twilio Programmable Messaging: POST /2010-04-01/Accounts/{sid}/Messages.json with HTTP Basic
 * auth, form-encoded To, Body and either From or MessagingServiceSid. Any phone number in
 * international form is routed to its network by Twilio, so Orange, Africell and Qcell customers
 * are all reached the same way. Whether a sender id is accepted on each Sierra Leone network is
 * between you and Twilio; check their Sierra Leone guidelines before launch.
 */
export class TwilioSms implements SmsSender {
  constructor(
    private readonly cfg: TwilioConfig,
    private readonly http: FetchFn = fetch,
    private readonly timeoutMs = 10_000,
  ) {
    if (!cfg.from && !cfg.messagingServiceSid) {
      throw new Error('Twilio needs TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID');
    }
  }

  async send(to: string, text: string): Promise<void> {
    const body = new URLSearchParams({ To: to, Body: text });
    if (this.cfg.messagingServiceSid) body.set('MessagingServiceSid', this.cfg.messagingServiceSid);
    else body.set('From', this.cfg.from as string);
    const auth = Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString('base64');
    const res = await this.http(
      `https://api.twilio.com/2010-04-01/Accounts/${this.cfg.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${auth}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as {
        code?: number;
        message?: string;
      } | null;
      // The message text is never in the error, and long digit runs (phone numbers) are masked.
      throw new Error(
        `Twilio refused the message (${res.status}${err?.code ? `, code ${err.code}` : ''})${
          err?.message ? `: ${maskNumbers(err.message)}` : ''
        }`,
      );
    }
  }
}

/** Keeps a provider's explanation useful in the logs without writing anyone's number there. */
export const maskNumbers = (text: string): string =>
  text.replace(/\+?\d[\d\s-]{6,}\d/g, '[number]').slice(0, 300);

export interface BrevoSmsConfig {
  apiKey: string;
  /** Sender name: up to 11 letters and digits (or 12 to 15 digits). */
  sender: string;
}

/**
 * Brevo transactional SMS (the same account that sends the e-mails): POST
 * /v3/transactionalSMS/send with the API key. It needs SMS credits bought in Brevo, and an
 * alphanumeric sender may be refused by some networks: check Brevo's country rules for Sierra Leone.
 */
export class BrevoSms implements SmsSender {
  constructor(
    private readonly cfg: BrevoSmsConfig,
    private readonly http: FetchFn = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async send(to: string, text: string): Promise<void> {
    const res = await this.http('https://api.brevo.com/v3/transactionalSMS/send', {
      method: 'POST',
      headers: {
        'api-key': this.cfg.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: this.cfg.sender,
        recipient: to,
        content: text,
        type: 'transactional',
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as {
        code?: string;
        message?: string;
      } | null;
      throw new Error(
        `Brevo refused the message (${res.status}${err?.code ? `, ${err.code}` : ''})${
          err?.message ? `: ${maskNumbers(err.message)}` : ''
        }`,
      );
    }
  }
}
