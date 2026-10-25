import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import type { Client } from './helpers.js';
import { withDb, type Db } from '../src/platform/db.js';
import {
  createDb,
  createTenantWithOwner,
  loginClient,
  makeApp,
  newClient,
  TEST_DB_URL,
  uniq,
} from './helpers.js';

describe.skipIf(!TEST_DB_URL)('platform backup and recovery (database)', () => {
  let db: Db;
  let ctx: ReturnType<typeof makeApp>;
  beforeAll(() => {
    db = createDb(TEST_DB_URL as string);
    ctx = makeApp(db);
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  /** Starts a job and waits for it to finish. */
  async function wait(admin: Client, id: string) {
    for (let i = 0; i < 400; i++) {
      const j = await admin.call('get', `/platform/backup/jobs/${id}`).expect(200);
      if (j.body.status !== 'running') return j.body;
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error('the job did not finish');
  }
  const restoreJob = async (admin: Client, file: Buffer, mode: 'check' | 'apply') => {
    const started = await admin
      .call('post', `/platform/backup/restore?mode=${mode}`)
      .set('content-type', 'application/gzip')
      .send(file)
      .expect(202);
    return wait(admin, started.body.id);
  };
  const plat = <T>(fn: Parameters<typeof withDb<T>>[2]) => withDb(db, { platform: true }, fn);

  it('backs up, then brings back a deleted row without touching the rest', async () => {
    const t = await createTenantWithOwner(db, 'bk');
    const place = await plat((tx) =>
      tx.location.create({ data: { tenantId: t.tenant.id, name: uniq('Depot'), city: 'Bo' } }),
    );
    const admin = await newClient(ctx.app, db, 'super');
    await db.platformRoleAssignment.create({ data: { userId: admin.userId, role: 'SUPER_ADMIN' } });

    const started = await admin.call('post', '/platform/backup').expect(202);
    const job = await wait(admin, started.body.id);
    expect(job.status).toBe('done');
    const res = await admin
      .call('get', `/platform/backup/jobs/${started.body.id}/file`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const file = res.body as Buffer;
    const text = gunzipSync(file).toString('utf8');
    expect(text).toContain(place.id);
    expect(text).not.toContain('refresh_token_hash'); // sessions are never part of a backup

    // Nothing is missing yet.
    const before = (await restoreJob(admin, file, 'check')).report.restored as number;

    await plat((tx) => tx.location.delete({ where: { id: place.id } }));
    const dry = await restoreJob(admin, file, 'check');
    expect(dry.report.restored).toBeGreaterThan(before);
    expect(await plat((tx) => tx.location.count({ where: { id: place.id } }))).toBe(0); // undone

    const done = await restoreJob(admin, file, 'apply');
    expect(done.report.restored).toBeGreaterThanOrEqual(1);
    expect(await plat((tx) => tx.location.count({ where: { id: place.id } }))).toBe(1);
  }, 400_000);

  it('refuses anyone who is not a super administrator, and files that are not backups', async () => {
    const t = await createTenantWithOwner(db, 'bk2');
    const owner = await loginClient(ctx.app, db, t.email, t.password);
    await owner.call('post', '/platform/backup').expect(404);
    const ops = await newClient(ctx.app, db, 'ops-bk');
    await db.platformRoleAssignment.create({ data: { userId: ops.userId, role: 'OPERATIONS' } });
    await ops.call('post', '/platform/backup').expect(403);
    const admin = await newClient(ctx.app, db, 'super2');
    await db.platformRoleAssignment.create({ data: { userId: admin.userId, role: 'SUPER_ADMIN' } });
    const bad = await restoreJob(admin, Buffer.from('not a backup'), 'apply');
    expect(bad.status).toBe('failed');
    expect(bad.error).toMatch(/not a backup/i);
  }, 400_000);
});
