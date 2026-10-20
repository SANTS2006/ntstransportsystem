import { describe, expect, it, vi } from 'vitest';
import { BrevoMailer, MailDeliveryError } from './brevo.mailer.js';
import { escapeHtml, renderMail, safeLink } from './templates.js';

const msg = {
  to: 'rider@example.test',
  template: 'password-reset' as const,
  data: { link: 'https://app.example.test/reset-password?token=abc123secret' },
};

const respond = (status: number, headers: Record<string, string> = {}) =>
  new Response('{}', { status, headers });

function mailer(
  responses: (Response | Error)[],
  extra: Partial<ConstructorParameters<typeof BrevoMailer>[0]> = {},
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const queue = [...responses];
  const sleeps: number[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra call');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const m = new BrevoMailer({
    apiKey: 'xkeysib-TOPSECRET',
    senderEmail: 'no-reply@nts.example',
    senderName: 'NTS',
    fetchFn,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0,
    ...extra,
  });
  return { m, calls, sleeps };
}

describe('BrevoMailer', () => {
  it('posts to the documented endpoint with the api-key header and a rendered body', async () => {
    const { m, calls } = mailer([respond(201)]);
    await m.send(msg);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.brevo.com/v3/smtp/email');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['api-key']).toBe('xkeysib-TOPSECRET');
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.to).toEqual([{ email: 'rider@example.test' }]);
    expect(body.sender.email).toBe('no-reply@nts.example');
    expect(body.subject).toBe('Reset your password');
    expect(body.htmlContent).toContain('abc123secret');
  });

  it('retries 429 (honouring Retry-After) and 5xx, then succeeds', async () => {
    const { m, calls, sleeps } = mailer([
      respond(429, { 'retry-after': '2' }),
      respond(503),
      respond(201),
    ]);
    await m.send(msg);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([2000, 1000]); // Retry-After first, then exponential backoff (jitter pinned to 0)
  });

  it('retries network failures and gives up after the attempt limit', async () => {
    const { m, calls } = mailer([
      new Error('ECONNRESET'),
      new Error('ECONNRESET'),
      new Error('ECONNRESET'),
    ]);
    await expect(m.send(msg)).rejects.toMatchObject({ retryable: true });
    expect(calls).toHaveLength(3);
  });

  it('does not retry permanent 4xx errors', async () => {
    const { m, calls } = mailer([respond(400)]);
    await expect(m.send(msg)).rejects.toMatchObject({ retryable: false, status: 400 });
    expect(calls).toHaveLength(1);
  });

  it('never puts the API key, recipient or link in an error', async () => {
    const { m } = mailer([respond(401)]);
    const err = await m.send(msg).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailDeliveryError);
    const text = JSON.stringify({ message: (err as Error).message, stack: (err as Error).stack });
    expect(text).not.toContain('TOPSECRET');
    expect(text).not.toContain('rider@example.test');
    expect(text).not.toContain('abc123secret');
  });

  it('refuses to send a message with an unsafe link', async () => {
    const { m, calls } = mailer([respond(201)]);
    await expect(m.send({ ...msg, data: { link: 'javascript:alert(1)' } })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('mail templates', () => {
  it('escapes untrusted values (company names) in HTML', () => {
    const out = renderMail({
      template: 'tenant-invitation',
      data: { company: '<script>alert(1)</script> & "Co"', link: 'https://a.example/x?t=1' },
    });
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
    expect(out.html).toContain('&amp;');
  });
  it('keeps names and tokens out of subject lines', () => {
    const out = renderMail({
      template: 'tenant-invitation',
      data: { company: 'Secret Coaches', link: 'https://a.example/x?token=zzz' },
    });
    expect(out.subject).not.toContain('Secret');
    expect(out.subject).not.toContain('zzz');
  });
  it('allows only http(s) links', () => {
    expect(safeLink('https://a.example/p?q=1')).toContain('https://a.example');
    expect(() => safeLink('javascript:alert(1)')).toThrow();
    expect(() => safeLink('data:text/html,hi')).toThrow();
    expect(() => safeLink(undefined)).toThrow();
    expect(escapeHtml(`<a href="x">'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&lt;/a&gt;');
  });
});
