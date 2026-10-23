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

describe.skipIf(!TEST_DB_URL)('fares, bookings and seat inventory (database)', () => {
  let db: Db;
  let ctx: ReturnType<typeof makeApp>;
  let svc: BookingService;

  beforeAll(() => {
    db = createDb(TEST_DB_URL as string);
    ctx = makeApp(db);
    svc = new BookingService(db);
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

  /** Route with a fare, a 6-seat vehicle and one future trip, inserted directly. */
  async function kit(tenantId: string, over: { fare?: number; vehicle?: boolean } = {}) {
    return plat(async (tx) => {
      const locs = await tx.location.createManyAndReturn({
        data: [uniq('O'), uniq('D')].map((name) => ({ tenantId, name, city: name })),
      });
      const route = await tx.route.create({
        data: {
          tenantId,
          name: uniq('R'),
          originId: locs[0]!.id,
          destinationId: locs[1]!.id,
          distanceM: 100_000,
          durationMin: 120,
          status: 'PUBLISHED',
        },
      });
      if (over.fare !== 0) {
        await tx.fare.create({
          data: { tenantId, routeId: route.id, amountMinor: over.fare ?? 50_000 },
        });
      }
      const vehicle = await tx.vehicle.create({
        data: { tenantId, registration: uniq('BK').toUpperCase(), seatingCapacity: 6, type: 'BUS' },
      });
      const day = new Date(Date.now() + 5 * 86_400_000);
      const date = day.toISOString().slice(0, 10);
      const dep = new Date(`${date}T08:00:00.000Z`);
      const trip = await tx.trip.create({
        data: {
          tenantId,
          routeId: route.id,
          serviceDate: new Date(date),
          departureAt: dep,
          arrivalAt: new Date(dep.getTime() + 2 * 3_600_000),
          vehicleId: over.vehicle === false ? null : vehicle.id,
        },
      });
      return { route, vehicle, trip };
    });
  }

  const body = (tripId: string, seats: string[], extra: Record<string, unknown> = {}) => ({
    tripId,
    contact: { name: 'Aminata Kamara', phone: '+23277123456' },
    passengers: seats.map((s, i) => ({ fullName: `Passenger ${i + 1}`, seatLabel: s })),
    ...extra,
  });
  const book = (owner: Client, tenantId: string, b: object, key?: string) => {
    const r = owner.call('post', `/tenants/${tenantId}/bookings`);
    if (key) r.set('Idempotency-Key', key);
    return r.send(b);
  };

  it('manages fares with validation and permissions, and isolates tenants', async () => {
    const a = await company('fares-a');
    const b = await company('fares-b');
    const fx = await kit(a.tenantId, { fare: 0 });
    const url = `/tenants/${a.tenantId}/routes/${fx.route.id}/fares/STANDARD`;
    await a.owner.call('put', url).send({ amountMinor: -1 }).expect(400);
    await a.owner.call('put', url).send({ amountMinor: 1.5 }).expect(400);
    await a.owner.call('put', url).send({ amountMinor: 100, currency: 'sle' }).expect(400);
    await a.owner.call('put', url).send({ amountMinor: 100, extra: 1 }).expect(400);
    await a.owner.call('put', url).send({ amountMinor: 75_000 }).expect(204);
    await a.owner.call('put', url).send({ amountMinor: 80_000 }).expect(204);
    const list = await a.owner
      .call('get', `/tenants/${a.tenantId}/routes/${fx.route.id}/fares`)
      .expect(200);
    expect(list.body.fares).toEqual([
      { serviceClass: 'STANDARD', amountMinor: 80_000, currency: 'SLE', active: true },
    ]);
    const agent = await member(a.tenantId, 'sales_agent');
    await agent.call('put', url).send({ amountMinor: 1 }).expect(403);
    await agent.call('get', `/tenants/${a.tenantId}/routes/${fx.route.id}/fares`).expect(200);
    await b.owner.call('get', `/tenants/${b.tenantId}/routes/${fx.route.id}/fares`).expect(404);
    await b.owner
      .call('put', `/tenants/${b.tenantId}/routes/${fx.route.id}/fares/STANDARD`)
      .send({ amountMinor: 1 })
      .expect(404);
  }, 300_000);

  it('creates a booking with a price snapshot, holds seats and lists it', async () => {
    const { tenantId, owner } = await company('create');
    const fx = await kit(tenantId);
    const res = await book(owner, tenantId, body(fx.trip.id, ['1', '2'])).expect(201);
    expect(res.body).toMatchObject({
      status: 'PENDING_PAYMENT',
      totalMinor: 100_000,
      currency: 'SLE',
    });
    expect(res.body.reference).toMatch(/^[0-9A-Z]{10}$/);
    expect(new Date(res.body.holdExpiresAt).getTime()).toBeGreaterThan(Date.now());

    await owner
      .call('put', `/tenants/${tenantId}/routes/${fx.route.id}/fares/STANDARD`)
      .send({ amountMinor: 99_000 })
      .expect(204);
    const got = await owner.call('get', `/tenants/${tenantId}/bookings/${res.body.id}`).expect(200);
    expect(got.body.totalMinor).toBe(100_000);
    expect(got.body.history).toHaveLength(1);
    expect(got.body.history[0]).toMatchObject({ from: null, to: 'PENDING_PAYMENT' });

    const map = await owner
      .call('get', `/tenants/${tenantId}/trips/${fx.trip.id}/seats`)
      .expect(200);
    expect(map.body.sellable).toBe(true);
    const taken = map.body.seats
      .filter((s: { status: string }) => s.status === 'TAKEN')
      .map((s: { label: string }) => s.label);
    expect(taken).toEqual(['1', '2']);
    expect(map.body.seats).toHaveLength(6);

    const found = await owner
      .call('get', `/tenants/${tenantId}/bookings?q=${res.body.reference.toLowerCase()}`)
      .expect(200);
    expect(found.body.bookings).toHaveLength(1);
    await owner.call('get', `/tenants/${tenantId}/bookings?status=BOGUS`).expect(400);
  }, 300_000);

  it('rejects invalid bookings', async () => {
    const { tenantId, owner } = await company('invalid');
    const fx = await kit(tenantId);
    await book(owner, tenantId, body(fx.trip.id, ['1', '1'])).expect(400);
    await book(owner, tenantId, body(fx.trip.id, ['99'])).expect(400);
    await book(owner, tenantId, body(fx.trip.id, [])).expect(400);
    await book(owner, tenantId, body(fx.trip.id, ['1'], { total: 1 })).expect(400);
    await book(
      owner,
      tenantId,
      body(fx.trip.id, ['1'], { contact: { name: 'A', phone: 'abc' } }),
    ).expect(400);
    await book(owner, tenantId, body('00000000-0000-4000-8000-000000000000', ['1'])).expect(400);
    await book(owner, tenantId, body(fx.trip.id, ['1'], { serviceClass: 'VIP' })).expect(409);
    const noVeh = await kit(tenantId, { vehicle: false });
    await book(owner, tenantId, body(noVeh.trip.id, ['1'])).expect(409);
    const noFare = await kit(tenantId, { fare: 0 });
    await book(owner, tenantId, body(noFare.trip.id, ['1'])).expect(409);
    await plat((tx) =>
      tx.trip.update({ where: { id: fx.trip.id }, data: { status: 'CANCELLED' } }),
    );
    await book(owner, tenantId, body(fx.trip.id, ['1'])).expect(409);
  }, 300_000);

  it('never double-sells a seat under concurrency', async () => {
    const { tenantId, owner } = await company('race');
    const fx = await kit(tenantId);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        book(
          owner,
          tenantId,
          body(fx.trip.id, ['3'], { contact: { name: `Buyer ${i}`, phone: '+23277000000' } }),
        ),
      ),
    );
    const codes = results.map((r) => r.status);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(5);
    const live = await plat((tx) =>
      tx.bookingPassenger.count({
        where: { tripId: fx.trip.id, seatLabel: '3', releasedAt: null },
      }),
    );
    expect(live).toBe(1);
    const mixed = await Promise.all([
      book(owner, tenantId, body(fx.trip.id, ['4', '5'])),
      book(owner, tenantId, body(fx.trip.id, ['5', '6'])),
    ]);
    expect(mixed.map((r) => r.status).sort()).toEqual([201, 409]);
    const per = await plat((tx) =>
      tx.bookingPassenger.groupBy({
        by: ['seatLabel'],
        where: { tripId: fx.trip.id, releasedAt: null },
        _count: true,
      }),
    );
    expect(per.every((p) => p._count === 1)).toBe(true);
  }, 300_000);

  it('honours idempotency keys, including concurrent retries', async () => {
    const { tenantId, owner } = await company('idem');
    const fx = await kit(tenantId);
    const first = await book(owner, tenantId, body(fx.trip.id, ['1']), 'key-0001-abcd').expect(201);
    const again = await book(owner, tenantId, body(fx.trip.id, ['1']), 'key-0001-abcd').expect(200);
    expect(again.body.id).toBe(first.body.id);
    await book(owner, tenantId, body(fx.trip.id, ['2']), 'key-0001-abcd').expect(409);
    await book(owner, tenantId, body(fx.trip.id, ['2']), 'x').expect(400);
    const par = await Promise.all(
      Array.from({ length: 4 }, () =>
        book(owner, tenantId, body(fx.trip.id, ['6']), 'key-0002-abcd'),
      ),
    );
    expect(new Set(par.map((r) => r.body.id)).size).toBe(1);
    expect(par.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      await plat((tx) =>
        tx.booking.count({ where: { tenantId, idempotencyKey: 'key-0002-abcd' } }),
      ),
    ).toBe(1);
  }, 300_000);

  it('expires unpaid holds, frees the seats and records history', async () => {
    const { tenantId, owner } = await company('expiry');
    const fx = await kit(tenantId);
    const old = await book(owner, tenantId, body(fx.trip.id, ['1'])).expect(201);
    const old2 = await book(owner, tenantId, body(fx.trip.id, ['2'])).expect(201);
    await plat((tx) =>
      tx.booking.updateMany({
        where: { id: { in: [old.body.id, old2.body.id] } },
        data: { holdExpiresAt: new Date(Date.now() - 1000) },
      }),
    );
    const map = await owner
      .call('get', `/tenants/${tenantId}/trips/${fx.trip.id}/seats`)
      .expect(200);
    expect(map.body.seats.every((s: { status: string }) => s.status === 'AVAILABLE')).toBe(true);
    await book(owner, tenantId, body(fx.trip.id, ['1'])).expect(201);
    const stale = await owner
      .call('get', `/tenants/${tenantId}/bookings/${old.body.id}`)
      .expect(200);
    expect(stale.body.status).toBe('EXPIRED');
    expect(stale.body.history.map((h: { to: string }) => h.to)).toEqual([
      'PENDING_PAYMENT',
      'EXPIRED',
    ]);
    expect(await svc.expireDue(100, tenantId)).toBeGreaterThanOrEqual(1);
    const swept = await owner
      .call('get', `/tenants/${tenantId}/bookings/${old2.body.id}`)
      .expect(200);
    expect(swept.body.status).toBe('EXPIRED');
    await expect(svc.markPaid(tenantId, old2.body.id)).rejects.toThrow(/expired|cancelled/);
    await expect(
      plat((tx) => tx.bookingStatusHistory.deleteMany({ where: { bookingId: old.body.id } })),
    ).rejects.toThrow();
  }, 300_000);

  it('confirms once paid, cancels with a refund flag, and cancels bookings when a trip is cancelled', async () => {
    const { tenantId, owner } = await company('lifecycle');
    const fx = await kit(tenantId);
    const a = await book(owner, tenantId, body(fx.trip.id, ['1'])).expect(201);
    await svc.markPaid(tenantId, a.body.id);
    await svc.markPaid(tenantId, a.body.id);
    const paid = await owner.call('get', `/tenants/${tenantId}/bookings/${a.body.id}`).expect(200);
    expect(paid.body.status).toBe('CONFIRMED');
    const cancelled = await owner
      .call('post', `/tenants/${tenantId}/bookings/${a.body.id}/cancel`)
      .send({ reason: 'Customer request' })
      .expect(200);
    expect(cancelled.body.refundRequired).toBe(true);
    await owner
      .call('post', `/tenants/${tenantId}/bookings/${a.body.id}/cancel`)
      .send({ reason: 'again' })
      .expect(409);
    await book(owner, tenantId, body(fx.trip.id, ['1'])).expect(201);

    const b = await book(owner, tenantId, body(fx.trip.id, ['2'])).expect(201);
    await svc.markPaid(tenantId, b.body.id);
    const c = await book(owner, tenantId, body(fx.trip.id, ['3'])).expect(201);
    await owner
      .call('post', `/tenants/${tenantId}/trips/${fx.trip.id}/status`)
      .send({ status: 'CANCELLED' })
      .expect(204);
    for (const id of [b.body.id, c.body.id]) {
      const got = await owner.call('get', `/tenants/${tenantId}/bookings/${id}`).expect(200);
      expect(got.body.status).toBe('CANCELLED');
    }
    const events = await plat((tx) =>
      tx.outboxEvent.findMany({ where: { tenantId, type: 'booking.cancelled' } }),
    );
    const refunds = events.filter((e) => (e.payload as { refundRequired: boolean }).refundRequired);
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(refunds.length).toBe(2);
  }, 300_000);

  it('refuses vehicle changes that would strand sold seats', async () => {
    const { tenantId, owner } = await company('strand');
    const fx = await kit(tenantId);
    await book(owner, tenantId, body(fx.trip.id, ['6'])).expect(201);
    const small = await plat((tx) =>
      tx.vehicle.create({
        data: { tenantId, registration: uniq('SM').toUpperCase(), seatingCapacity: 4, type: 'BUS' },
      }),
    );
    const large = await plat((tx) =>
      tx.vehicle.create({
        data: { tenantId, registration: uniq('LG').toUpperCase(), seatingCapacity: 8, type: 'BUS' },
      }),
    );
    const base = `/tenants/${tenantId}/trips/${fx.trip.id}`;
    const r = await owner
      .call('post', `${base}/replace-vehicle`)
      .send({ vehicleId: small.id, reason: 'swap' })
      .expect(409);
    expect(r.body.error.message).toMatch(/Seats 6/);
    await owner.call('post', `${base}/vehicle`).send({ vehicleId: null }).expect(409);
    await owner
      .call('post', `${base}/replace-vehicle`)
      .send({ vehicleId: large.id, reason: 'bigger bus' })
      .expect(200);
  }, 300_000);

  it('keeps bookings private to their company and to permitted roles', async () => {
    const a = await company('priv-a');
    const b = await company('priv-b');
    const fx = await kit(a.tenantId);
    const made = await book(a.owner, a.tenantId, body(fx.trip.id, ['1'])).expect(201);
    await b.owner.call('get', `/tenants/${b.tenantId}/bookings/${made.body.id}`).expect(404);
    const mine = await b.owner.call('get', `/tenants/${b.tenantId}/bookings`).expect(200);
    expect(mine.body.bookings).toHaveLength(0);
    await b.owner
      .call('post', `/tenants/${b.tenantId}/bookings/${made.body.id}/cancel`)
      .send({ reason: 'attack' })
      .expect(404);
    await book(b.owner, b.tenantId, body(fx.trip.id, ['2'])).expect(400);
    await b.owner.call('get', `/tenants/${b.tenantId}/trips/${fx.trip.id}/seats`).expect(404);
    await b.owner.call('get', `/tenants/${a.tenantId}/bookings`).expect(404);
    expect(await withDb(db, { tenantId: b.tenantId }, (tx) => tx.booking.count())).toBe(0);

    const driver = await member(a.tenantId, 'driver');
    await driver.call('get', `/tenants/${a.tenantId}/bookings`).expect(403);
    await book(driver, a.tenantId, body(fx.trip.id, ['2'])).expect(403);
    const auditor = await member(a.tenantId, 'auditor');
    await auditor.call('get', `/tenants/${a.tenantId}/bookings`).expect(200);
    await book(auditor, a.tenantId, body(fx.trip.id, ['2'])).expect(403);
    const agent = await member(a.tenantId, 'sales_agent');
    await book(agent, a.tenantId, body(fx.trip.id, ['2'])).expect(201);
  }, 300_000);

  it('takes payment at the desk once, with tickets, history and audit, for permitted roles only', async () => {
    const { tenantId, owner } = await company('desk');
    const other = await company('desk-other');
    const fx = await kit(tenantId);
    const agent = await member(tenantId, 'sales_agent');
    const made = await book(agent, tenantId, body(fx.trip.id, ['1', '2'])).expect(201);
    const url = `/tenants/${tenantId}/bookings/${made.body.id}/desk-payment`;

    // Who may and may not, and what is accepted.
    for (const role of ['driver', 'auditor', 'finance_officer', 'dispatcher']) {
      await (await member(tenantId, role)).call('post', url).send({ method: 'CASH' }).expect(403);
    }
    await other.owner.call('post', url).send({ method: 'CASH' }).expect(404);
    await agent.call('post', url).send({ method: 'BITCOIN' }).expect(400);
    await agent.call('post', url).send({}).expect(400);
    await agent.call('post', url).send({ method: 'CASH', amountMinor: 1 }).expect(400); // the amount is never typed in
    await agent
      .call('post', url)
      .send({ method: 'CASH', reference: 'x'.repeat(81) })
      .expect(400);
    expect(
      (await owner.call('get', `/tenants/${tenantId}/bookings/${made.body.id}`).expect(200)).body
        .status,
    ).toBe('PENDING_PAYMENT'); // nothing above changed anything

    const paid = await agent
      .call('post', url)
      .send({ method: 'CASH', reference: 'RCPT-100' })
      .expect(201);
    expect(paid.body).toMatchObject({
      method: 'CASH',
      amountMinor: 100_000, // two seats at the 500.00 fare, taken from the booking
      currency: 'SLE',
      reference: 'RCPT-100',
    });
    const got = (
      await owner.call('get', `/tenants/${tenantId}/bookings/${made.body.id}`).expect(200)
    ).body;
    expect(got.status).toBe('CONFIRMED');

    const rows = await plat(async (tx) => ({
      payments: await tx.payment.findMany({ where: { bookingId: made.body.id } }),
      tickets: await tx.ticket.count({ where: { bookingId: made.body.id } }),
      history: await tx.bookingStatusHistory.findMany({
        where: { bookingId: made.body.id, toStatus: 'CONFIRMED' },
      }),
      events: await tx.outboxEvent.count({
        where: {
          tenantId,
          type: 'booking.confirmed',
          dedupeKey: `booking.confirmed:${made.body.id}`,
        },
      }),
      audit: await tx.auditLog.findMany({
        where: { tenantId, action: 'payment.collected_at_desk' },
      }),
    }));
    expect(rows.payments).toHaveLength(1);
    expect(rows.payments[0]).toMatchObject({
      provider: 'DESK',
      status: 'PAID',
      method: 'CASH',
      collectedBy: agent.userId,
      amountMinor: 100_000,
    });
    expect(rows.tickets).toBe(2);
    expect(rows.history[0]).toMatchObject({ actorUserId: agent.userId });
    expect(rows.history[0]!.reason).toContain('desk');
    expect(rows.events).toBe(1);
    expect(rows.audit).toHaveLength(1);
    expect(rows.audit[0]).toMatchObject({ actorUserId: agent.userId, outcome: 'SUCCESS' });

    // Only once; a cancelled booking cannot be paid.
    await agent.call('post', url).send({ method: 'CASH' }).expect(409);
    const gone = await book(agent, tenantId, body(fx.trip.id, ['3'])).expect(201);
    await owner
      .call('post', `/tenants/${tenantId}/bookings/${gone.body.id}/cancel`)
      .send({ reason: 'changed mind' })
      .expect(200);
    await agent
      .call('post', `/tenants/${tenantId}/bookings/${gone.body.id}/desk-payment`)
      .send({ method: 'MOBILE_MONEY' })
      .expect(409);

    // Two clerks taking the same payment at the same moment: exactly one wins.
    const race = await book(agent, tenantId, body(fx.trip.id, ['4'])).expect(201);
    const second = await member(tenantId, 'sales_agent');
    const results = await Promise.all(
      [agent, second].map((c) =>
        c
          .call('post', `/tenants/${tenantId}/bookings/${race.body.id}/desk-payment`)
          .send({ method: 'BANK_TRANSFER' }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await plat((tx) => tx.payment.count({ where: { bookingId: race.body.id } }))).toBe(1);

    // The database refuses malformed desk payments and a second one for the same booking.
    const base = {
      tenantId,
      bookingId: race.body.id,
      amountMinor: 1,
      currency: 'SLE',
      status: 'PAID' as const,
    };
    await expect(
      plat((tx) =>
        tx.payment.create({ data: { ...base, provider: 'DESK', idempotencyKey: uniq('k') } }),
      ),
    ).rejects.toThrow(); // no method, no collector
    await expect(
      plat((tx) =>
        tx.payment.create({
          data: {
            ...base,
            provider: 'DESK',
            method: 'CASH',
            collectedBy: agent.userId,
            idempotencyKey: uniq('k'),
          },
        }),
      ),
    ).rejects.toThrow(); // already paid at the desk
    await expect(
      plat((tx) =>
        tx.payment.create({
          data: { ...base, provider: 'MONIME', method: 'CASH', idempotencyKey: uniq('k') },
        }),
      ),
    ).rejects.toThrow(); // online payments carry no desk fields
  }, 600_000);
});
