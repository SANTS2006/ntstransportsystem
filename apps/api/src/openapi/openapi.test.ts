import { randomBytes } from 'node:crypto';
import SwaggerParser from '@apidevtools/swagger-parser';
import { isPermission } from '@nts/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import type { GoogleVerifier } from '../modules/authentication/google.service.js';
import type { Db } from '../platform/db.js';
import { createLogger } from '../platform/logger.js';
import type { RouteInfo } from '../platform/router.js';
import { buildOpenApi } from './build.js';
import { operations } from './operations.js';

const mfaKey = randomBytes(32).toString('base64');
function app(extra: Record<string, string> = {}) {
  const env = loadEnv({ NODE_ENV: 'test', MFA_ENCRYPTION_KEY: mfaKey, ...extra });
  return createApp({
    env,
    logger: createLogger(env),
    db: {} as Db, // routers are built but no query runs in these tests
    mailer: { send: async () => undefined },
    googleVerifier: {
      verify: async () => ({ sub: 's', email: 'e@x.y', emailVerified: true, name: 'n' }),
    } as GoogleVerifier,
  });
}

type Spec = {
  openapi: string;
  paths: Record<
    string,
    Record<
      string,
      Record<string, unknown> & {
        security?: unknown[];
        responses: Record<string, unknown>;
        requestBody?: { content: { 'application/json': { schema: Record<string, unknown> } } };
      }
    >
  >;
};

const table = (a: ReturnType<typeof app>) => a.locals.routeTable as RouteInfo[];

