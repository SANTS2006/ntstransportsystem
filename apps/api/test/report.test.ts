import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BookingService } from '../src/modules/booking/booking.service.js';
import { withDb, type Db, type Tx } from '../src/platform/db.js';
import {
  createDb,
  createTenantWithOwner,
  enrollMfa,
  loginClient,
  makeApp,
  newClient,
  TEST_DB_URL,
  uniq,
  type Client,
} from './helpers.js';

describe.skipIf(!TEST_DB_URL)('company reports (database)', () => {
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

  const TZ = 'Pacific/Kiritimati'; // UTC+14: the local date often differs from the UTC date
  const localDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
  const addDays = (iso: string, n: number) =>
    new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  /** Two routes (one with a formula-like name), 10-seat bus, and trips tomorrow. */
  async function setup(label: string) {
    const t = await createTenantWithOwner(db, label);
    const tenantId = t.tenant.id;
    await plat((tx) => tx.tenant.update({ where: { id: tenantId }, data: { timezone: TZ } }));
    const owner = await loginClient(ctx.app, db, t.email, t.password);
    const fx = await plat(async (tx) => {
      const locs = await tx.location.createManyAndReturn({
        data: [uniq('O'), uniq('D')].map((name) => ({ tenantId, name, city: name })),
      });
      const mkRoute = async (name: string, fare: number) => {
        const r = await tx.route.create({
          data: {
            tenantId,
            name,
            originId: locs[0]!.id,
            destinationId: locs[1]!.id,
            distanceM: 1000,
            durationMin: 60,
            status: 'PUBLISHED',
          },
        });
        await tx.fare.create({ data: { tenantId, routeId: r.id, amountMinor: fare } });
        return r;
      };
      const a = await mkRoute(uniq('Alpha'), 10_000);
      const b = await mkRoute('=HYPERLINK("http://evil.test")', 25_000);
      const v1 = await tx.vehicle.create({
        data: {
          tenantId,
          registration: uniq('RA').toUpperCase(),
          seatingCapacity: 10,
          type: 'BUS',
        },
      });
      const v2 = await tx.vehicle.create({
        data: { tenantId, registration: uniq('RB').toUpperCase(), seatingCapacity: 4, type: 'BUS' },
      });
      const dep = new Date(Date.now() + 86_400_000);
      const mkTrip = (routeId: string, vehicleId: string) =>
        tx.trip.create({
          data: {
            tenantId,
            routeId,
            serviceDate: new Date(dep.toISOString().slice(0, 10)),
            departureAt: dep,
            arrivalAt: new Date(dep.getTime() + 3_600_000),
            vehicleId,
          },
        });
      return { a, b, tripA: await mkTrip(a.id, v1.id), tripB: await mkTrip(b.id, v2.id) };
    });
    const book = async (tripId: string, seats: string[], confirm = true) => {
      const b = (
        await owner
          .call('post', `/tenants/${tenantId}/bookings`)
          .send({
            tripId,
            contact: { name: 'Report Tester', phone: '+23277000222' },
            passengers: seats.map((s, i) => ({ fullName: `P${i}`, seatLabel: s })),
          })
          .expect(201)
      ).body as { id: string };
      if (confirm) await bookings.markPaid(tenantId, b.id);
      return b;
    };
    return { tenantId, owner, ...fx, book };
  }

  const q = (from: string, to: string, extra = '') => `from=${from}&to=${to}${extra}`;
  const base = (id: string) => `/tenants/${id}/reports`;

  it('adds up sales by day and by route, in the company time zone, and flags money that needs a human', async () => {
    const k = await setup('rp-sales');
    await k.book(k.tripA.id, ['1', '2']); // 2 x 100.00
    await k.book(k.tripA.id, ['3']); // 1 x 100.00
    const cancelled = await k.book(k.tripB.id, ['1', '2']); // 2 x 250.00, then cancelled after payment
    await k.book(k.tripB.id, ['3'], false); // unpaid: not a sale
    await k.owner
      .call('post', `/tenants/${k.tenantId}/bookings/${cancelled.id}/cancel`)
      .send({ reason: 'customer request' })
      .expect(200);
    const late = await k.book(k.tripB.id, ['4']);
    await plat(async (tx) => {
      // A payment that arrived after its seats were released.
      await tx.payment.create({
        data: {
          tenantId: k.tenantId,
          bookingId: late.id,
          amountMinor: 25_000,
          currency: 'SLE',
          status: 'PAID_UNFULFILLED',
          paidAt: new Date(),
          idempotencyKey: uniq('k'),
        },
      });
    });

    const today = localDay(new Date());
    const day = (
      await k.owner
        .call('get', `${base(k.tenantId)}/sales?${q(addDays(today, -1), addDays(today, 1))}`)
        .expect(200)
    ).body;
    expect(day.timezone).toBe(TZ);
    expect(day.rows).toEqual([
      { key: today, bookings: 4, seats: 6, revenueMinor: 10_000 * 3 + 25_000 * 2 + 25_000 },
    ]);
    expect(day.totals).toEqual({ bookings: 4, seats: 6, revenueMinor: 105_000 });
    expect(day.cancelledAfterPayment).toEqual({ count: 1, amountMinor: 50_000 });
    expect(day.refundsOwed).toEqual({ count: 1, amountMinor: 25_000 });

    // A range that does not include today finds nothing.
    const none = (
      await k.owner
        .call('get', `${base(k.tenantId)}/sales?${q(addDays(today, 3), addDays(today, 5))}`)
        .expect(200)
    ).body;
    expect(none.rows).toEqual([]);
    expect(none.totals).toEqual({ bookings: 0, seats: 0, revenueMinor: 0 });

    const route = (
      await k.owner
        .call('get', `${base(k.tenantId)}/sales?${q(today, today, '&by=route')}`)
        .expect(200)
    ).body;
    expect(route.rows.map((r: { key: string }) => r.key).sort()).toEqual(
      [k.a.name, k.b.name].sort(),
    );
    const byName = Object.fromEntries(
      route.rows.map((r: { key: string; seats: number; revenueMinor: number }) => [r.key, r]),
    );
    expect(byName[k.a.name]).toMatchObject({ bookings: 2, seats: 3, revenueMinor: 30_000 });
  }, 600_000);

  it('reports occupancy per trip with capacity, seats sold, boarded and revenue', async () => {
    const k = await setup('rp-occ');
    await k.book(k.tripA.id, ['1', '2', '3']); // 3 of 10
    await k.book(k.tripB.id, ['1', '2']); // 2 of 4
    await k.book(k.tripB.id, ['3'], false); // held, not sold
    await plat(async (tx) => {
      const ticket = await tx.ticket.findFirstOrThrow({ where: { tripId: k.tripA.id } });
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { status: 'BOARDED', boardedAt: new Date() },
      });
    });
    const today = localDay(new Date());
    const r = (
      await k.owner
        .call('get', `${base(k.tenantId)}/occupancy?${q(addDays(today, -1), addDays(today, 2))}`)
        .expect(200)
    ).body;
    const a = r.trips.find((t: { tripId: string }) => t.tripId === k.tripA.id);
    const b = r.trips.find((t: { tripId: string }) => t.tripId === k.tripB.id);
    expect(a).toMatchObject({
      capacity: 10,
      sold: 3,
      boarded: 1,
      occupancyPct: 30,
      revenueMinor: 30_000,
    });
    expect(b).toMatchObject({
      capacity: 4,
      sold: 2,
      boarded: 0,
      occupancyPct: 50,
      revenueMinor: 50_000,
    });
    expect(r.totals).toMatchObject({
      trips: 2,
      capacity: 14,
      sold: 5,
      boarded: 1,
      revenueMinor: 80_000,
      occupancyPct: 35.7,
    });
    expect(r.truncated).toBe(false);

    // A cancelled trip is not part of the report.
    await k.owner
      .call('post', `/tenants/${k.tenantId}/trips/${k.tripB.id}/status`)
      .send({ status: 'CANCELLED' })
      .expect(204);
    const after = (
      await k.owner
        .call('get', `${base(k.tenantId)}/occupancy?${q(addDays(today, -1), addDays(today, 2))}`)
        .expect(200)
    ).body;
    expect(after.trips.map((t: { tripId: string }) => t.tripId)).toEqual([k.tripA.id]);

    const s = (
      await k.owner
        .call('get', `${base(k.tenantId)}/summary?${q(addDays(today, -1), addDays(today, 2))}`)
        .expect(200)
    ).body;
    expect(s).toMatchObject({
      trips: 1,
      seatsSold: 3 + 2,
      boarded: 1,
      complaints: 0,
      averageRating: null,
    });
  }, 600_000);

  it('adds up desk payments by clerk and method, and tracks what was handed back', async () => {
    const k = await setup('cashup');
    const agent = await member(k.tenantId, 'sales_agent');
    const b1 = await k.book(k.tripA.id, ['1', '2'], false); // 2 x 100.00
    const b2 = await k.book(k.tripB.id, ['1'], false); // 250.00
    const b3 = await k.book(k.tripB.id, ['2'], false); // 250.00
    const unpaid = await k.book(k.tripA.id, ['3'], false);
    const desk = (c: Client, id: string, method: string) =>
      c.call('post', `/tenants/${k.tenantId}/bookings/${id}/desk-payment`).send({ method });
    await desk(agent, b1.id, 'CASH').expect(201);
    await desk(agent, b2.id, 'MOBILE_MONEY').expect(201);
    await desk(k.owner, b3.id, 'CASH').expect(201);

    const today = localDay(new Date());
    const range = q(addDays(today, -1), addDays(today, 1));
    type Cashup = {
      byClerk: { userId: string; method: string; payments: number; amountMinor: number }[];
      refunds: { method: string; refunds: number; amountMinor: number }[];
      net: { method: string; collectedMinor: number; refundedMinor: number; netMinor: number }[];
      refundsStillOwed: { count: number; amountMinor: number }[];
    };
    const get = async () =>
      (await k.owner.call('get', `${base(k.tenantId)}/cashup?${range}`).expect(200)).body as Cashup;

    const first = await get();
    const row = (u: string, m: string) =>
      first.byClerk.find((r) => r.userId === u && r.method === m);
    expect(row(agent.userId, 'CASH')).toMatchObject({ payments: 1, amountMinor: 20_000 });
    expect(row(agent.userId, 'MOBILE_MONEY')).toMatchObject({ payments: 1, amountMinor: 25_000 });
    expect(row(k.owner.userId, 'CASH')).toMatchObject({ payments: 1, amountMinor: 25_000 });
    expect(first.byClerk).toHaveLength(3);
    expect(first.net.find((n) => n.method === 'CASH')).toMatchObject({
      collectedMinor: 45_000,
      refundedMinor: 0,
      netMinor: 45_000,
    });
    expect(first.refundsStillOwed).toEqual([]);

    // Cancelling a desk-paid booking leaves money owed to the customer.
    await k.owner
      .call('post', `/tenants/${k.tenantId}/bookings/${b2.id}/cancel`)
      .send({ reason: 'Customer changed plans' })
      .expect(200);
    expect((await get()).refundsStillOwed).toEqual([
      { currency: 'SLE', count: 1, amountMinor: 25_000 },
    ]);
    const listed = (await k.owner.call('get', `/tenants/${k.tenantId}/bookings`).expect(200)).body
      .bookings as { id: string; desk: { method: string; refundedAt: string | null } | null }[];
    expect(listed.find((b) => b.id === b2.id)?.desk).toMatchObject({
      method: 'MOBILE_MONEY',
      refundedAt: null,
    });
    expect(listed.find((b) => b.id === unpaid.id)?.desk).toBeNull();

    // Recording the refund: who, when, how often, and only where it makes sense.
    const refund = (c: Client, id: string) =>
      c
        .call('post', `/tenants/${k.tenantId}/bookings/${id}/desk-refund`)
        .send({ reference: 'R-9' });
    await refund(agent, b2.id).expect(403); // a clerk takes money in, a manager records it going out
    await refund(k.owner, unpaid.id).expect(409); // never paid at the desk
    await refund(k.owner, b1.id).expect(409); // still confirmed: cancel it first
    await k.owner
      .call('post', `/tenants/${k.tenantId}/bookings/${b2.id}/desk-refund`)
      .send({ amountMinor: 1 })
      .expect(400);
    const done = await refund(k.owner, b2.id).expect(200);
    expect(done.body).toMatchObject({
      amountMinor: 25_000,
      method: 'MOBILE_MONEY',
      reference: 'R-9',
    });
    await refund(k.owner, b2.id).expect(409); // only once

    const after = await get();
    expect(after.refunds).toEqual([
      expect.objectContaining({ method: 'MOBILE_MONEY', refunds: 1, amountMinor: 25_000 }),
    ]);
    expect(after.net.find((n) => n.method === 'MOBILE_MONEY')).toMatchObject({
      collectedMinor: 25_000,
      refundedMinor: 25_000,
      netMinor: 0,
    });
    expect(after.refundsStillOwed).toEqual([]);
    const pay = await plat((tx) =>
      tx.payment.findFirstOrThrow({ where: { bookingId: b2.id, provider: 'DESK' } }),
    );
    expect(pay).toMatchObject({ refundedBy: k.owner.userId, refundReference: 'R-9' });
    expect(
      await plat((tx) =>
        tx.auditLog.count({
          where: { tenantId: k.tenantId, action: 'payment.desk_refund_recorded' },
        }),
      ),
    ).toBe(1);

    // Access and shape.
    await agent.call('get', `${base(k.tenantId)}/cashup?${range}`).expect(403);
    await k.owner
      .call('get', `${base(k.tenantId)}/cashup?from=2026-02-01&to=2026-01-01`)
      .expect(400);
    const csv = await k.owner.call('get', `${base(k.tenantId)}/cashup.csv?${range}`).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('(refunds)');
    expect(csv.text).toContain('MOBILE_MONEY');

    // The database refuses a refund on anything but a paid desk payment.
    await expect(
      plat((tx) =>
        tx.payment.updateMany({
          where: { id: pay.id },
          data: { refundedAt: null, refundedBy: k.owner.userId },
        }),
      ),
    ).rejects.toThrow();
  }, 600_000);

  it('exports CSV that spreadsheets cannot turn into formulas', async () => {
    const k = await setup('rp-csv');
    await k.book(k.tripB.id, ['1']); // the route whose name starts with =
    const today = localDay(new Date());
    const res = await k.owner
      .call('get', `${base(k.tenantId)}/sales.csv?${q(today, today, '&by=route')}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (d: Buffer) => chunks.push(d));
        r.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
      })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="sales-route-/);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    const text = res.body as string;
    expect(text.codePointAt(0)).toBe(0xfeff);
    expect(text).toContain('Route,Bookings,Seats,Revenue');
    expect(text).toContain(`'=HYPERLINK`); // neutralised with a leading apostrophe
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(text).toContain(',250.00');
    const occ = await k.owner
      .call('get', `${base(k.tenantId)}/occupancy.csv?${q(today, addDays(today, 1))}`)
      .expect(200);
    expect(occ.headers['content-type']).toMatch(/^text\/csv/);
  }, 600_000);

  it('validates the date range and is restricted to roles with the finance report permission, per company', async () => {
    const k = await setup('rp-perm');
    const other = await setup('rp-perm-other');
    await k.book(k.tripA.id, ['1']);
    const today = localDay(new Date());
    const b = base(k.tenantId);

    await k.owner.call('get', `${b}/sales`).expect(400);
    await k.owner.call('get', `${b}/sales?${q('2026-13-01', today)}`).expect(400);
    await k.owner.call('get', `${b}/sales?${q(today, addDays(today, -1))}`).expect(400); // reversed
    await k.owner.call('get', `${b}/sales?${q(addDays(today, -400), today)}`).expect(400); // over a year
    await k.owner.call('get', `${b}/sales?${q(today, today, '&by=customer')}`).expect(400);
    await k.owner.call('get', `${b}/occupancy?${q(today, addDays(today, 365))}`).expect(200); // exactly 366 days is fine

    const agent = await member(k.tenantId, 'sales_agent');
    const admin = await member(k.tenantId, 'admin'); // admins do not get finance reports by default
    const finance = await member(k.tenantId, 'finance_officer');
    for (const who of [agent, admin])
      await who.call('get', `${b}/sales?${q(today, today)}`).expect(403);
    await finance.call('get', `${b}/sales?${q(today, today)}`).expect(200);
    await agent.call('get', `${b}/sales.csv?${q(today, today)}`).expect(403);

    // Another company sees none of this company's money.
    await other.owner.call('get', `${base(k.tenantId)}/sales?${q(today, today)}`).expect(404);
    const mine = (
      await other.owner.call('get', `${base(other.tenantId)}/sales?${q(today, today)}`).expect(200)
    ).body;
    expect(mine.totals).toEqual({ bookings: 0, seats: 0, revenueMinor: 0 });
  }, 600_000);

  it('gives platform staff platform-wide figures, and nobody else', async () => {
    const support = await newClient(ctx.app, db, 'ov-support');
    await enrollMfa(support);
    await db.platformRoleAssignment.create({ data: { userId: support.userId, role: 'SUPPORT' } });
    const noMfa = await newClient(ctx.app, db, 'ov-nomfa');
    await db.platformRoleAssignment.create({ data: { userId: noMfa.userId, role: 'SUPPORT' } });
    const ordinary = await newClient(ctx.app, db, 'ov-user');

    await ordinary.call('get', '/platform/overview').expect(404);
    await noMfa.call('get', '/platform/overview').expect(403);
    await request(ctx.app).get('/api/v1/platform/overview').expect(401);
    await support.call('get', '/platform/overview?from=2026-02-01&to=2026-01-01').expect(400);
    await support.call('get', '/platform/overview?from=nope&to=2026-01-01').expect(400);

    type Sales = { currency: string; bookings: number; seats: number; revenueMinor: number }[];
    const day = new Date().toISOString().slice(0, 10);
    const range = `from=${day}&to=${day}`;
    const get = async () =>
      (await support.call('get', `/platform/overview?${range}`).expect(200)).body as {
        range: { from: string; to: string };
        tenants: Record<string, number>;
        users: { total: number };
        sales: Sales;
        topCompanies: { name: string }[];
        openComplaints: number;
        outbox: { pending: number; deadLettered: number };
      };
    const before = await get();
    const of = (s: Sales, cur: string) =>
      s.find((r) => r.currency === cur) ?? { bookings: 0, seats: 0, revenueMinor: 0 };

    const k = await setup('ov-co');
    await k.book(k.tripA.id, ['1', '2']); // 2 seats at 100.00
    await k.book(k.tripB.id, ['1']); // 1 seat at 250.00
    await k.book(k.tripB.id, ['2'], false); // held, never paid: not a sale
    const after = await get();
    const cur = (await plat((tx) => tx.tenant.findUniqueOrThrow({ where: { id: k.tenantId } })))
      .defaultCurrency;
    expect(after.range).toEqual({ from: day, to: day });
    expect(of(after.sales, cur).bookings - of(before.sales, cur).bookings).toBe(2);
    expect(of(after.sales, cur).seats - of(before.sales, cur).seats).toBe(3);
    expect(of(after.sales, cur).revenueMinor - of(before.sales, cur).revenueMinor).toBe(45_000);
    expect(after.users.total).toBeGreaterThan(before.users.total);
    expect(after.tenants.ACTIVE).toBeGreaterThanOrEqual(1);
    expect(typeof after.outbox.pending).toBe('number');
    expect(after.topCompanies.length).toBeLessThanOrEqual(10);

    // A range with no sales answers with empty lists, not an error.
    const old = (
      await support.call('get', '/platform/overview?from=2000-01-01&to=2000-01-02').expect(200)
    ).body as { sales: unknown[]; topCompanies: unknown[] };
    expect(old.sales).toEqual([]);
    expect(old.topCompanies).toEqual([]);
  }, 600_000);
});
