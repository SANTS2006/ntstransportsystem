import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CheckoutCreated,
  type CheckoutRequest,
  type CheckoutState,
  type GatewayConfig,
  type PaymentGateway,
} from '../src/modules/payment/gateway.js';
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

class FakeGateway implements PaymentGateway {
  sessions = new Map<string, { req: CheckoutRequest; status: CheckoutState['status'] }>();
  private n = 0;
  async createCheckout(_cfg: GatewayConfig, req: CheckoutRequest): Promise<CheckoutCreated> {
    const sessionId = `ps-${++this.n}-${Math.random().toString(36).slice(2, 8)}`;
    this.sessions.set(sessionId, { req, status: 'pending' });
    return { sessionId, redirectUrl: `https://pay.monime.test/${sessionId}` };
  }
  async getCheckout(_cfg: GatewayConfig, sessionId: string): Promise<CheckoutState> {
    const s = this.sessions.get(sessionId)!;
    return {
      status: s.status,
      reference: s.req.reference,
      totalMinor: s.req.lineItems.reduce((a, l) => a + l.amountMinor * l.quantity, 0),
      currency: s.req.currency,
    };
  }
}

describe.skipIf(!TEST_DB_URL)('passenger search and self-service booking (database)', () => {
  let db: Db;
  let gw: FakeGateway;
  let ctx: ReturnType<typeof makeApp>;

  beforeAll(() => {
    db = createDb(TEST_DB_URL as string);
    gw = new FakeGateway();
    ctx = makeApp(db, { paymentGateway: gw });
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  const plat = <T>(fn: (tx: Tx) => Promise<T>) => withDb(db, { platform: true }, fn);

  const DAY = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
  const city = () => uniq('City').replace(/-/g, '');

  interface Fixture {
    tenantId: string;
    owner: Client;
    from: string;
    to: string;
    trip: { id: string };
    route: { id: string };
    vehicleId: string;
  }
  /** A company that can sell online: payments configured, published route, fare, vehicle, trip. */
  async function seller(
    label: string,
    o: {
      payments?: boolean | 'disabled';
      routeStatus?: 'PUBLISHED' | 'DRAFT';
      vehicle?: boolean;
      tripStatus?: 'SCHEDULED' | 'CANCELLED';
      past?: boolean;
    } = {},
  ): Promise<Fixture> {
    const t = await createTenantWithOwner(db, label);
    const tenantId = t.tenant.id;
    const owner = await loginClient(ctx.app, db, t.email, t.password);
    if (o.payments !== false) {
      await owner
        .call('put', `/tenants/${tenantId}/payment-settings`)
        .send({
          spaceId: 'spc-p1',
          apiToken: 'mon_test_abcdefghij123456',
          enabled: o.payments !== 'disabled',
        })
        .expect(200);
    }
    const from = city();
    const to = city();
    const { trip, route, vehicleId } = await plat(async (tx) => {
      const locs = await tx.location.createManyAndReturn({
        data: [
          { tenantId, name: uniq('O'), city: from },
          { tenantId, name: uniq('D'), city: to },
        ],
      });
      const route = await tx.route.create({
        data: {
          tenantId,
          name: uniq('R'),
          originId: locs[0]!.id,
          destinationId: locs[1]!.id,
          distanceM: 1000,
          durationMin: 60,
          status: o.routeStatus ?? 'PUBLISHED',
        },
      });
      await tx.fare.create({ data: { tenantId, routeId: route.id, amountMinor: 40_000 } });
      const v = await tx.vehicle.create({
        data: { tenantId, registration: uniq('PX').toUpperCase(), seatingCapacity: 5, type: 'BUS' },
      });
      const dep = o.past ? new Date(Date.now() - 3_600_000) : new Date(`${DAY}T09:00:00.000Z`);
      const trip = await tx.trip.create({
        data: {
          tenantId,
          routeId: route.id,
          serviceDate: new Date(`${DAY}T00:00:00.000Z`),
          departureAt: dep,
          arrivalAt: new Date(dep.getTime() + 3_600_000),
          vehicleId: o.vehicle === false ? null : v.id,
          status: o.tripStatus ?? 'SCHEDULED',
        },
      });
      return { trip, route, vehicleId: v.id };
    });
    return { tenantId, owner, from, to, trip, route, vehicleId };
  }

  const search = (q: string) => request(ctx.app).get(`/api/v1/public/trips?${q}`);
  const body = (f: Fixture, seats: string[], extra: Record<string, unknown> = {}) => ({
    tenantId: f.tenantId,
    tripId: f.trip.id,
    contact: { name: 'Fatmata Sesay', phone: '+23278111222' },
    passengers: seats.map((s, i) => ({ fullName: `Rider ${i + 1}`, seatLabel: s })),
    ...extra,
  });
  const bookAs = (p: Client, b: object, key?: string) => {
    const r = p.call('post', '/passenger/bookings');
    if (key) r.set('Idempotency-Key', key);
    return r.send(b);
  };

  it('lists only trips that can really be bought online, without signing in', async () => {
    const ok = await seller('srch-ok');
    // Same cities, but each of these must NOT appear:
    const none = await seller('srch-nopay', { payments: false });
    const off = await seller('srch-off', { payments: 'disabled' });
    const draft = await seller('srch-draft', { routeStatus: 'DRAFT' });
    const noVeh = await seller('srch-noveh', { vehicle: false });
    const cancelled = await seller('srch-cancel', { tripStatus: 'CANCELLED' });
    const past = await seller('srch-past', { past: true });
    for (const f of [none, off, draft, noVeh, cancelled, past]) {
      const r = await search(`date=${DAY}&from=${f.from}&to=${f.to}`).expect(200);
      expect(r.body.trips).toEqual([]);
    }
    const r = await search(
      `date=${DAY}&from=${ok.from.toLowerCase()}&to=${ok.to.slice(0, 8)}`,
    ).expect(200);
    expect(r.body.trips).toHaveLength(1);
    expect(r.body.trips[0]).toMatchObject({
      tripId: ok.trip.id,
      tenantId: ok.tenantId,
      fareMinor: 40_000,
      currency: 'SLE',
      seatsLeft: 5,
    });
    expect(JSON.stringify(r.body)).not.toMatch(/spc-p1|mon_test|token|secret|email|phone/i);
    await search(`date=${DAY}&from=NoSuchCityAnywhere`).expect(200);
    await search(`from=${ok.from}`).expect(400); // date is required
    await search(`date=2026-13-45`).expect(400);

    // A suspended company disappears at once.
    await plat((tx) =>
      tx.tenant.update({ where: { id: ok.tenantId }, data: { status: 'SUSPENDED' } }),
    );
    expect((await search(`date=${DAY}&from=${ok.from}`).expect(200)).body.trips).toEqual([]);
  }, 400_000);

  it('books as a passenger, holds seats, replays retries and rejects abuse', async () => {
    const f = await seller('book');
    const p1 = await newClient(ctx.app, db, 'rider1');
    const p2 = await newClient(ctx.app, db, 'rider2');
    await request(ctx.app)
      .post('/api/v1/passenger/bookings')
      .send(body(f, ['1']))
      .expect(401);

    const first = await bookAs(p1, body(f, ['1', '2']), 'pax-key-0001').expect(201);
    expect(first.body).toMatchObject({ status: 'PENDING_PAYMENT', totalMinor: 80_000 });
    const replay = await bookAs(p1, body(f, ['1', '2']), 'pax-key-0001').expect(200);
    expect(replay.body.id).toBe(first.body.id);

    await bookAs(p2, body(f, ['2'])).expect(409); // seat held by rider1
    const detail = await request(ctx.app)
      .get(`/api/v1/public/trips/${f.tenantId}/${f.trip.id}`)
      .expect(200);
    expect(detail.body.seats.filter((s: { status: string }) => s.status === 'TAKEN')).toHaveLength(
      2,
    );
    expect((await search(`date=${DAY}&from=${f.from}`).expect(200)).body.trips[0].seatsLeft).toBe(
      3,
    );

    // A trip id from one company paired with another company's id is not found.
    const other = await seller('book-other');
    await bookAs(p2, { ...body(f, ['3']), tenantId: other.tenantId }).expect(404);
    await bookAs(p2, body(f, ['3'], { total: 1 })).expect(400);
    await bookAs(p2, body(f, ['99'])).expect(400);

    // Cap on unpaid bookings per account.
    await bookAs(p2, body(f, ['3'])).expect(201);
    await bookAs(p2, body(f, ['4'])).expect(201);
    await bookAs(p2, body(f, ['5'])).expect(201);
    const f2 = await seller('book-cap');
    await bookAs(p2, body(f2, ['1'])).expect(409);
    await request(ctx.app).get(`/api/v1/public/trips/${f.tenantId}/not-a-uuid`).expect(404);
  }, 400_000);

  it('shows passengers only their own bookings and keeps staff routes closed to them', async () => {
    const f = await seller('own');
    const a = await newClient(ctx.app, db, 'pa');
    const b = await newClient(ctx.app, db, 'pb');
    const made = await bookAs(a, body(f, ['1'])).expect(201);
    const mine = await a.call('get', '/passenger/bookings').expect(200);
    expect(mine.body.bookings.map((x: { id: string }) => x.id)).toEqual([made.body.id]);
    expect(mine.body.bookings[0]).toMatchObject({
      company: 'own',
      route: expect.any(String),
      origin: { city: f.from },
    });
    expect((await b.call('get', '/passenger/bookings').expect(200)).body.bookings).toEqual([]);
    await b.call('get', `/passenger/bookings/${made.body.id}`).expect(404);
    await b.call('get', `/passenger/bookings/${made.body.id}/status`).expect(404);
    await b.call('post', `/passenger/bookings/${made.body.id}/pay`).expect(404);
    await b.call('post', `/passenger/bookings/${made.body.id}/cancel`).expect(404);
    // A passenger is not company staff.
    await a.call('get', `/tenants/${f.tenantId}/bookings`).expect(404);
    await a.call('get', `/tenants/${f.tenantId}/payment-settings`).expect(404);
    await a.call('post', `/tenants/${f.tenantId}/bookings/${made.body.id}/payments`).expect(404);
    // The company sees it in its own list, created by the passenger.
    const staff = await f.owner.call('get', `/tenants/${f.tenantId}/bookings`).expect(200);
    expect(staff.body.bookings).toHaveLength(1);
  }, 400_000);

  it('pays through hosted checkout and confirms only after the provider says so', async () => {
    const f = await seller('pay');
    const p = await newClient(ctx.app, db, 'payer');
    const made = await bookAs(p, body(f, ['1', '2'])).expect(201);

    const started = await p.call('post', `/passenger/bookings/${made.body.id}/pay`).expect(201);
    expect(started.body.redirectUrl).toMatch(/^https:\/\/pay\.monime\.test\//);
    const sessionId = (started.body.redirectUrl as string).split('/').pop()!;

    // Coming back from checkout proves nothing: the provider has not completed it.
    const early = await p.call('get', `/passenger/bookings/${made.body.id}/status`).expect(200);
    expect(early.body.status).toBe('PENDING_PAYMENT');
    expect(early.body.paymentStatus).toBe('PENDING');

    gw.sessions.get(sessionId)!.status = 'completed';
    const done = await p.call('get', `/passenger/bookings/${made.body.id}/status`).expect(200);
    expect(done.body.status).toBe('CONFIRMED');
    expect(done.body.paymentStatus).toBe('PAID');
    expect(done.body.holdExpiresAt).toBeNull();

    // A confirmed (paid) booking cannot be cancelled online and is not payable again.
    await p.call('post', `/passenger/bookings/${made.body.id}/cancel`).expect(409);
    await p.call('post', `/passenger/bookings/${made.body.id}/pay`).expect(409);
  }, 400_000);

  it('lets a passenger cancel an unpaid booking and frees the seats', async () => {
    const f = await seller('cancel');
    const p = await newClient(ctx.app, db, 'canceller');
    const q = await newClient(ctx.app, db, 'taker');
    const made = await bookAs(p, body(f, ['1'])).expect(201);
    await bookAs(q, body(f, ['1'])).expect(409);
    await p.call('post', `/passenger/bookings/${made.body.id}/cancel`).expect(204);
    expect(
      (await p.call('get', `/passenger/bookings/${made.body.id}`).expect(200)).body.status,
    ).toBe('CANCELLED');
    await bookAs(q, body(f, ['1'])).expect(201);
  }, 400_000);
});
