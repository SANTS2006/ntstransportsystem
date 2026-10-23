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
      const err = (await res.json().catch(() => null)) as { code?: number } | null;
      // The message text and number are deliberately left out of the error.
      throw new Error(
        `Twilio refused the message (${res.status}${err?.code ? `, code ${err.code}` : ''})`,
      );
    }
  }
}
