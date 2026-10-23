import express from 'express';
import type { Logger } from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../platform/db.js';
import { errorHandler } from '../../platform/http.js';
import { MaintenanceModeService, maintenanceGate } from './maintenance.js';

const silent = { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as Logger;

/** A stand-in for the database: withDb only needs $transaction and $executeRaw. */
function fakeDb(row: () => unknown) {
  const reads = vi.fn();
  const db = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $executeRaw: async () => 0,
        platformSetting: {
          findUnique: async () => {
            reads();
            return row();
          },
        },
      }),
  } as unknown as Db;
  return { db, reads };
}

const on = {
  maintenanceEnabled: true,
  maintenanceMessage: 'Back at noon',
  maintenanceSince: new Date('2026-10-23T10:00:00Z'),
};

function appWith(service: MaintenanceModeService) {
  const app = express();
  app.use(maintenanceGate(service));
  const ok = (_req: express.Request, res: express.Response) => res.json({ ok: true });
  for (const path of [
    '/maintenance-status',
    '/auth/login',
    '/platform/maintenance',
    '/webhooks/monime/abc',
    '/tenants/1/bookings',
    '/public/trips',
    '/passenger/bookings',
  ]) {
    app.all(path, ok);
  }
  app.use(errorHandler(silent));
  return app;
}

describe('maintenance gate', () => {
  it('lets everything through when maintenance is off', async () => {
    const { db } = fakeDb(() => ({ maintenanceEnabled: false }));
    const app = appWith(new MaintenanceModeService(db, silent, 0));
    await request(app).get('/tenants/1/bookings').expect(200);
    await request(app).post('/passenger/bookings').expect(200);
  });

  it('answers 503 with the message and Retry-After, but keeps auth, platform, webhooks and status up', async () => {
    const { db } = fakeDb(() => on);
    const app = appWith(new MaintenanceModeService(db, silent, 0));
    for (const [method, path] of [
      ['get', '/tenants/1/bookings'],
      ['post', '/passenger/bookings'],
      ['get', '/public/trips'],
    ] as const) {
      const res = await request(app)[method](path).expect(503);
      expect(res.body.error).toMatchObject({ code: 'MAINTENANCE', message: 'Back at noon' });
      expect(res.headers['retry-after']).toBe('300');
    }
    for (const path of [
      '/maintenance-status',
      '/auth/login',
      '/platform/maintenance',
      '/webhooks/monime/abc',
    ]) {
      await request(app).post(path).expect(200);
    }
    await request(app)
      .options('/tenants/1/bookings')
      .expect((r) => {
        expect(r.status).not.toBe(503); // CORS preflights are never blocked
      });
  });

  it('does not let a lookalike path slip through the allow-list', async () => {
    const { db } = fakeDb(() => on);
    const app = express();
    app.use(maintenanceGate(new MaintenanceModeService(db, silent, 0)));
    app.all('*splat', (_req, res) => res.json({ ok: true }));
    app.use(errorHandler(silent));
    for (const path of [
      '/authx/login',
      '/platformer',
      '/webhooksx',
      '/x/auth/login',
      '/maintenance-status-x',
    ]) {
      await request(app).get(path).expect(503);
    }
  });

  it('caches the state, so the gate does not query the database on every request', async () => {
    const { db, reads } = fakeDb(() => on);
    const service = new MaintenanceModeService(db, silent, 60_000);
    const app = appWith(service);
    for (let i = 0; i < 5; i++) await request(app).get('/public/trips').expect(503);
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('fails open when the state cannot be read, and keeps the last known state afterwards', async () => {
    let broken = false;
    let enabled = true;
    const { db } = fakeDb(() => {
      if (broken) throw new Error('db down');
      return enabled ? on : { maintenanceEnabled: false };
    });
    const service = new MaintenanceModeService(db, silent, 0);
    const app = appWith(service);
    await request(app).get('/public/trips').expect(503); // known: on
    broken = true;
    await request(app).get('/public/trips').expect(503); // unreadable: keeps the last known state
    const fresh = new MaintenanceModeService(db, silent, 0);
    await request(appWith(fresh)).get('/public/trips').expect(200); // nothing known: fail open
    enabled = false;
    broken = false;
    await request(app).get('/public/trips').expect(200);
  });
});