describe('OpenAPI document', () => {
  it('covers every registered route and nothing else (no drift)', () => {
    // Every optional feature on, including file storage (a development directory).
    const a = app({ STORAGE_DEV_DIR: '.tmp-dev-storage' });
    expect(table(a).length).toBeGreaterThan(80);
    expect(() => buildOpenApi(table(a))).not.toThrow();
    expect(Object.keys(operations)).toHaveLength(table(a).length);
  });

  it('fails loudly when a route is undocumented or an operation has no route', () => {
    const routes = table(app());
    expect(() =>
      buildOpenApi([...routes, { method: 'get', path: '/api/v1/secret/new-endpoint' }]),
    ).toThrow(/without documentation[\s\S]*GET \/api\/v1\/secret\/new-endpoint/);
    expect(() => buildOpenApi(routes.slice(1))).toThrow(/without a route/);
  });

  it('is a valid OpenAPI 3.1 document', async () => {
    const spec = buildOpenApi(table(app()));
    expect(spec.openapi).toBe('3.1.0');
    await expect(SwaggerParser.validate(structuredClone(spec) as never)).resolves.toBeDefined();
  });

  it('documents authentication, CSRF and tenancy accurately', () => {
    const spec = buildOpenApi(table(app())) as unknown as Spec;
    const login = spec.paths['/auth/login']!.post!;
    expect(login.security).toEqual([]); // public
    expect(Object.keys(login.responses)).toEqual(expect.arrayContaining(['200', '400', '429']));

    const createVehicle = spec.paths['/tenants/{tenantId}/vehicles']!.post!;
    expect(createVehicle.security).toEqual([{ sessionCookie: [], csrfToken: [] }]); // unsafe method needs CSRF too
    expect(createVehicle['x-required-permission']).toBe('fleet.manage');
    expect(Object.keys(createVehicle.responses)).toEqual(
      expect.arrayContaining(['201', '400', '401', '403', '404', '409']),
    );

    const listVehicles = spec.paths['/tenants/{tenantId}/vehicles']!.get!;
    expect(listVehicles.security).toEqual([{ sessionCookie: [] }]); // safe method: no CSRF
    expect(JSON.stringify(listVehicles.parameters)).toMatch(/"name":"limit"[\s\S]*"name":"offset"/);

    expect(spec.paths['/health/live']!.servers).toEqual([{ url: '/' }]); // health lives outside /api/v1
  });

  it('derives request schemas from the real validation schemas, constraints included', () => {
    const spec = buildOpenApi(table(app())) as unknown as Spec;
    const vehicle = spec.paths['/tenants/{tenantId}/vehicles']!.post!.requestBody!.content[
      'application/json'
    ].schema as {
      properties: Record<string, { minimum?: number; maximum?: number }>;
      required: string[];
      additionalProperties?: boolean;
    };
    expect(vehicle.properties.seatingCapacity).toMatchObject({ minimum: 1, maximum: 200 });
    expect(vehicle.required).toEqual(
      expect.arrayContaining(['registration', 'type', 'seatingCapacity']),
    );
    expect(vehicle.additionalProperties).toBe(false); // strict: mass assignment is rejected

    const login = spec.paths['/auth/login']!.post!.requestBody!.content['application/json']
      .schema as { required: string[] };
    expect(login.required).toEqual(['email', 'password']);
  });

  it('only names permissions that exist in the permission catalog', () => {
    for (const [key, op] of Object.entries(operations)) {
      if (op.access === 'tenant' && op.permission)
        expect(isPermission(op.permission), `${key} -> ${op.permission}`).toBe(true);
      if (op.access === 'tenant') expect(key).toContain('{tenantId}');
    }
  });

  it('never documents a secret-bearing example or default', () => {
    const text = JSON.stringify(buildOpenApi(table(app())));
    expect(text).not.toMatch(/xkeysib|BEGIN [A-Z ]*PRIVATE KEY|postgres(ql)?:\/\//i);
  });
});

describe('feature-gated operations', () => {
  /** An app with Google sign-in and MFA not configured, as a minimal production deployment would be. */
  function minimalApp() {
    const env = loadEnv({ NODE_ENV: 'test' });
    return createApp({
      env,
      logger: createLogger(env),
      db: {} as Db,
      mailer: { send: async () => undefined },
    });
  }

  it('builds and serves a valid spec when Google and MFA are not configured, omitting those operations', async () => {
    const a = minimalApp();
    const spec = buildOpenApi(table(a)) as unknown as Spec; // must not throw
    await expect(SwaggerParser.validate(structuredClone(spec) as never)).resolves.toBeDefined();
    expect(spec.paths['/auth/google']).toBeUndefined();
    expect(spec.paths['/auth/google/link']).toBeUndefined();
    expect(spec.paths['/auth/mfa/enroll']).toBeUndefined();
    expect(spec.paths['/auth/mfa/disable']).toBeUndefined();
    expect(spec.paths['/auth/mfa/verify']).toBeDefined(); // always registered
    // No file storage configured: the upload endpoints are not mounted, and not documented.
    expect(spec.paths['/applicant/applications/{id}/cv']).toBeUndefined();
    expect(spec.paths['/dev-files']).toBeUndefined();
    const served = await request(a).get('/api/v1/openapi.json').expect(200);
    expect(served.body.paths['/auth/login']).toBeDefined();
    expect(served.body.paths['/auth/google']).toBeUndefined();
  });

  it('includes them, with a note about the configuration they need, when enabled', () => {
    const spec = buildOpenApi(table(app())) as unknown as Spec;
    expect(spec.paths['/auth/google']).toBeDefined();
    expect(JSON.stringify(spec.paths['/auth/google'])).toMatch(/GOOGLE_CLIENT_ID/);
    expect(JSON.stringify(spec.paths['/auth/mfa/enroll'])).toMatch(/MFA_ENCRYPTION_KEY/);
  });

  it('still reports genuine drift: an unlisted route is an error even with optional operations around', () => {
    const routes = [
      ...table(minimalApp()),
      { method: 'delete' as const, path: '/api/v1/tenants/:tenantId/new-thing/:id' },
    ];
    expect(() => buildOpenApi(routes)).toThrow(/without documentation/);
  });
});

describe('serving the documentation', () => {
  it('serves the spec, the UI page, its bootstrap script and assets', async () => {
    const a = app();
    const json = await request(a).get('/api/v1/openapi.json').expect(200);
    expect(json.body.openapi).toBe('3.1.0');
    const page = await request(a).get('/api/v1/docs').expect(200);
    expect(page.text).toContain('swagger-ui');
    expect(page.text).not.toMatch(/<script>[^<]/); // no inline script: works under script-src 'self'
    const init = await request(a).get('/api/v1/docs/init.js').expect(200);
    expect(init.text).toContain('x-csrf-token');
    await request(a).get('/api/v1/docs/assets/swagger-ui-bundle.js').expect(200);
  });

  it('is off by default in production and can be switched off explicitly', async () => {
    const prod = loadEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x',
      REDIS_URL: 'redis://x',
      SESSION_SECRET: 'a'.repeat(32),
      APP_URL: 'https://example.com',
      MFA_ENCRYPTION_KEY: mfaKey,
      BREVO_API_KEY: 'xkeysib-placeholder',
      MAIL_FROM_EMAIL: 'no-reply@example.com',
    });
    const prodApp = createApp({
      env: prod,
      logger: createLogger(prod),
      db: {} as Db,
      mailer: { send: async () => undefined },
    });
    await request(prodApp).get('/api/v1/openapi.json').expect(404);
    await request(prodApp).get('/api/v1/docs').expect(404);

    const off = app({ API_DOCS_ENABLED: 'false' });
    await request(off).get('/api/v1/openapi.json').expect(404);
  });
});
