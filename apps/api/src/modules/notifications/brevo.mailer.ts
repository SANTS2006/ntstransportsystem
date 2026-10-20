import type { MailMessage, Mailer } from './mailer.js';
import { renderMail } from './templates.js';

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/** Carries only a status/classification. Never the API key, recipient, or message content. */
export class MailDeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'MailDeliveryError';
  }
}

export interface BrevoOptions {
  apiKey: string;
  senderEmail: string;
  senderName: string;
  maxAttempts?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  /** Injection points for tests. */
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/**
 * Transactional email through Brevo's documented `POST /v3/smtp/email` (api-key header).
 * Retries network errors, 429 and 5xx with exponential backoff + jitter (honouring Retry-After);
 * other 4xx responses are permanent and are not retried. Brevo's reference page does not document
 * 429/Retry-After or idempotency, so those behaviours are standard-HTTP assumptions and remain
 * unverified against the live service until a real key is available.
 */
export class BrevoMailer implements Mailer {
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly baseDelayMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly opts: BrevoOptions) {
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.baseDelayMs = opts.baseDelayMs ?? 500;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
  }

  async send(msg: MailMessage): Promise<void> {
    const mail = renderMail(msg);
    const body = JSON.stringify({
      sender: { email: this.opts.senderEmail, name: this.opts.senderName },
      to: [{ email: msg.to }],
      subject: mail.subject,
      htmlContent: mail.html,
      textContent: mail.text,
      tags: [`tpl:${msg.template}`],
    });

    let lastError: MailDeliveryError | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let retryAfterMs: number | undefined;
      try {
        const res = await this.fetchFn(ENDPOINT, {
          method: 'POST',
          headers: {
            'api-key': this.opts.apiKey,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.status === 201 || res.status === 202) return;
        const retryable = res.status === 429 || res.status >= 500;
        const ra = Number(res.headers.get('retry-after'));
        retryAfterMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) * 1000 : undefined;
        lastError = new MailDeliveryError(
          `Brevo rejected the request (HTTP ${res.status})`,
          retryable,
          res.status,
        );
      } catch {
        lastError = new MailDeliveryError('Brevo request failed (network or timeout)', true);
      }
      if (!lastError.retryable || attempt === this.maxAttempts) break;
      const backoff = this.baseDelayMs * 2 ** (attempt - 1);
      await this.sleep(retryAfterMs ?? backoff + Math.floor(this.random() * backoff));
    }
    throw lastError ?? new MailDeliveryError('Mail delivery failed', false);
  }
}
