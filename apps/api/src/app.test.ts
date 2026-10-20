import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './platform/logger.js';

const env = loadEnv({ NODE_ENV: 'test' });
const logger = createLogger(env);

describe('env validation', () => {
  it('refuses production boot without required config', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  });
  it('treats blank values as unset: fine in development, still missing in production', () => {
    expect(() =>
      loadEnv({ NODE_ENV: 'development', REDIS_URL: '', SESSION_SECRET: '' }),
    ).not.toThrow();
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://x',
        REDIS_URL: '',
        SESSION_SECRET: '',
      }),
    ).toThrow(/REDIS_URL/);
  });
  it('requires the MFA encryption key and unscaled rate limits in production', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x',
      REDIS_URL: 'redis://x',
      SESSION_SECRET: 'a'.repeat(32),
      APP_URL: 'https://example.com',
    };
    const mail = { BREVO_API_KEY: 'xkeysib-placeholder', MAIL_FROM_EMAIL: 'no-reply@example.com' };
    const mfaKey = Buffer.alloc(32, 1).toString('base64');
    expect(() => loadEnv({ ...base, ...mail })).toThrow(/MFA_ENCRYPTION_KEY/);
    expect(() =>
      loadEnv({ ...base, ...mail, MFA_ENCRYPTION_KEY: mfaKey, RATE_LIMIT_SCALE: '10' }),
    ).toThrow(/Rate limits/);
    expect(() => loadEnv({ ...base, ...mail, MFA_ENCRYPTION_KEY: mfaKey })).not.toThrow();
  });
  it('requires Brevo mail settings in production (no silent dev-mailer fallback)', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x',
      REDIS_URL: 'redis://x',
      SESSION_SECRET: 'a'.repeat(32),
      APP_URL: 'https://example.com',
      MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    };
    expect(() => loadEnv(base)).toThrow(/BREVO_API_KEY/);
    expect(() => loadEnv({ ...base, BREVO_API_KEY: 'xkeysib-placeholder' })).toThrow(
      /MAIL_FROM_EMAIL/,
    );
    expect(() =>
      loadEnv({ ...base, BREVO_API_KEY: 'xkeysib-placeholder', MAIL_FROM_EMAIL: 'not-an-email' }),
    ).toThrow();
  });
  it('rejects a malformed MFA key', () => {
    expect(() => loadEnv({ NODE_ENV: 'test', MFA_ENCRYPTION_KEY: 'short' })).toThrow(/32 bytes/);
  });
  it('refuses payment sandbox in production', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://x',
        REDIS_URL: 'redis://x',
        SESSION_SECRET: 'a'.repeat(32),
        APP_URL: 'https://example.com',
        PAYMENTS_SANDBOX: 'true',
      }),
    ).toThrow(/sandbox/i);
  });
});

describe('http foundation', () => {
  it('serves liveness with a request id', async () => {
    const res = await request(createApp({ env, logger })).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('reports readiness failure without detail', async () => {
    const app = createApp({
      env,
      logger,
      readinessChecks: [{ name: 'db', check: async () => Promise.reject(new Error('secret dsn')) }],
    });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('returns the uniform error envelope for unknown routes', async () => {
    const res = await request(createApp({ env, logger })).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('rejects malformed JSON without leaking internals', async () => {
    const res = await request(createApp({ env, logger }))
      .post('/api/v1/x')
      .set('content-type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('does not reflect disallowed CORS origins', async () => {
    const res = await request(createApp({ env, logger }))
      .get('/health/live')
      .set('origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
