import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BookingService } from '../src/modules/booking/booking.service.js';
import { withDb, type Db, type Tx } from '../src/platform/db.js';
import {
  createDb,
  createTenantWithOwner,
  loginClient,
  makeApp,
  newClient,
  TEST_DB_URL,
  uniq,
  type Client,
} from './helpers.js';

describe.skipIf(!TEST_DB_URL)('tickets, receipts and boarding (database)', () => {
  let db: Db;
  let ctx: ReturnType<typeof makeApp>;
  let bookings: BookingService;

  beforeAll(() => {
    db = createDb(TEST_DB_URL as string);
    ctx = makeApp(db);
    bookings = new BookingService(db);
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  const plat = <T>(fn: (tx: Tx) => Promise<T>) => withDb(db, { platform: true }, fn);

  async function company(label: string) {
    const t = await createTenantWithOwner(db, label);
    return { tenantId: t.tenant.id, owner: await loginClient(ctx.app, db, t.email, t.password) };
  }
  async function member(tenantId: string, roleKey: string): Promise<Client> {
    const c = await newClient(ctx.app, db, roleKey);
    await plat(async (tx) => {
      const role = await tx.role.findFirstOrThrow({ where: { tenantId, key: roleKey } });
      await tx.membership.create({
        data: { tenantId, userId: c.userId, roleId: role.id, status: 'ACTIVE' },
      });
    });
    return c;
  }

  /** A company with a route, fare, 8-seat vehicle, and two trips: one boarding soon, one far away. */
  async function kit(label: string) {
    const c = await company(label);
    const { tenantId } = c;
    const fx = await plat(async (tx) => {
      const locs = await tx.location.createManyAndReturn({
        data: [uniq('O'), uniq('D')].map((name) => ({ tenantId, name, city: name })),
      });
      const route = await tx.route.create({
        data: {
          tenantId,
          name: uniq('R'),
          originId: locs[0]!.id,
          destinationId: locs[1]!.id,
          distanceM: 1000,
          durationMin: 120,
          status: 'PUBLISHED',
        },
      });
      await tx.fare.create({ data: { tenantId, routeId: route.id, amountMinor: 50_000 } });
      const v = await tx.vehicle.create({
        data: { tenantId, registration: uniq('TK').toUpperCase(), seatingCapacity: 8, type: 'BUS' },
      });
      const mk = (departureAt: Date) =>
        tx.trip.create({
          data: {
            tenantId,
            routeId: route.id,
            serviceDate: new Date(departureAt.toISOString().slice(0, 10)),
            departureAt,
            arrivalAt: new Date(departureAt.getTime() + 2 * 3_600_000),
            vehicleId: v.id,
          },
        });
      return {
        soon: await mk(new Date(Date.now() + 3_600_000)),
        far: await mk(new Date(Date.now() + 5 * 86_400_000)),
      };
    });
    return { ...c, ...fx };
  }

  const bookFor = async (c: { tenantId: string; owner: Client }, tripId: string, seats: string[]) =>
    (
      await c.owner
        .call('post', `/tenants/${c.tenantId}/bookings`)
        .send({
          tripId,
          contact: { name: 'Isatu Bangura', phone: '+23277000111' },
          passengers: seats.map((s, i) => ({ fullName: `Rider ${i + 1}`, seatLabel: s })),
        })
        .expect(201)
    ).body as { id: string };
  const confirmed = async (
    c: { tenantId: string; owner: Client },
    tripId: string,
    seats: string[],
  ) => {
    const b = await bookFor(c, tripId, seats);
    await bookings.markPaid(c.tenantId, b.id);
    return b;
  };
  const ticketsOf = async (c: { tenantId: string; owner: Client }, bookingId: string) =>
    (await c.owner.call('get', `/tenants/${c.tenantId}/bookings/${bookingId}/tickets`).expect(200))
      .body.tickets as {
      id: string;
      seat: string;
      code: string;
      token: string;
      status: string;
    }[];
  const scan = (who: Client, tenantId: string, body: object) =>
    who.call('post', `/tenants/${tenantId}/tickets/scan`).send(body);

  it('issues one ticket per seat on confirmation, once, and never before payment', async () => {
    const c = await kit('tk-issue');
    const b = await bookFor(c, c.soon.id, ['1', '2']);
    expect(await ticketsOf(c, b.id)).toEqual([]); // not paid yet
    await c.owner.call('get', `/tenants/${c.tenantId}/bookings/${b.id}/tickets.pdf`).expect(409);
    await c.owner.call('get', `/tenants/${c.tenantId}/bookings/${b.id}/receipt.pdf`).expect(409);

    await bookings.markPaid(c.tenantId, b.id);
    const t = await ticketsOf(c, b.id);
    expect(t.map((x) => x.seat)).toEqual(['1', '2']);
    expect(new Set(t.map((x) => x.code)).size).toBe(2);
    expect(t[0]).toMatchObject({ status: 'ISSUED' });
    expect(t[0]!.code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    expect(t[0]!.token).toMatch(/^t1\.[0-9a-f-]{36}\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{22}$/);
    // Idempotent: confirming or listing again creates nothing new.
    await bookings.markPaid(c.tenantId, b.id);
    expect((await ticketsOf(c, b.id)).map((x) => x.id)).toEqual(t.map((x) => x.id));
    expect(await plat((tx) => tx.ticket.count({ where: { bookingId: b.id } }))).toBe(2);

    // A booking confirmed by some older path without tickets heals on first view.
    const old = await bookFor(c, c.soon.id, ['3']);
    await plat((tx) => tx.booking.update({ where: { id: old.id }, data: { status: 'CONFIRMED' } }));
    expect(await ticketsOf(c, old.id)).toHaveLength(1);
  }, 400_000);

  it('serves ticket and receipt PDFs to permitted staff only', async () => {
    const c = await kit('tk-pdf');
    const other = await company('tk-pdf-other');
    const b = await confirmed(c, c.soon.id, ['1', '2']);
    const pdf = await c.owner
      .call('get', `/tenants/${c.tenantId}/bookings/${b.id}/tickets.pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (d: Buffer) => chunks.push(d));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(
      /attachment; filename="tickets-[A-Z0-9]+\.pdf"/,
    );
    expect(pdf.headers['cache-control']).toMatch(/no-store/);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((pdf.body as Buffer).length).toBeGreaterThan(3000); // includes QR images
    await c.owner.call('get', `/tenants/${c.tenantId}/bookings/${b.id}/receipt.pdf`).expect(200);

    await other.owner
      .call('get', `/tenants/${other.tenantId}/bookings/${b.id}/tickets`)
      .expect(404);
    await other.owner
      .call('get', `/tenants/${other.tenantId}/bookings/${b.id}/tickets.pdf`)
      .expect(404);
    await other.owner.call('get', `/tenants/${c.tenantId}/bookings/${b.id}/tickets`).expect(404);
    const driver = await member(c.tenantId, 'driver'); // no booking.read
    await driver.call('get', `/tenants/${c.tenantId}/bookings/${b.id}/tickets`).expect(403);
    await driver.call('get', `/tenants/${c.tenantId}/bookings/${b.id}/receipt.pdf`).expect(403);
  }, 400_000);

  it('boards each ticket exactly once, by QR token or typed code, and audits every outcome', async () => {
    const c = await kit('tk-board');
    const driver = await member(c.tenantId, 'driver');
    const b = await confirmed(c, c.soon.id, ['1', '2', '3']);
    const [t1, t2, t3] = await ticketsOf(c, b.id);

    const ok = await scan(driver, c.tenantId, { token: t1!.token, tripId: c.soon.id }).expect(200);
    expect(ok.body).toMatchObject({ ok: true, ticket: { seat: '1', passengerName: 'Rider 1' } });
    const again = await scan(driver, c.tenantId, { token: t1!.token }).expect(409);
    expect(again.body.error.details.reason).toBe('ALREADY_BOARDED');
    expect(again.body.error.details.boardedAt).toBeTruthy();

    // A typed code works in any case and with or without the dash.
    await scan(driver, c.tenantId, { code: t2!.code.toLowerCase().replace('-', ' ') }).expect(200);
    expect(
      (await scan(driver, c.tenantId, { code: t2!.code }).expect(409)).body.error.details.reason,
    ).toBe('ALREADY_BOARDED');

    // Two scanners reading the same ticket at the same instant: only one boards it.
    const race = await Promise.all(
      Array.from({ length: 4 }, () => scan(driver, c.tenantId, { token: t3!.token })),
    );
    expect(race.filter((r) => r.status === 200)).toHaveLength(1);
    expect(
      race
        .filter((r) => r.status === 409)
        .every((r) => r.body.error.details.reason === 'ALREADY_BOARDED'),
    ).toBe(true);

    const m = (
      await driver.call('get', `/tenants/${c.tenantId}/trips/${c.soon.id}/manifest`).expect(200)
    ).body;
    expect(m.counts).toEqual({ total: 3, boarded: 3 });
    expect(m.passengers.map((p: { seat: string }) => p.seat)).toEqual(['1', '2', '3']);
    expect(m.passengers.every((p: { boardedAt: string | null }) => p.boardedAt)).toBe(true);

    const actions = await withDb(db, { tenantId: c.tenantId }, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: c.tenantId, action: { in: ['ticket.boarded', 'ticket.scan_rejected'] } },
      }),
    );
    expect(actions.filter((a) => a.action === 'ticket.boarded')).toHaveLength(3);
    expect(
      actions.filter((a) => a.action === 'ticket.scan_rejected').length,
    ).toBeGreaterThanOrEqual(3);
    const row = await plat((tx) => tx.ticket.findFirstOrThrow({ where: { id: t1!.id } }));
    expect(row).toMatchObject({ status: 'BOARDED', boardedByUserId: driver.userId });
  }, 400_000);

  it('refuses forged, foreign, early, wrong-trip and cancelled tickets', async () => {
    const c = await kit('tk-refuse');
    const other = await kit('tk-refuse-other');
    const driver = await member(c.tenantId, 'driver');
    const otherDriver = await member(other.tenantId, 'driver');
    const b = await confirmed(c, c.soon.id, ['1', '2']);
    const [t1, t2] = await ticketsOf(c, b.id);
    const reason = (r: { body: { error: { details: { reason: string } } } }) =>
      r.body.error.details.reason;

    // Edited signature, edited ids, another company's key material, garbage.
    const parts = t1!.token.split('.');
    const bad = [...parts.slice(0, 3), parts[3]!.slice(0, -2) + 'AA'].join('.');
    expect(reason(await scan(driver, c.tenantId, { token: bad }).expect(409))).toBe('INVALID_CODE');
    expect(
      reason(await scan(driver, c.tenantId, { token: 'not-a-ticket-at-all' }).expect(409)),
    ).toBe('INVALID_CODE');
    expect(reason(await scan(driver, c.tenantId, { code: 'ZZZZZZZZZZ' }).expect(409))).toBe(
      'NOT_FOUND',
    );
    // A genuine ticket presented to a different company's scanner is rejected without detail.
    expect(reason(await scan(otherDriver, other.tenantId, { token: t1!.token }).expect(409))).toBe(
      'INVALID_CODE',
    );
    expect(reason(await scan(otherDriver, other.tenantId, { code: t1!.code }).expect(409))).toBe(
      'NOT_FOUND',
    );
    await scan(otherDriver, c.tenantId, { token: t1!.token }).expect(404); // not a member of that company
    // Wrong trip selected on the scanner.
    expect(
      reason(await scan(driver, c.tenantId, { token: t1!.token, tripId: c.far.id }).expect(409)),
    ).toBe('WRONG_TRIP');

    // Too early: a ticket for the trip five days away.
    const far = await confirmed(c, c.far.id, ['1']);
    const [tf] = await ticketsOf(c, far.id);
    expect(reason(await scan(driver, c.tenantId, { token: tf!.token }).expect(409))).toBe(
      'TOO_EARLY',
    );

    // Cancelled booking: ticket void.
    await c.owner
      .call('post', `/tenants/${c.tenantId}/bookings/${b.id}/cancel`)
      .send({ reason: 'customer request' })
      .expect(200);
    expect(reason(await scan(driver, c.tenantId, { token: t2!.token }).expect(409))).toBe('VOID');
    expect((await plat((tx) => tx.ticket.findFirstOrThrow({ where: { id: t2!.id } }))).status).toBe(
      'VOID',
    );
    // Void tickets disappear from the manifest and from the passenger's list.
    expect(
      (await driver.call('get', `/tenants/${c.tenantId}/trips/${c.soon.id}/manifest`).expect(200))
        .body.counts.total,
    ).toBe(0);
    expect(await ticketsOf(c, b.id)).toEqual([]);

    // A cancelled trip voids everything on it.
    const far2 = await confirmed(c, c.far.id, ['2']);
    const [tf2] = await ticketsOf(c, far2.id);
    await c.owner
      .call('post', `/tenants/${c.tenantId}/trips/${c.far.id}/status`)
      .send({ status: 'CANCELLED' })
      .expect(204);
    expect(reason(await scan(driver, c.tenantId, { token: tf2!.token }).expect(409))).toBe('VOID');
  }, 900_000);

  it('validates scan input and limits who can scan', async () => {
    const c = await kit('tk-perm');
    const b = await confirmed(c, c.soon.id, ['1']);
    const [t] = await ticketsOf(c, b.id);
    const driver = await member(c.tenantId, 'driver');
    const agent = await member(c.tenantId, 'sales_agent');
    await scan(driver, c.tenantId, {}).expect(400);
    await scan(driver, c.tenantId, { token: t!.token, code: t!.code }).expect(400);
    await scan(driver, c.tenantId, { token: t!.token, extra: 1 }).expect(400);
    await scan(driver, c.tenantId, { code: t!.code, tripId: 'nope' }).expect(400);
    await scan(agent, c.tenantId, { token: t!.token }).expect(403);
    await agent.call('get', `/tenants/${c.tenantId}/trips/${c.soon.id}/manifest`).expect(403);
    await driver
      .call(
        'get',
        `/tenants/${c.tenantId}/trips/${'00000000-0000-4000-8000-000000000000'}/manifest`,
      )
      .expect(404);
    // The ticket is still unused after all that.
    expect((await ticketsOf(c, b.id))[0]!.status).toBe('ISSUED');
    await scan(c.owner, c.tenantId, { token: t!.token }).expect(200);
  }, 900_000);

  it('lets a passenger see only their own tickets and documents', async () => {
    const c = await kit('tk-pax');
    await c.owner
      .call('put', `/tenants/${c.tenantId}/payment-settings`)
      .send({ spaceId: 'spc-tk1', apiToken: 'mon_test_abcdefghij123456' })
      .expect(200);
    const a = await newClient(ctx.app, db, 'tkpa');
    const o = await newClient(ctx.app, db, 'tkpb');
    const made = await a
      .call('post', '/passenger/bookings')
      .send({
        tenantId: c.tenantId,
        tripId: c.soon.id,
        contact: { name: 'Mariama Conteh', phone: '+23277333444' },
        passengers: [{ fullName: 'Mariama Conteh', seatLabel: '4' }],
      })
      .expect(201);
    await a.call('get', `/passenger/bookings/${made.body.id}/tickets.pdf`).expect(409); // unpaid
    expect(
      (await a.call('get', `/passenger/bookings/${made.body.id}/tickets`).expect(200)).body.tickets,
    ).toEqual([]);

    await bookings.markPaid(c.tenantId, made.body.id);
    const mine = (await a.call('get', `/passenger/bookings/${made.body.id}/tickets`).expect(200))
      .body.tickets;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ seat: '4', passengerName: 'Mariama Conteh', status: 'ISSUED' });
    await a.call('get', `/passenger/bookings/${made.body.id}/tickets.pdf`).expect(200);
    await a.call('get', `/passenger/bookings/${made.body.id}/receipt.pdf`).expect(200);
    for (const path of ['tickets', 'tickets.pdf', 'receipt.pdf']) {
      await o.call('get', `/passenger/bookings/${made.body.id}/${path}`).expect(404);
    }
    // The passenger's own token is accepted by the company's scanner (the trip is boarding soon).
    const driver = await member(c.tenantId, 'driver');
    await scan(driver, c.tenantId, { token: mine[0].token }).expect(200);
  }, 400_000);
});
