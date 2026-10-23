import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from './config/env.js';
import { WEB_CSP, mountWeb } from './web-static.js';

describe('mountWeb', () => {
  let dir: string;
  let app: express.Express;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'nts-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(
      join(dir, 'index.html'),
      '<!doctype html><title>NTS</title><div id="root"></div>',
    );
    writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
    writeFileSync(join(dir, 'robots.txt'), 'User-agent: *');
    app = express();
    app.get('/api/v1/ping', (_req, res) => {
      res.json({ pong: true });
    });
    mountWeb(app, dir);
    app.use((_req, res) => {
      res.status(404).json({ error: { code: 'NOT_FOUND' } });
    });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('serves the app shell for client-side routes, with the policy and no caching', async () => {
    for (const path of ['/', '/login', '/c/123/bookings', '/trips?from=Bo']) {
      const res = await request(app).get(path).expect(200);
      expect(res.text).toContain('<div id="root">');
      expect(res.headers['content-security-policy']).toBe(WEB_CSP);
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('caches fingerprinted assets for a year and revalidates other files', async () => {
    const a = await request(app).get('/assets/app-abc123.js').expect(200);
    expect(a.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await request(app).get('/robots.txt').expect(200)).headers['cache-control']).toBe(
      'no-cache',
    );
  });

  it('never answers a missing file or an unknown API path with the app shell', async () => {
    const js = await request(app).get('/assets/missing.js').expect(404);
    expect(js.text).not.toContain('<div id="root">');
    const api = await request(app).get('/api/v1/nope').expect(404);
    expect(api.body).toEqual({ error: { code: 'NOT_FOUND' } });
    await request(app).get('/health/nope').expect(404);
  });

  it('leaves real API routes and non-GET requests alone', async () => {
    expect((await request(app).get('/api/v1/ping').expect(200)).body).toEqual({ pong: true });
    await request(app).post('/login').expect(404);
  });

  it('refuses a directory that is not a build', () => {
    expect(() => mountWeb(express(), join(dir, 'assets'))).toThrow(/index\.html/);
  });
});

describe('Render settings', () => {
  const prod = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@h/db',
    REDIS_URL: 'rediss://default:p@h:6379',
    SESSION_SECRET: 's'.repeat(40),
    MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  };

  it('uses the service URL for the app, API and CORS unless they are set explicitly', () => {
    const e = loadEnv({
      ...prod,
      ALLOW_DEV_MAILER: 'true',
      RENDER_EXTERNAL_URL: 'https://nts.onrender.com',
    });
    expect(e.APP_URL).toBe('https://nts.onrender.com');
    expect(e.API_URL).toBe('https://nts.onrender.com');
    expect(e.CORS_ORIGINS).toEqual(['https://nts.onrender.com']);
    const own = loadEnv({
      ...prod,
      ALLOW_DEV_MAILER: 'true',
      RENDER_EXTERNAL_URL: 'https://nts.onrender.com',
      APP_URL: 'https://app.example.com',
    });
    expect(own.APP_URL).toBe('https://app.example.com');
  });

  it('still requires Brevo in production unless the test-only mailer is switched on', () => {
    const base = { ...prod, RENDER_EXTERNAL_URL: 'https://nts.onrender.com' };
    expect(() => loadEnv(base)).toThrow(/BREVO_API_KEY/);
    expect(() => loadEnv({ ...base, ALLOW_DEV_MAILER: 'true' })).not.toThrow();
  });

  it('keeps every other production rule when the test-only mailer is on', () => {
    expect(() =>
      loadEnv({ ...prod, ALLOW_DEV_MAILER: 'true', APP_URL: 'http://insecure.example.com' }),
    ).toThrow(/https/);
    const noRedis: Record<string, string> = { ...prod };
    delete noRedis.REDIS_URL;
    expect(() =>
      loadEnv({
        ...noRedis,
        ALLOW_DEV_MAILER: 'true',
        RENDER_EXTERNAL_URL: 'https://x.onrender.com',
      }),
    ).toThrow(/REDIS_URL/);
  });
});
