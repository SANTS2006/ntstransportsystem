import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withDb, type Db, type Tx } from '../src/platform/db.js';
import { OutboxProcessor, enqueueOutbox } from '../src/platform/outbox.js';
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

describe.skipIf(!TEST_DB_URL)('dispatch, calendar, seat layouts and outbox (database)', () => {
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
  const at = (date: string, hour: number) =>
    new Date(`${date}T${String(hour).padStart(2, '0')}:00:00.000Z`);

  async function kit(
    tenantId: string,
    routeOver: { allowedVehicleTypes?: ('BUS' | 'MINIBUS')[]; minSeats?: number } = {},
  ) {
    return plat(async (tx) => {
      const locs = await tx.location.createManyAndReturn({
        data: [uniq('Origin'), uniq('Destination')].map((name) => ({ tenantId, name, city: name })),
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
          ...routeOver,
        },
      });
      const vehicles = await tx.vehicle.createManyAndReturn({
        data: [
          { type: 'BUS' as const, seatingCapacity: 50 },
          { type: 'BUS' as const, seatingCapacity: 45 },
          { type: 'MINIBUS' as const, seatingCapacity: 14 },
        ].map((v, i) => ({
          tenantId,
          registration: uniq(`DV${i}`).toUpperCase(),
          ...v,
        })),
      });
      return { route, bus: vehicles[0]!, bus2: vehicles[1]!, mini: vehicles[2]! };
    });
  }

  const insertTrip = (
    tenantId: string,
    routeId: string,
    date: string,
    from: number,
    to: number,
    over: Record<string, unknown> = {},
  ) =>
    plat((tx) =>
      tx.trip.create({
        data: {
          tenantId,
          routeId,
          serviceDate: new Date(date),
          departureAt: at(date, from),
          arrivalAt: at(date, to),
          ...over,
        },
      }),
    );

  describe('seat layouts', () => {
    it('generates a grid, validates accessible seats, and ties vehicles to the seat count', async () => {
      const { tenantId, owner } = await company('layouts');
      const base = `/tenants/${tenantId}`;
      const created = await owner
        .call('post', `${base}/seat-layouts`)
        .send({ name: '10x4', rows: 10, columns: 4, accessible: ['1A', '1B'] })
        .expect(201);
      expect(created.body.seats).toBe(40);
      const detail = await owner.call('get', `${base}/seat-layouts/${created.body.id}`).expect(200);
      expect(detail.body.seats).toHaveLength(40);
      expect(detail.body.seats[0]).toMatchObject({ label: '1A', accessible: true });
      expect(detail.body.seats[39]).toMatchObject({ label: '10D', accessible: false });

      await owner
        .call('post', `${base}/seat-layouts`)
        .send({ name: 'bad', rows: 2, columns: 2, accessible: ['9Z'] })
        .expect(400);
      await owner
        .call('post', `${base}/seat-layouts`)
        .send({ name: '10x4', rows: 1, columns: 1 })
        .expect(409);
      await owner
        .call('post', `${base}/seat-layouts`)
        .send({ name: 'x', rows: 0, columns: 7 })
        .expect(400);

      const wrong = await owner
        .call('post', `${base}/vehicles`)
        .send({
          registration: uniq('LY').toUpperCase(),
          type: 'BUS',
          seatingCapacity: 38,
          seatLayoutId: created.body.id,
        })
        .expect(409);
      expect(wrong.body.error.message).toMatch(/40 seats/);
      const ok = await owner
        .call('post', `${base}/vehicles`)
        .send({
          registration: uniq('LY').toUpperCase(),
          type: 'BUS',
          seatingCapacity: 40,
          seatLayoutId: created.body.id,
        })
        .expect(201);
      // Changing the capacity under a layout is refused too.
      await owner
        .call('patch', `${base}/vehicles/${ok.body.id}`)
        .send({ seatingCapacity: 39 })
        .expect(409);
      await owner.call('delete', `${base}/seat-layouts/${created.body.id}`).expect(409); // in use
    });

    it('is tenant-isolated and permission-gated', async () => {
      const a = await company('layout-a');
      const b = await company('layout-b');
      const made = await a.owner
        .call('post', `/tenants/${a.tenantId}/seat-layouts`)
        .send({ name: 'secret', rows: 2, columns: 2 })
        .expect(201);
      expect(
        (await b.owner.call('get', `/tenants/${b.tenantId}/seat-layouts`).expect(200)).body.items,
      ).toHaveLength(0);
      await b.owner.call('get', `/tenants/${b.tenantId}/seat-layouts/${made.body.id}`).expect(404);
      await b.owner.call('get', `/tenants/${a.tenantId}/seat-layouts`).expect(404); // not a member
      const dispatcher = await member(a.tenantId, 'dispatcher');
      await dispatcher.call('get', `/tenants/${a.tenantId}/seat-layouts`).expect(200);
      await dispatcher
        .call('post', `/tenants/${a.tenantId}/seat-layouts`)
        .send({ name: 'nope', rows: 1, columns: 1 })
        .expect(403);
    });
  });

  describe('route compatibility', () => {
    it('refuses vehicles of the wrong type or too few seats, for schedules, trips and replacements', async () => {
      const { tenantId, owner } = await company('compat');
      const base = `/tenants/${tenantId}`;
      const fx = await kit(tenantId, { allowedVehicleTypes: ['BUS'], minSeats: 46 });

      const badType = await owner
        .call('post', `${base}/schedules`)
        .send({
          routeId: fx.route.id,
          departureTime: '08:00',
          daysOfWeek: 127,
          validFrom: '2032-01-01',
          defaultVehicleId: fx.mini.id,
        })
        .expect(409);
      expect(badType.body.error.message).toMatch(/minibus/);
      await owner
        .call('post', `${base}/schedules`)
        .send({
          routeId: fx.route.id,
          departureTime: '08:00',
          daysOfWeek: 127,
          validFrom: '2032-01-01',
          defaultVehicleId: fx.bus2.id, // BUS but only 45 seats
        })
        .expect(409);

      const trip = await insertTrip(tenantId, fx.route.id, '2032-02-01', 8, 10);
      await owner
        .call('post', `${base}/trips/${trip.id}/vehicle`)
        .send({ vehicleId: fx.mini.id })
        .expect(409);
      await owner
        .call('post', `${base}/trips/${trip.id}/vehicle`)
        .send({ vehicleId: fx.bus2.id })
        .expect(409);
      await owner
        .call('post', `${base}/trips/${trip.id}/vehicle`)
        .send({ vehicleId: fx.bus.id })
        .expect(204);
      await owner
        .call('post', `${base}/trips/${trip.id}/replace-vehicle`)
        .send({ vehicleId: fx.mini.id, reason: 'swap' })
        .expect(409);

      // Route rules can be set through the API.
      const r = await owner.call('get', `${base}/routes/${fx.route.id}`).expect(200);
      expect(r.body).toMatchObject({ allowedVehicleTypes: ['BUS'], minSeats: 46 });
    });
  });

  describe('service calendar', () => {
    it('skips blackout dates (company-wide and per route) when generating, and reports open trips', async () => {
      const { tenantId, owner } = await company('blackout');
      const base = `/tenants/${tenantId}`;
      const fx = await kit(tenantId);
      const other = await kit(tenantId);
      const s = await owner
        .call('post', `${base}/schedules`)
        .send({
          routeId: fx.route.id,
          departureTime: '08:00',
          daysOfWeek: 127,
          validFrom: '2032-05-01',
        })
        .expect(201);

      const all = await owner
        .call('post', `${base}/calendar/blackouts`)
        .send({ startsOn: '2032-05-03', endsOn: '2032-05-03', reason: 'National holiday' })
        .expect(201);
      expect(all.body.openTripsAffected).toBe(0);
      await owner
        .call('post', `${base}/calendar/blackouts`)
        .send({
          routeId: fx.route.id,
          startsOn: '2032-05-05',
          endsOn: '2032-05-06',
          reason: 'Road works',
        })
        .expect(201);
      // A blackout for a different route must not affect this one.
      await owner
        .call('post', `${base}/calendar/blackouts`)
        .send({
          routeId: other.route.id,
          startsOn: '2032-05-04',
          endsOn: '2032-05-04',
          reason: 'Other route',
        })
        .expect(201);

      const gen = await owner
        .call('post', `${base}/schedules/${s.body.id}/generate`)
        .send({ from: '2032-05-01', to: '2032-05-07' })
        .expect(200);
      expect(gen.body.created).toBe(4); // 1,2,4,7
      expect(gen.body.skippedBlackout).toEqual(['2032-05-03', '2032-05-05', '2032-05-06']);

      // Adding a blackout over existing open trips reports them but cancels nothing.
      const late = await owner
        .call('post', `${base}/calendar/blackouts`)
        .send({ startsOn: '2032-05-01', endsOn: '2032-05-02', reason: 'Strike' })
        .expect(201);
      expect(late.body.openTripsAffected).toBe(2);
      const list = await owner
        .call('get', `${base}/calendar/blackouts?from=2032-05-01&to=2032-05-31`)
        .expect(200);
      expect(list.body.items).toHaveLength(4);
      await owner.call('delete', `${base}/calendar/blackouts/${late.body.id}`).expect(204);
      await owner.call('delete', `${base}/calendar/blackouts/${late.body.id}`).expect(404);

      await owner
        .call('post', `${base}/calendar/blackouts`)
        .send({ startsOn: '2032-05-09', endsOn: '2032-05-08', reason: 'backwards' })
        .expect(400);
      await owner
        .call('post', `${base}/calendar/blackouts`)
        .send({
          routeId: '00000000-0000-4000-8000-000000000000',
          startsOn: '2032-05-09',
          endsOn: '2032-05-09',
          reason: 'x1',
        })
        .expect(400);
    }, 400_000);

    it('is invisible and unmanageable across tenants', async () => {
      const a = await company('cal-a');
      const b = await company('cal-b');
      const made = await a.owner
        .call('post', `/tenants/${a.tenantId}/calendar/blackouts`)
        .send({ startsOn: '2032-06-01', endsOn: '2032-06-02', reason: 'Private' })
        .expect(201);
      expect(
        (await b.owner.call('get', `/tenants/${b.tenantId}/calendar/blackouts`).expect(200)).body
          .items,
      ).toHaveLength(0);
      await b.owner
        .call('delete', `/tenants/${b.tenantId}/calendar/blackouts/${made.body.id}`)
        .expect(404);
      await b.owner
        .call('delete', `/tenants/${a.tenantId}/calendar/blackouts/${made.body.id}`)
        .expect(404);
    });
  });

  describe('trip timeline, replacement and the notification outbox', () => {
    const outboxFor = (tenantId: string, type: string) =>
      plat((tx) => tx.outboxEvent.findMany({ where: { tenantId, type } }));

    it('records delay/cancel events once and queues exactly one notice per distinct change', async () => {
      const { tenantId, owner } = await company('events');
      const base = `/tenants/${tenantId}`;
      const fx = await kit(tenantId);
      const trip = await insertTrip(tenantId, fx.route.id, '2032-07-01', 8, 10, {
        vehicleId: fx.bus.id,
      });

      await owner
        .call('post', `${base}/trips/${trip.id}/delay`)
        .send({ delayMinutes: 20 })
        .expect(204);
      await owner
        .call('post', `${base}/trips/${trip.id}/delay`)
        .send({ delayMinutes: 20 })
        .expect(204); // same again
      await owner
        .call('post', `${base}/trips/${trip.id}/delay`)
        .send({ delayMinutes: 35 })
        .expect(204);
      expect(await outboxFor(tenantId, 'trip.delayed')).toHaveLength(2);

      await owner
        .call('post', `${base}/trips/${trip.id}/status`)
        .send({ status: 'CANCELLED' })
        .expect(204);
      expect(await outboxFor(tenantId, 'trip.cancelled')).toHaveLength(1);

      const ev = await owner.call('get', `${base}/trips/${trip.id}/events`).expect(200);
      const kinds = (ev.body.items as { kind: string }[]).map((e) => e.kind);
      expect(kinds).toContain('DELAY_SET');
      expect(kinds).toContain('STATUS_CHANGED');
      // The timeline is append-only at the database level.
      await expect(
        plat((tx) => tx.tripEvent.deleteMany({ where: { tripId: trip.id } })),
      ).rejects.toThrow();
    });

    it('replaces a vehicle mid-trip, optionally retiring the old one, and enforces overlap', async () => {
      const { tenantId, owner } = await company('replace');
      const base = `/tenants/${tenantId}`;
      const fx = await kit(tenantId);
      const live = await insertTrip(tenantId, fx.route.id, '2032-08-01', 8, 12, {
        vehicleId: fx.bus.id,
        status: 'IN_TRANSIT',
      });
      // bus2 is busy on an overlapping trip, so it cannot take over.
      await insertTrip(tenantId, fx.route.id, '2032-08-01', 10, 13, { vehicleId: fx.bus2.id });
      await owner
        .call('post', `${base}/trips/${live.id}/replace-vehicle`)
        .send({ vehicleId: fx.bus2.id, reason: 'Engine failure' })
        .expect(409);

      const spare = await plat((tx) =>
        tx.vehicle.create({
          data: {
            tenantId,
            registration: uniq('SPARE').toUpperCase(),
            seatingCapacity: 30,
            type: 'BUS',
          },
        }),
      );
      const res = await owner
        .call('post', `${base}/trips/${live.id}/replace-vehicle`)
        .send({ vehicleId: spare.id, reason: 'Engine failure', markOldOutOfService: true })
        .expect(200);
      expect(res.body.capacityReduced).toBe(true);
      const after = await plat(async (tx) => ({
        trip: await tx.trip.findUniqueOrThrow({ where: { id: live.id } }),
        old: await tx.vehicle.findUniqueOrThrow({ where: { id: fx.bus.id } }),
      }));
      expect(after.trip.vehicleId).toBe(spare.id);
      expect(after.old.status).toBe('MAINTENANCE');
      expect(await outboxFor(tenantId, 'trip.vehicle_replaced')).toHaveLength(1);
      const ev = await owner.call('get', `${base}/trips/${live.id}/events`).expect(200);
      expect(ev.body.items[0]).toMatchObject({ kind: 'VEHICLE_REPLACED' });
      expect(ev.body.items[0].details.reason).toBe('Engine failure');

      await owner
        .call('post', `${base}/trips/${live.id}/replace-vehicle`)
        .send({ vehicleId: spare.id, reason: 'again' })
        .expect(409); // already on this trip
      const done = await insertTrip(tenantId, fx.route.id, '2032-08-02', 8, 10, {
        vehicleId: fx.bus.id,
        status: 'COMPLETED',
      });
      await owner
        .call('post', `${base}/trips/${done.id}/replace-vehicle`)
        .send({ vehicleId: spare.id, reason: 'too late' })
        .expect(409);
      const dispatcherless = await member(tenantId, 'driver');
      await dispatcherless
        .call('post', `${base}/trips/${live.id}/replace-vehicle`)
        .send({ vehicleId: fx.bus.id, reason: 'no permission' })
        .expect(403);
    });

    it("hides another company's timeline", async () => {
      const a = await company('tl-a');
      const b = await company('tl-b');
      const fx = await kit(a.tenantId);
      const trip = await insertTrip(a.tenantId, fx.route.id, '2032-09-01', 8, 10);
      await b.owner.call('get', `/tenants/${b.tenantId}/trips/${trip.id}/events`).expect(404);
    });
  });

  describe('dispatch board', () => {
    it('flags what needs attention and counts by status', async () => {
      const { tenantId, owner } = await company('board');
      const base = `/tenants/${tenantId}`;
      const fx = await kit(tenantId);
      const D = '2032-10-01';
      await plat((tx) =>
        tx.vehicleDocument.create({
          data: {
            tenantId,
            vehicleId: fx.bus2.id,
            kind: 'INSURANCE',
            referenceNo: 'POL-1',
            expiresOn: new Date('2032-09-01'),
          },
        }),
      );
      await insertTrip(tenantId, fx.route.id, D, 6, 8); // no vehicle, no driver
      await insertTrip(tenantId, fx.route.id, D, 9, 11, { vehicleId: fx.bus.id, delayMinutes: 15 });
      await insertTrip(tenantId, fx.route.id, D, 12, 14, { vehicleId: fx.bus2.id }); // expired insurance
      await insertTrip(tenantId, fx.route.id, D, 15, 17, { status: 'CANCELLED' }); // not flagged

      const board = await owner.call('get', `${base}/dispatch/board?date=${D}`).expect(200);
      expect(board.body.summary).toMatchObject({ total: 4, needingAttention: 3 });
      expect(board.body.summary.byStatus).toMatchObject({ SCHEDULED: 3, CANCELLED: 1 });
      const flags = (board.body.trips as { flags: string[] }[]).map((t) => t.flags);
      expect(flags[0]).toEqual(expect.arrayContaining(['NO_VEHICLE', 'NO_DRIVER']));
      expect(flags[1]).toContain('DELAYED');
      expect(flags[2]).toContain('VEHICLE_DOCUMENT_EXPIRED');
      expect(flags[3]).toEqual([]);

      await owner.call('get', `${base}/dispatch/board?date=nope`).expect(400);
      await owner.call('get', `${base}/dispatch/board`).expect(400);
      const other = await company('board-other');
      const empty = await other.owner
        .call('get', `/tenants/${other.tenantId}/dispatch/board?date=${D}`)
        .expect(200);
      expect(empty.body.summary.total).toBe(0);
    });
  });

  describe('outbox processor', () => {
    const type = () => uniq('test.event');
    const seed = async (tenantId: string, t: string, n: number) => {
      for (let i = 0; i < n; i++) {
        await plat((tx) =>
          enqueueOutbox(tx, { tenantId, type: t, payload: { i }, dedupeKey: `${t}:${i}` }),
        );
      }
    };

    it('dedupes enqueues and handles every event exactly once with concurrent workers', async () => {
      const { tenantId } = await company('outbox-conc');
      const t = type();
      await seed(tenantId, t, 12);
      await seed(tenantId, t, 12); // same dedupe keys: no duplicates
      expect(await plat((tx) => tx.outboxEvent.count({ where: { tenantId, type: t } }))).toBe(12);

      const seen: number[] = [];
      const handler = async (e: { payload: unknown }) => {
        await new Promise((r) => setTimeout(r, 15));
        seen.push((e.payload as { i: number }).i);
      };
      const workers = [1, 2, 3].map(
        () => new OutboxProcessor(db, { [t]: handler }, { batchSize: 4 }),
      );
      for (let round = 0; round < 3; round++) {
        await Promise.all(workers.map((w) => w.runOnce()));
      }
      expect(seen.sort((x, y) => x - y)).toEqual([...Array(12).keys()]);
      expect(
        await plat((tx) =>
          tx.outboxEvent.count({ where: { tenantId, type: t, processedAt: null } }),
        ),
      ).toBe(0);
    });

    it('retries with backoff, then dead-letters, without leaking payloads into errors', async () => {
      const { tenantId } = await company('outbox-fail');
      const t = type();
      await plat((tx) => enqueueOutbox(tx, { tenantId, type: t, payload: { secret: 's3cret' } }));
      let clock = new Date();
      const proc = new OutboxProcessor(
        db,
        {
          [t]: async () => {
            throw new Error('provider down');
          },
        },
        { maxAttempts: 2, backoffBaseMs: 1_000, now: () => clock, random: () => 0 },
      );
      expect(await proc.runOnce()).toMatchObject({ claimed: 1, retried: 1 });
      // Not yet due: nothing is claimed.
      expect(await proc.runOnce()).toMatchObject({ claimed: 0 });
      clock = new Date(clock.getTime() + 120_000);
      expect(await proc.runOnce()).toMatchObject({ claimed: 1, deadLettered: 1 });
      const row = await plat((tx) =>
        tx.outboxEvent.findFirstOrThrow({ where: { tenantId, type: t } }),
      );
      expect(row.failedAt).not.toBeNull();
      expect(row.attempts).toBe(2);
      expect(row.lastError).toBe('provider down');
      clock = new Date(clock.getTime() + 600_000);
      expect(await proc.runOnce()).toMatchObject({ claimed: 0 }); // dead-lettered rows stay put
    });

    it('does not claim event types it has no handler for', async () => {
      const { tenantId } = await company('outbox-unknown');
      const t = type();
      await plat((tx) => enqueueOutbox(tx, { tenantId, type: t, payload: {} }));
      const other = new OutboxProcessor(db, { [type()]: async () => undefined });
      await other.runOnce();
      const row = await plat((tx) =>
        tx.outboxEvent.findFirstOrThrow({ where: { tenantId, type: t } }),
      );
      expect(row).toMatchObject({ attempts: 0, failedAt: null, processedAt: null });
    });

    it('reappears after the lease if a worker dies mid-way', async () => {
      const { tenantId } = await company('outbox-lease');
      const t = type();
      await plat((tx) => enqueueOutbox(tx, { tenantId, type: t, payload: {} }));
      let clock = new Date();
      let calls = 0;
      const crashing = new OutboxProcessor(
        db,
        {
          [t]: async () => {
            calls++;
          },
        },
        { leaseMs: 5_000, now: () => clock },
      );
      // Simulate a crash: claim without finishing by leasing the row manually.
      await plat((tx) =>
        tx.outboxEvent.updateMany({
          where: { tenantId, type: t },
          data: { attempts: 1, availableAt: new Date(clock.getTime() + 5_000) },
        }),
      );
      expect(await crashing.runOnce()).toMatchObject({ claimed: 0 });
      clock = new Date(clock.getTime() + 10_000);
      expect(await crashing.runOnce()).toMatchObject({ claimed: 1, processed: 1 });
      expect(calls).toBe(1);
    });
  });
});
