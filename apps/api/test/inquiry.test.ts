import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withDb, type Db, type Tx } from '../src/platform/db.js';
import { createDb, makeApp, newClient, TEST_DB_URL, uniq } from './helpers.js';

describe.skipIf(!TEST_DB_URL)('website enquiries (database)', () => {
  let db: Db;
  let ctx: ReturnType<typeof makeApp>;

  beforeAll(() => {
    db = createDb(TEST_DB_URL as string);
    ctx = makeApp(db);
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  const plat = <T>(fn: (tx: Tx) => Promise<T>) => withDb(db, { platform: true }, fn);
  const post = (body: Record<string, unknown>) =>
    request(ctx.app).post('/api/v1/public/inquiries').send(body);

  it('stores a contact message and a demo request, and e-mails a notice of each', async () => {
    const who = uniq('visitor');
    await post({
      kind: 'CONTACT',
      name: who,
      email: 'visitor@example.test',
      message: 'We run twelve coaches and would like to know more.',
    }).expect(201);
    await post({
      kind: 'DEMO',
      name: who,
      email: 'visitor@example.test',
      company: 'Sierra Coaches',
      fleetSize: '6-20',
      preferredDate: '2026-12-01',
      preferredTime: '10:00',
    }).expect(201);
    const rows = await plat((tx) => tx.siteInquiry.findMany({ where: { name: who } }));
    expect(rows.map((r) => r.kind).sort()).toEqual(['CONTACT', 'DEMO']);
    expect(rows.find((r) => r.kind === 'DEMO')?.details).toMatchObject({ fleetSize: '6-20' });
    const notices = ctx.mailer.sent.filter(
      (m) => m.template === 'platform-message' && m.data.message?.includes(who),
    );
    expect(notices).toHaveLength(2);
    expect(notices[0]!.to).toBe('hello@ntsdigitalsolutions.com');
  });

  it('refuses bad input and silently drops what robots send', async () => {
    await post({ kind: 'CONTACT', name: 'A', email: 'nope', message: 'hi' }).expect(400);
    await post({ kind: 'CONTACT', name: 'Visitor', email: 'v@example.test' }).expect(400); // no message
    await post({ kind: 'DEMO', name: 'Visitor', email: 'v@example.test' }).expect(400); // no company
    await post({
      kind: 'CONTACT',
      name: 'Visitor',
      email: 'v@example.test',
      message: 'x'.repeat(20),
      extra: 1,
    }).expect(400);
    const robot = uniq('robot');
    await post({
      kind: 'CONTACT',
      name: robot,
      email: 'r@example.test',
      message: 'Buy cheap things now please',
      website: 'http://spam.example',
    }).expect(201); // looks like success to the robot
    expect(await plat((tx) => tx.siteInquiry.count({ where: { name: robot } }))).toBe(0);
  });

  it('is readable only by platform administrators', async () => {
    const nobody = await newClient(ctx.app, db, 'inq-nobody');
    await request(ctx.app).get('/api/v1/platform/inquiries').expect(401);
    await nobody.call('get', '/platform/inquiries').expect(404); // no platform role: nothing to see
  });
});
