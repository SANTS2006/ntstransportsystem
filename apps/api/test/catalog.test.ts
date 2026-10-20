import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe.skipIf(!TEST_DB_URL)('transport catalog, fleet and trips (database)', () => {
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

  async function company(label: string, timezone?: string) {
    const t = await createTenantWithOwner(db, label);
    if (timezone)
      await plat((tx) => tx.tenant.update({ where: { id: t.tenant.id }, data: { timezone } }));
    const owner = await loginClient(ctx.app, db, t.email, t.password);
    return { tenantId: t.tenant.id, owner };
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

  /** Locations, vehicles and a PUBLISHED route inserted directly (fast), to test behaviour on top. */
  async function fixtures(tenantId: string, durationMin = 120) {
    return plat(async (tx) => {
      const locs = await tx.location.createManyAndReturn({
        data: ['Freetown Terminal', 'Bo Station', 'Kenema Terminal'].map((name) => ({
          tenantId,
          name,
          city: name.split(' ')[0] as string,
        })),
      });
      const [a, b, c] = locs as [
        (typeof locs)[number],
        (typeof locs)[number],
        (typeof locs)[number],
      ];
      const route = await tx.route.create({
        data: {
          tenantId,
          name: uniq('Freetown-Bo'),
          originId: a.id,
          destinationId: b.id,
          distanceM: 250_000,
          durationMin,
          status: 'PUBLISHED',
        },
      });
      const vehicles = await tx.vehicle.createManyAndReturn({
        data: [uniq('SL-A'), uniq('SL-B')].map((r) => ({
          tenantId,
          registration: r.toUpperCase(),
          seatingCapacity: 50,
        })),
      });
      return { a, b, c, route, v1: vehicles[0]!, v2: vehicles[1]! };
    });
  }

  const schedule = (
    owner: Client,
    tenantId: string,
    routeId: string,
    over: Record<string, unknown> = {},
  ) =>
    owner
      .call('post', `/tenants/${tenantId}/schedules`)
      .send({ routeId, departureTime: '08:00', daysOfWeek: 127, validFrom: '2030-01-01', ...over });

  async function tripOn(
    owner: Client,
    tenantId: string,
    routeId: string,
    time: string,
    date: string,
  ) {
    const s = await schedule(owner, tenantId, routeId, { departureTime: time }).expect(201);
    await owner
      .call('post', `/tenants/${tenantId}/schedules/${s.body.id}/generate`)
      .send({ from: date, to: date })
      .expect(200);
    const trips = await owner
      .call('get', `/tenants/${tenantId}/trips?from=${date}&to=${date}`)
      .expect(200);
    // Fixture companies use the default UTC timezone, so local HH:MM equals the UTC HH:MM.
    const found = (trips.body.trips as { id: string; departureAt: string }[]).find(
      (t) => t.departureAt.slice(11, 16) === time,
    );
    if (!found) throw new Error(`expected a ${time} trip on ${date}`);
    return found;
  }

  describe('locations and vehicles', () => {
    it('manages locations with validation, uniqueness and delete protection', async () => {
      const { tenantId, owner } = await company('loc');
      const base = `/tenants/${tenantId}/locations`;
      const created = await owner
        .call('post', base)
        .send({ name: 'Makeni Terminal', kind: 'TERMINAL', city: 'Makeni' })
        .expect(201);
      await owner
        .call('post', base)
        .send({ name: 'Makeni Terminal', kind: 'TERMINAL', city: 'Makeni' })
        .expect(409);
      await owner
        .call('post', base)
        .send({ name: 'Half Coords', kind: 'STOP', city: 'X', latitude: 8.4 })
        .expect(400);
      await owner
        .call('post', base)
        .send({ name: 'Bad Lat', kind: 'STOP', city: 'X', latitude: 95, longitude: 1 })
        .expect(400);
      await owner
        .call('post', base)
        .send({
          name: 'Mass',
          kind: 'STOP',
          city: 'X',
          tenantId: '00000000-0000-4000-8000-000000000000',
        })
        .expect(400);
      await owner
        .call('patch', `${base}/${created.body.id}`)
        .send({ city: 'Makeni City' })
        .expect(200);

      const fx = await fixtures(tenantId);
      await owner.call('delete', `${base}/${fx.a.id}`).expect(409); // used by a route
      await owner.call('delete', `${base}/${created.body.id}`).expect(204);
      const list = await owner.call('get', `${base}?limit=100`).expect(200);
      expect(list.body.locations.some((l: { id: string }) => l.id === created.body.id)).toBe(false);
    });

    it('normalises registrations, enforces uniqueness, and guards capacity and odometer', async () => {
      const { tenantId, owner } = await company('veh');
      const base = `/tenants/${tenantId}/vehicles`;
      const v = await owner
        .call('post', base)
        .send({ registration: ' sl 4521 ', type: 'BUS', seatingCapacity: 60, odometerKm: 1000 })
        .expect(201);
      expect(v.body.registration).toBe('SL 4521');
      await owner
        .call('post', base)
        .send({ registration: 'SL 4521', type: 'BUS', seatingCapacity: 30 })
        .expect(409);
      await owner
        .call('post', base)
        .send({ registration: 'SL 1', type: 'BUS', seatingCapacity: 0 })
        .expect(400);
      await owner
        .call('post', base)
        .send({ registration: 'SL 2', type: 'BUS', seatingCapacity: 500 })
        .expect(400);
      await owner
        .call('post', base)
        .send({ registration: 'SL 3', type: 'BUS', seatingCapacity: 10, tenantId: 'x' })
        .expect(400);
      await owner.call('patch', `${base}/${v.body.id}`).send({ odometerKm: 500 }).expect(409); // backwards
      await owner.call('patch', `${base}/${v.body.id}`).send({ odometerKm: 1500 }).expect(200);
      await owner.call('patch', `${base}/${v.body.id}`).send({ status: 'RETIRED' }).expect(200);
      await owner.call('patch', `${base}/${v.body.id}`).send({ status: 'ACTIVE' }).expect(409); // cannot un-retire
    });
  });

  describe('routes', () => {
    it('validates route shape and protects published routes', async () => {
      const { tenantId, owner } = await company('route');
      const fx = await fixtures(tenantId);
      const base = `/tenants/${tenantId}/routes`;
      const body = (over: Record<string, unknown> = {}) => ({
        name: uniq('R'),
        originId: fx.a.id,
        destinationId: fx.b.id,
        distanceM: 100_000,
        durationMin: 120,
        stops: [{ locationId: fx.c.id, offsetMin: 60 }],
        ...over,
      });
      const ok = await owner.call('post', base).send(body()).expect(201);
      await owner
        .call('post', base)
        .send(body({ destinationId: fx.a.id }))
        .expect(400); // same ends
      await owner
        .call('post', base)
        .send(body({ stops: [{ locationId: fx.a.id, offsetMin: 30 }] }))
        .expect(400); // stop = origin
      await owner
        .call('post', base)
        .send(body({ stops: [{ locationId: fx.c.id, offsetMin: 150 }] }))
        .expect(400); // after arrival
      await owner
        .call('post', base)
        .send(
          body({
            stops: [
              { locationId: fx.c.id, offsetMin: 30 },
              { locationId: fx.c.id, offsetMin: 40 },
            ],
          }),
        )
        .expect(400); // duplicate
      await owner
        .call('post', base)
        .send(body({ distanceM: 0 }))
        .expect(400);

      const detail = await owner.call('get', `${base}/${ok.body.id}`).expect(200);
      expect(detail.body.stops).toEqual([
        expect.objectContaining({ sequence: 1, location: 'Kenema Terminal', offsetMin: 60 }),
      ]);

      await owner
        .call('patch', `${base}/${ok.body.id}`)
        .send({ name: uniq('Renamed') })
        .expect(204);
      await owner.call('post', `${base}/${ok.body.id}/publish`).send({}).expect(204);
      await owner.call('patch', `${base}/${ok.body.id}`).send({ name: 'Nope' }).expect(409); // published: immutable
      await owner.call('delete', `${base}/${ok.body.id}`).expect(409);
      await owner.call('post', `${base}/${ok.body.id}/publish`).send({}).expect(409);

      // An inactive location cannot be used on a new route.
      await plat((tx) => tx.location.update({ where: { id: fx.c.id }, data: { active: false } }));
      await owner.call('post', base).send(body()).expect(400);
    });
  });

  describe('schedules, generation and time zones', () => {
    it('refuses schedules on unpublished routes and validates input', async () => {
      const { tenantId, owner } = await company('sched');
      const fx = await fixtures(tenantId);
      const draft = await plat((tx) =>
        tx.route.update({ where: { id: fx.route.id }, data: { status: 'DRAFT' } }),
      );
      await schedule(owner, tenantId, draft.id).expect(409);
      await plat((tx) =>
        tx.route.update({ where: { id: fx.route.id }, data: { status: 'PUBLISHED' } }),
      );
      await schedule(owner, tenantId, fx.route.id, { departureTime: '25:00' }).expect(400);
      await schedule(owner, tenantId, fx.route.id, { daysOfWeek: 0 }).expect(400);
      await schedule(owner, tenantId, fx.route.id, { validFrom: '2030-02-30' }).expect(400);
      await schedule(owner, tenantId, fx.route.id, { validTo: '2029-01-01' }).expect(400);
      await schedule(owner, tenantId, fx.route.id, {
        defaultVehicleId: '00000000-0000-4000-8000-000000000000',
      }).expect(400);
      await schedule(owner, tenantId, fx.route.id).expect(201);
    });

    it('generates trips idempotently on the right weekdays, with correct local->UTC across DST', async () => {
      const { tenantId, owner } = await company('dst', 'America/New_York');
      const fx = await fixtures(tenantId);
      const s = await schedule(owner, tenantId, fx.route.id, {
        departureTime: '07:30',
        daysOfWeek: 127,
      }).expect(201);
      const gen = `/tenants/${tenantId}/schedules/${s.body.id}/generate`;

      const first = await owner
        .call('post', gen)
        .send({ from: '2030-03-09', to: '2030-03-11' })
        .expect(200);
      expect(first.body).toMatchObject({ created: 3, skippedExisting: 0, unassignedVehicle: [] });
      const again = await owner
        .call('post', gen)
        .send({ from: '2030-03-09', to: '2030-03-11' })
        .expect(200);
      expect(again.body).toMatchObject({ created: 0, skippedExisting: 3 }); // idempotent, no duplicates

      const trips = (
        await owner
          .call('get', `/tenants/${tenantId}/trips?from=2030-03-09&to=2030-03-11`)
          .expect(200)
      ).body.trips;
      expect(
        trips.map((t: { serviceDate: string; departureAt: string }) => [
          t.serviceDate,
          t.departureAt,
        ]),
      ).toEqual([
        ['2030-03-09', '2030-03-09T12:30:00.000Z'], // EST (UTC-5)
        ['2030-03-10', '2030-03-10T11:30:00.000Z'], // DST began: EDT (UTC-4), still 07:30 local
        ['2030-03-11', '2030-03-11T11:30:00.000Z'],
      ]);
      expect(trips[0].arrivalAt).toBe('2030-03-09T14:30:00.000Z'); // + 120 minutes

      // Weekday mask: Mon-only schedule over a full week yields one trip.
      const mon = await schedule(owner, tenantId, fx.route.id, {
        departureTime: '09:15',
        daysOfWeek: 1,
      }).expect(201);
      const w = await owner
        .call('post', `/tenants/${tenantId}/schedules/${mon.body.id}/generate`)
        .send({ from: '2030-03-04', to: '2030-03-10' })
        .expect(200);
      expect(w.body.created).toBe(1);

      await owner.call('post', gen).send({ from: '2030-03-01', to: '2030-12-31' }).expect(400); // too long a span
      await owner.call('post', gen).send({ from: '2030-03-12', to: '2030-03-10' }).expect(400); // inverted
      await owner
        .call('post', `/tenants/${tenantId}/schedules/${s.body.id}/pause`)
        .send({})
        .expect(204);
      await owner.call('post', gen).send({ from: '2030-03-20', to: '2030-03-21' }).expect(409); // paused
    });

    it('creates trips unassigned (and reports them) where the default vehicle would be double-booked', async () => {
      const { tenantId, owner } = await company('defveh');
      const fx = await fixtures(tenantId);
      const s1 = await schedule(owner, tenantId, fx.route.id, {
        departureTime: '08:00',
        defaultVehicleId: fx.v1.id,
      }).expect(201);
      const s2 = await schedule(owner, tenantId, fx.route.id, {
        departureTime: '09:00',
        defaultVehicleId: fx.v1.id,
      }).expect(201);
      const g1 = await owner
        .call('post', `/tenants/${tenantId}/schedules/${s1.body.id}/generate`)
        .send({ from: '2030-05-06', to: '2030-05-07' })
        .expect(200);
      expect(g1.body.unassignedVehicle).toEqual([]);
      const g2 = await owner
        .call('post', `/tenants/${tenantId}/schedules/${s2.body.id}/generate`)
        .send({ from: '2030-05-06', to: '2030-05-07' })
        .expect(200);
      expect(g2.body).toMatchObject({
        created: 2,
        unassignedVehicle: ['2030-05-06', '2030-05-07'],
      });
      const assigned = await plat((tx) =>
        tx.trip.count({ where: { tenantId, vehicleId: fx.v1.id } }),
      );
      expect(assigned).toBe(2); // only the 08:00 trips hold the vehicle
    });
  });

  describe('vehicle double-booking and trip lifecycle', () => {
    it('prevents overlapping assignments (allowing back-to-back) and frees a vehicle on cancel', async () => {
      const { tenantId, owner } = await company('overlap');
      const fx = await fixtures(tenantId, 120);
      const t8 = await tripOn(owner, tenantId, fx.route.id, '08:00', '2030-05-06');
      const t9 = await tripOn(owner, tenantId, fx.route.id, '09:00', '2030-05-06');
      const t10 = await tripOn(owner, tenantId, fx.route.id, '10:00', '2030-05-06');
      const assign = (tripId: string | undefined, vehicleId: string | null) =>
        owner.call('post', `/tenants/${tenantId}/trips/${tripId}/vehicle`).send({ vehicleId });

      await assign(t8?.id, fx.v1.id).expect(204);
      await assign(t9?.id, fx.v1.id).expect(409); // 09:00-11:00 overlaps 08:00-10:00
      await assign(t10?.id, fx.v1.id).expect(204); // 10:00-12:00 is back-to-back: allowed
      await owner
        .call('post', `/tenants/${tenantId}/trips/${t8?.id}/status`)
        .send({ status: 'CANCELLED' })
        .expect(204);
      await assign(t9?.id, fx.v1.id).expect(409); // still clashes with the 10:00 trip (09:00-11:00 vs 10:00-12:00)
      await assign(t9?.id, fx.v2.id).expect(204); // a different vehicle is fine
      await assign(t9?.id, null).expect(204); // clearing is allowed
    });

    it('lets exactly one of two concurrent overlapping assignments win', async () => {
      const { tenantId, owner } = await company('race');
      const fx = await fixtures(tenantId, 120);
      const ta = await tripOn(owner, tenantId, fx.route.id, '08:00', '2030-06-03');
      const tb = await tripOn(owner, tenantId, fx.route.id, '09:00', '2030-06-03');
      const results = await Promise.all(
        [ta, tb].map((t) =>
          owner
            .call('post', `/tenants/${tenantId}/trips/${t?.id}/vehicle`)
            .send({ vehicleId: fx.v1.id }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
      const holding = await plat((tx) =>
        tx.trip.count({ where: { tenantId, vehicleId: fx.v1.id } }),
      );
      expect(holding).toBe(1);
    });

    it('follows legal trip status transitions and protects in-service vehicles', async () => {
      const { tenantId, owner } = await company('life');
      const fx = await fixtures(tenantId);
      const trip = await tripOn(owner, tenantId, fx.route.id, '08:00', '2030-07-01');
      const status = (to: string) =>
        owner.call('post', `/tenants/${tenantId}/trips/${trip?.id}/status`).send({ status: to });

      await owner
        .call('post', `/tenants/${tenantId}/trips/${trip?.id}/vehicle`)
        .send({ vehicleId: fx.v1.id })
        .expect(204);
      await owner
        .call('patch', `/tenants/${tenantId}/vehicles/${fx.v1.id}`)
        .send({ status: 'MAINTENANCE' })
        .expect(409); // has an upcoming trip
      await status('IN_TRANSIT').expect(409); // must board first
      await status('COMPLETED').expect(409);
      await owner
        .call('post', `/tenants/${tenantId}/trips/${trip?.id}/delay`)
        .send({ delayMinutes: 25 })
        .expect(204);
      await status('BOARDING').expect(204);
      await status('IN_TRANSIT').expect(204);
      await status('COMPLETED').expect(204);
      await status('CANCELLED').expect(409); // finished trips are final
      await owner
        .call('post', `/tenants/${tenantId}/trips/${trip?.id}/delay`)
        .send({ delayMinutes: 5 })
        .expect(409);
      await owner
        .call('post', `/tenants/${tenantId}/trips/${trip?.id}/vehicle`)
        .send({ vehicleId: fx.v2.id })
        .expect(409);
    });

    it('will not assign a vehicle that is out of service', async () => {
      const { tenantId, owner } = await company('oos');
      const fx = await fixtures(tenantId);
      const trip = await tripOn(owner, tenantId, fx.route.id, '08:00', '2030-08-05');
      await owner
        .call('patch', `/tenants/${tenantId}/vehicles/${fx.v2.id}`)
        .send({ status: 'MAINTENANCE' })
        .expect(200);
      await owner
        .call('post', `/tenants/${tenantId}/trips/${trip?.id}/vehicle`)
        .send({ vehicleId: fx.v2.id })
        .expect(409);
    });
  });

  describe('permissions and tenant isolation', () => {
    it('applies least privilege across roles', async () => {
      const { tenantId, owner } = await company('perm');
      const fx = await fixtures(tenantId);
      const driver = await member(tenantId, 'driver'); // trip.read only
      const dispatcher = await member(tenantId, 'dispatcher'); // route.read, trip.*, fleet.read
      const sales = await member(tenantId, 'sales_agent'); // route.read, trip.read, booking.*

      await driver.call('get', `/tenants/${tenantId}/trips`).expect(200);
      await driver.call('get', `/tenants/${tenantId}/routes`).expect(403);
      await driver.call('get', `/tenants/${tenantId}/vehicles`).expect(403);
      await driver
        .call('post', `/tenants/${tenantId}/vehicles`)
        .send({ registration: 'DRV 1', type: 'BUS', seatingCapacity: 10 })
        .expect(403);

      await dispatcher.call('get', `/tenants/${tenantId}/vehicles`).expect(200);
      await dispatcher
        .call('post', `/tenants/${tenantId}/vehicles`)
        .send({ registration: 'DSP 1', type: 'BUS', seatingCapacity: 10 })
        .expect(403);
      await dispatcher
        .call('post', `/tenants/${tenantId}/routes`)
        .send({
          name: 'X',
          originId: fx.a.id,
          destinationId: fx.b.id,
          distanceM: 1,
          durationMin: 1,
          stops: [],
        })
        .expect(403);
      const s = await schedule(owner, tenantId, fx.route.id).expect(201);
      await dispatcher
        .call('post', `/tenants/${tenantId}/schedules/${s.body.id}/generate`)
        .send({ from: '2030-09-02', to: '2030-09-02' })
        .expect(200);
      await dispatcher
        .call('post', `/tenants/${tenantId}/schedules`)
        .send({
          routeId: fx.route.id,
          departureTime: '10:00',
          daysOfWeek: 1,
          validFrom: '2030-01-01',
        })
        .expect(403);

      await sales.call('get', `/tenants/${tenantId}/routes`).expect(200);
      await sales
        .call('post', `/tenants/${tenantId}/locations`)
        .send({ name: 'Sales Loc', kind: 'STOP', city: 'X' })
        .expect(403);

      const denied = await plat((tx) =>
        tx.auditLog.findMany({
          where: { tenantId, actorUserId: driver.userId, action: 'authz.permission_denied' },
        }),
      );
      expect(denied.length).toBeGreaterThanOrEqual(3);
    });

    it("keeps one company's catalog, fleet and trips invisible and untouchable to another", async () => {
      const a = await company('iso-cat-a');
      const b = await company('iso-cat-b');
      const fxA = await fixtures(a.tenantId);
      const fxB = await fixtures(b.tenantId);
      const tripA = await tripOn(a.owner, a.tenantId, fxA.route.id, '08:00', '2030-10-07');

      // Cannot even address A's tenant.
      await b.owner.call('get', `/tenants/${a.tenantId}/routes`).expect(404);
      await b.owner.call('get', `/tenants/${a.tenantId}/trips`).expect(404);

      // Through B's own scope, A's object IDs do not exist.
      await b.owner.call('get', `/tenants/${b.tenantId}/routes/${fxA.route.id}`).expect(404);
      await b.owner.call('get', `/tenants/${b.tenantId}/vehicles/${fxA.v1.id}`).expect(404);
      await b.owner
        .call('patch', `/tenants/${b.tenantId}/vehicles/${fxA.v1.id}`)
        .send({ status: 'RETIRED' })
        .expect(404);
      await b.owner
        .call('patch', `/tenants/${b.tenantId}/locations/${fxA.a.id}`)
        .send({ city: 'Hacked' })
        .expect(404);
      await b.owner.call('delete', `/tenants/${b.tenantId}/locations/${fxA.a.id}`).expect(404);
      await b.owner
        .call('post', `/tenants/${b.tenantId}/trips/${tripA?.id}/status`)
        .send({ status: 'CANCELLED' })
        .expect(404);

      // B cannot build on A's records.
      await b.owner
        .call('post', `/tenants/${b.tenantId}/routes`)
        .send({
          name: uniq('X'),
          originId: fxA.a.id,
          destinationId: fxB.b.id,
          distanceM: 10,
          durationMin: 10,
          stops: [],
        })
        .expect(400);
      const bs = await schedule(b.owner, b.tenantId, fxB.route.id).expect(201);
      await schedule(b.owner, b.tenantId, fxA.route.id).expect(400); // A's route
      await schedule(b.owner, b.tenantId, fxB.route.id, { defaultVehicleId: fxA.v1.id }).expect(
        400,
      ); // A's vehicle
      await b.owner
        .call('post', `/tenants/${b.tenantId}/schedules/${bs.body.id}/generate`)
        .send({ from: '2030-10-07', to: '2030-10-07' })
        .expect(200);
      const bTrip = (await b.owner.call('get', `/tenants/${b.tenantId}/trips`).expect(200)).body
        .trips[0];
      await b.owner
        .call('post', `/tenants/${b.tenantId}/trips/${bTrip.id}/vehicle`)
        .send({ vehicleId: fxA.v1.id })
        .expect(400);

      // Lists contain only the caller's own rows.
      const aTrips = (await a.owner.call('get', `/tenants/${a.tenantId}/trips`).expect(200)).body
        .trips;
      expect(aTrips.every((t: { routeId: string }) => t.routeId === fxA.route.id)).toBe(true);

      // A's trip is intact.
      const still = await plat((tx) => tx.trip.findFirstOrThrow({ where: { id: tripA?.id } }));
      expect(still.status).toBe('SCHEDULED');
    });

    it('enforces tenant integrity in the database itself (RLS and composite foreign keys)', async () => {
      const a = await company('db-cat-a');
      const b = await company('db-cat-b');
      const fxA = await fixtures(a.tenantId);
      const fxB = await fixtures(b.tenantId);

      // No context -> no rows from any tenant table.
      expect(await withDb(db, {}, (tx) => tx.location.count())).toBe(0);
      expect(await withDb(db, {}, (tx) => tx.route.count())).toBe(0);
      expect(await withDb(db, {}, (tx) => tx.trip.count())).toBe(0);
      // Tenant A's context cannot see B's rows.
      const seen = await withDb(db, { tenantId: a.tenantId }, (tx) => tx.vehicle.findMany());
      expect(seen.every((v) => v.tenantId === a.tenantId)).toBe(true);
      expect(seen.some((v) => v.id === fxB.v1.id)).toBe(false);

      // Even with platform scope, a cross-tenant reference is rejected by the composite FK.
      await expect(
        plat((tx) =>
          tx.route.create({
            data: {
              tenantId: b.tenantId,
              name: uniq('Evil'),
              originId: fxA.a.id,
              destinationId: fxB.b.id,
              distanceM: 1,
              durationMin: 1,
            },
          }),
        ),
      ).rejects.toThrow();
      await expect(
        plat((tx) =>
          tx.trip.create({
            data: {
              tenantId: b.tenantId,
              routeId: fxB.route.id,
              vehicleId: fxA.v1.id,
              serviceDate: new Date('2030-11-01'),
              departureAt: new Date('2030-11-01T08:00:00Z'),
              arrivalAt: new Date('2030-11-01T10:00:00Z'),
            },
          }),
        ),
      ).rejects.toThrow();
      // CHECK constraints hold regardless of the application.
      await expect(
        plat((tx) =>
          tx.trip.create({
            data: {
              tenantId: a.tenantId,
              routeId: fxA.route.id,
              serviceDate: new Date('2030-11-01'),
              departureAt: new Date('2030-11-01T10:00:00Z'),
              arrivalAt: new Date('2030-11-01T08:00:00Z'),
            },
          }),
        ),
      ).rejects.toThrow();
    });
  });
});
