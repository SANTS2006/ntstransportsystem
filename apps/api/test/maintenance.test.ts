import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withDb, type Db } from '../src/platform/db.js';
import { createDb, enrollMfa, makeApp, newClient, TEST_DB_URL } from './helpers.js';

/**
 * Maintenance mode is ONE global row, so while this file runs every other test app that reads the
 * row would see it too. Run this file on its own (not in parallel with the other database suites).
 * The row is always switched off again, even if a test fails.
 */
describe.skipIf(!TEST_DB_URL)('maintenance mode (database)', () => {
  let db: Db;
  let ctx: ReturnType<typeof makeApp>;

  beforeAll(() => {
    db = createDb(TEST_DB_URL as string);
    ctx = makeApp(db);
  });
  afterAll(async () => {
    await withDb(db, { platform: true }, (tx) =>
      tx.platformSetting.update({
        where: { id: 'singleton' },
        data: { maintenanceEnabled: false, maintenanceMessage: null, maintenanceSince: null },
      }),
    ).catch(() => undefined);
    await db.$disconnect();
  });

  async function platformUser(role: 'SUPER_ADMIN' | 'SUPPORT') {
    const c = await newClient(ctx.app, db, `maint-${role.toLowerCase()}`);
    await enrollMfa(c);
    await db.platformRoleAssignment.create({ data: { userId: c.userId, role } });
    return c;
  }

  it('is switched by authorised platform staff only, blocks the app, and keeps sign-in and the banner up', async () => {
    const admin = await platformUser('SUPER_ADMIN');
    const support = await platformUser('SUPPORT');
    const ordinary = await newClient(ctx.app, db, 'maint-user');

    // Permissions and validation.
    await ordinary.call('put', '/platform/maintenance').send({ enabled: false }).expect(404);
    await ordinary.call('get', '/platform/maintenance').expect(404);
    await support.call('get', '/platform/maintenance').expect(200);
    await support
      .call('put', '/platform/maintenance')
      .send({ enabled: true, message: 'Nope nope' })
      .expect(403);
    await request(ctx.app).put('/api/v1/platform/maintenance').send({ enabled: false }).expect(401);
    await admin.call('put', '/platform/maintenance').send({ enabled: true }).expect(400); // message required
    await admin
      .call('put', '/platform/maintenance')
      .send({ enabled: true, message: 'ab' })
      .expect(400);
    await admin
      .call('put', '/platform/maintenance')
      .send({ enabled: true, message: 'x'.repeat(301) })
      .expect(400);
    await admin
      .call('put', '/platform/maintenance')
      .send({ enabled: true, message: 'Back soon', extra: 1 })
      .expect(400);

    try {
      const on = await admin
        .call('put', '/platform/maintenance')
        .send({ enabled: true, message: 'Upgrading the database' })
        .expect(200);
      expect(on.body).toMatchObject({ enabled: true, message: 'Upgrading the database' });
      const since = on.body.since as string;

      // Everyone else is blocked with a clear, machine-readable answer...
      const blocked = await ordinary.call('get', '/passenger/bookings').expect(503);
      expect(blocked.body.error).toMatchObject({
        code: 'MAINTENANCE',
        message: 'Upgrading the database',
      });
      expect(blocked.headers['retry-after']).toBe('300');
      await request(ctx.app).get('/api/v1/public/trips?date=2030-01-01').expect(503);

      // ...while the public banner, sign-in and admin tools stay available.
      const status = await request(ctx.app).get('/api/v1/maintenance-status').expect(200);
      expect(status.body).toMatchObject({ enabled: true, message: 'Upgrading the database' });
      await ordinary.call('get', '/auth/me').expect(200);
      await support.call('get', '/platform/maintenance').expect(200);

      // Editing the message keeps the original start time.
      const edited = await admin
        .call('put', '/platform/maintenance')
        .send({ enabled: true, message: 'Back at 14:00 UTC' })
        .expect(200);
      expect(edited.body.since).toBe(since);
    } finally {
      const off = await admin.call('put', '/platform/maintenance').send({ enabled: false });
      expect(off.status).toBe(200);
    }
    expect(off200(await request(ctx.app).get('/api/v1/maintenance-status'))).toEqual({
      enabled: false,
      message: null,
      since: null,
    });
    await ordinary.call('get', '/passenger/bookings').expect(200);

    const audits = await withDb(db, { platform: true }, (tx) =>
      tx.auditLog.count({
        where: { action: 'platform.maintenance_set', actorUserId: admin.userId },
      }),
    );
    expect(audits).toBe(3); // on, edit, off
  }, 600_000);

  it('cannot be changed by the application role outside platform scope, and always has exactly one row', async () => {
    await expect(
      withDb(db, { tenantId: '00000000-0000-4000-8000-000000000000' }, (tx) =>
        tx.platformSetting.update({
          where: { id: 'singleton' },
          data: { maintenanceEnabled: true, maintenanceMessage: 'x', maintenanceSince: new Date() },
        }),
      ),
    ).rejects.toThrow();
    const rows = await withDb(db, {}, (tx) => tx.platformSetting.count());
    expect(rows).toBe(1);
    await expect(
      withDb(db, { platform: true }, (tx) =>
        tx.platformSetting.update({
          where: { id: 'singleton' },
          data: { maintenanceEnabled: true },
        }),
      ),
    ).rejects.toThrow(); // the CHECK: enabling needs a message and a start time
  }, 300_000);
});

const off200 = (r: request.Response) => r.body as { enabled: boolean; message: null; since: null };
