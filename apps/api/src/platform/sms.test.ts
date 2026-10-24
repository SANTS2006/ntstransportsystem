import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env.js';
import { BrevoSms, maskNumbers, TwilioSms } from './sms.js';

interface Call {
  url: string;
  headers: Record<string, string>;
  body: URLSearchParams;
}
function fakeFetch(status = 201, body: unknown = { sid: 'SM1', status: 'queued' }) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
      body: init?.body as URLSearchParams,
    });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fn, calls };
}

const cfg = { accountSid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', authToken: 'secret-token-value' };

describe('TwilioSms', () => {
  it('posts To, From and Body, form-encoded, with the account as HTTP Basic credentials', async () => {
    const { fn, calls } = fakeFetch();
    await new TwilioSms({ ...cfg, from: '+15557122661' }, fn).send(
      '+23276123456',
      'Your code is 123456',
    );
    const c = calls[0]!;
    expect(c.url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`,
    );
    expect(c.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(c.headers.authorization).toBe(
      `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64')}`,
    );
    expect(c.body.get('To')).toBe('+23276123456');
    expect(c.body.get('From')).toBe('+15557122661');
    expect(c.body.get('Body')).toBe('Your code is 123456');
    expect(c.body.get('MessagingServiceSid')).toBeNull();
  });

  it('can send through a messaging service instead of a number', async () => {
    const { fn, calls } = fakeFetch();
    await new TwilioSms({ ...cfg, messagingServiceSid: 'MGxxxxxxxxxxxxxxxxxxxx' }, fn).send(
      '+23276123456',
      'hi',
    );
    expect(calls[0]!.body.get('MessagingServiceSid')).toBe('MGxxxxxxxxxxxxxxxxxxxx');
    expect(calls[0]!.body.get('From')).toBeNull();
  });

  it('needs a sender', () => {
    expect(() => new TwilioSms(cfg)).toThrow(/TWILIO_FROM/);
  });

  it('fails when Twilio refuses, without putting the number or the message in the error', async () => {
    const { fn } = fakeFetch(400, { code: 21211, message: 'Invalid To number' });
    const s = new TwilioSms({ ...cfg, from: '+15557122661' }, fn);
    const err = await s.send('+23276123456', 'Your code is 654321').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('400');
    expect((err as Error).message).toContain('21211');
    expect((err as Error).message).not.toContain('23276123456');
    expect((err as Error).message).not.toContain('654321');
  });
});

describe('text message settings', () => {
  const prod = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@h/db',
    REDIS_URL: 'rediss://default:p@h:6379',
    SESSION_SECRET: 's'.repeat(40),
    MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    ALLOW_DEV_MAILER: 'true',
    APP_URL: 'https://app.example.com',
    CORS_ORIGINS: 'https://app.example.com',
  };
  it('wants the Twilio account and token together, and a sender with them', () => {
    expect(() => loadEnv({ ...prod, TWILIO_ACCOUNT_SID: 'ACxxxxxxxxxxxxxxxx' })).toThrow(
      /together/,
    );
    expect(() =>
      loadEnv({
        ...prod,
        TWILIO_ACCOUNT_SID: 'ACxxxxxxxxxxxxxxxx',
        TWILIO_AUTH_TOKEN: 'tokentokentoken',
      }),
    ).toThrow(/TWILIO_FROM/);
    expect(() =>
      loadEnv({
        ...prod,
        TWILIO_ACCOUNT_SID: 'ACxxxxxxxxxxxxxxxx',
        TWILIO_AUTH_TOKEN: 'tokentokentoken',
        TWILIO_FROM: '+15557122661',
      }),
    ).not.toThrow();
    expect(() => loadEnv(prod)).not.toThrow(); // phone sign-up is simply off without them
  });
});

describe('BrevoSms', () => {
  it('posts the sender, recipient and content as JSON with the API key', async () => {
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const fn = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: init?.headers as Record<string, string>,
        body: String(init?.body),
      });
      return new Response(JSON.stringify({ messageId: 1 }), { status: 201 });
    }) as typeof fetch;
    await new BrevoSms({ apiKey: 'xkeysib-test-key', sender: 'NTS' }, fn).send(
      '+23276123456',
      'Your code is 123456',
    );
    expect(calls[0]!.url).toBe('https://api.brevo.com/v3/transactionalSMS/send');
    expect(calls[0]!.headers['api-key']).toBe('xkeysib-test-key');
    expect(JSON.parse(calls[0]!.body)).toEqual({
      sender: 'NTS',
      recipient: '+23276123456',
      content: 'Your code is 123456',
      type: 'transactional',
    });
  });

  it("says why Brevo refused, without the person's number", async () => {
    const fn = (async () =>
      new Response(
        JSON.stringify({ code: 'not_enough_credits', message: 'No credits for +232 76 123 456' }),
        { status: 400 },
      )) as typeof fetch;
    const err = await new BrevoSms({ apiKey: 'k'.repeat(12), sender: 'NTS' }, fn)
      .send('+23276123456', 'secret text 123456')
      .catch((e: Error) => e);
    expect((err as Error).message).toContain('not_enough_credits');
    expect((err as Error).message).not.toContain('76 123 456');
    expect((err as Error).message).not.toContain('secret text');
  });
});

describe('maskNumbers', () => {
  it('hides phone numbers in a provider message', () => {
    expect(maskNumbers("The 'To' number +23276123456 is not valid")).toBe(
      "The 'To' number [number] is not valid",
    );
  });
});
