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

describe.skipIf(!TEST_DB_URL)('crew, maintenance and fleet alerts (database)', () => {
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

  /** Route, vehicles, employees and trips inserted directly, so tests can focus on the rules. */
  async function kit(tenantId: string) {
    return plat(async (tx) => {
      const locs = await tx.location.createManyAndReturn({
        data: ['Origin', 'Destination'].map((name) => ({ tenantId, name, city: name })),
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
      const vehicles = await tx.vehicle.createManyAndReturn({
        data: [uniq('SL-V1').toUpperCase(), uniq('SL-V2').toUpperCase()].map((registration) => ({
          tenantId,
          registration,
          seatingCapacity: 40,
        })),
      });
      const D = '2031-03-10';
      const mk = (date: string, from: number, to: number) => ({
        tenantId,
        routeId: route.id,
        serviceDate: new Date(date),
        departureAt: at(date, from),
        arrivalAt: at(date, to),
      });
      const trips = await tx.trip.createManyAndReturn({
        data: [
          mk(D, 8, 10),
          mk(D, 9, 11),
          mk(D, 12, 14),
          mk('2031-03-11', 8, 10),
          mk('2031-03-12', 8, 10),
          mk('2031-03-12', 9, 11),
        ],
      });
      const [t1, t2, t3, t4, t5, t6] = trips as [
        (typeof trips)[number],
        ...(typeof trips)[number][],
      ] as unknown as typeof trips;
      const emp = (
        n: string,
        role: 'DRIVER' | 'CONDUCTOR' | 'MECHANIC',
        status: 'ACTIVE' | 'TERMINATED' = 'ACTIVE',
      ) => ({
        tenantId,
        employeeNumber: uniq(n),
        fullName: `${n} Person`,
        role,
        status,
        phone: '+23277000000',
      });
      const employees = await tx.employee.createManyAndReturn({
        data: [
          emp('driverA', 'DRIVER'),
          emp('driverExpired', 'DRIVER'),
          emp('driverNoLicence', 'DRIVER'),
          emp('conductorC', 'CONDUCTOR'),
          emp('mechanicM', 'MECHANIC'),
          emp('driverRace', 'DRIVER'),
        ],
      });
      const [driverA, driverExpired, driverNoLicence, conductorC, mechanicM, driverRace] =
        employees as unknown as typeof employees;
      await tx.driverLicence.createMany({
        data: [
          {
            tenantId,
            employeeId: driverA!.id,
            licenceNumber: uniq('LIC-A').toUpperCase(),
            category: 'D',
            expiresOn: new Date('2033-01-01'),
          },
          {
            tenantId,
            employeeId: driverExpired!.id,
            licenceNumber: uniq('LIC-X').toUpperCase(),
            category: 'D',
            expiresOn: new Date('2031-03-01'),
          }, // expired before the trips
          {
            tenantId,
            employeeId: driverRace!.id,
            licenceNumber: uniq('LIC-R').toUpperCase(),
            category: 'D',
            expiresOn: new Date('2033-01-01'),
          },
        ],
      });
      return {
        route,
        v1: vehicles[0]!,
        v2: vehicles[1]!,
        t1: t1!,
        t2: t2!,
        t3: t3!,
        t4: t4!,
        t5: t5!,
        t6: t6!,
        driverA: driverA!,
        driverExpired: driverExpired!,
        driverNoLicence: driverNoLicence!,
        conductorC: conductorC!,
        mechanicM: mechanicM!,
        driverRace: driverRace!,
      };
    });
  }

  const crewPath = (tenantId: string, tripId: string) =>
    `/tenants/${tenantId}/trips/${tripId}/crew`;

  describe('employees and licences', () => {
    it('manages employees with HR permissions and keeps personal data out of the dispatcher roster', async () => {
      const { tenantId, owner } = await company('hr');
      const hr = await member(tenantId, 'hr_manager');
      const dispatcher = await member(tenantId, 'dispatcher');
      const base = `/tenants/${tenantId}/employees`;
      const number = uniq('E');

      const created = await hr
        .call('post', base)
        .send({
          employeeNumber: number,
          fullName: 'Aminata Kamara',
          role: 'DRIVER',
          phone: '+23277111222',
          hiredOn: '2030-01-15',
        })
        .expect(201);
      await hr
        .call('post', base)
        .send({ employeeNumber: number, fullName: 'Duplicate', role: 'DRIVER' })
        .expect(409);
      await hr
        .call('post', base)
        .send({ employeeNumber: uniq('E'), fullName: 'X', role: 'DRIVER' })
        .expect(400); // name too short
      await hr
        .call('post', base)
        .send({
          employeeNumber: uniq('E'),
          fullName: 'Mass Assign',
          role: 'DRIVER',
          tenantId: 'x',
          status: 'TERMINATED',
        })
        .expect(400);
      await hr
        .call('post', base)
        .send({ employeeNumber: uniq('E'), fullName: 'Chris Conductor', role: 'CONDUCTOR' })
        .expect(201);

      const lic = `${base}/${created.body.id}/licences`;
      await hr
        .call('post', lic)
        .send({ licenceNumber: ' sl-dl-1001 ', category: 'D', expiresOn: '2033-05-01' })
        .expect(201);
      await hr
        .call('post', lic)
        .send({ licenceNumber: 'SL-DL-1001', category: 'D', expiresOn: '2033-05-01' })
        .expect(409); // same number, case-insensitive
      await hr
        .call('post', lic)
        .send({ licenceNumber: 'SL-DL-2002', category: 'D', expiresOn: '2033-02-30' })
        .expect(400); // impossible date
      const conductor = (await hr.call('get', `${base}?role=CONDUCTOR`).expect(200)).body
        .employees[0];
      await hr
        .call('post', `${base}/${conductor.id}/licences`)
        .send({ licenceNumber: 'SL-DL-3003', category: 'D', expiresOn: '2033-05-01' })
        .expect(409); // only drivers hold licences

      const list = (await hr.call('get', base).expect(200)).body.employees;
      expect(list.find((e: { id: string }) => e.id === created.body.id)).toMatchObject({
        phone: '+23277111222',
        licenceExpiresOn: '2033-05-01',
      });

      // Dispatchers cannot read HR records but can see a minimal roster for assigning crew.
      await dispatcher.call('get', base).expect(403);
      await dispatcher
        .call('post', base)
        .send({ employeeNumber: uniq('E'), fullName: 'Nope Nope', role: 'DRIVER' })
        .expect(403);
      const roster = (await dispatcher.call('get', `/tenants/${tenantId}/crew/roster`).expect(200))
        .body.roster;
      expect(roster.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(roster)).not.toMatch(/phone|\+2327|hiredOn|employeeNumber/);
      void owner;
    });
  });

  describe('crew assignment rules', () => {
    it('enforces job role, licence validity, overlap and minimum rest, and releases on cancel', async () => {
      const { tenantId, owner } = await company('crew');
      const k = await kit(tenantId);
      const assign = (tripId: string, employeeId: string, role: 'DRIVER' | 'CONDUCTOR') =>
        owner.call('post', crewPath(tenantId, tripId)).send({ employeeId, role });

      await assign(k.t1.id, k.driverA.id, 'DRIVER').expect(204); // 08:00-10:00
      await assign(k.t1.id, k.driverA.id, 'DRIVER').expect(409); // already on this trip
      const overlap = await assign(k.t2.id, k.driverA.id, 'DRIVER').expect(409); // 09:00-11:00 overlaps
      expect(overlap.body.error.message).toMatch(/overlapping/i);
      const rest = await assign(k.t3.id, k.driverA.id, 'DRIVER').expect(409); // 12:00 is 2h after 10:00; default rest is 8h
      expect(rest.body.error.message).toMatch(/rest/i);

      // The rest rule is a per-company setting.
      await owner
        .call('patch', `/tenants/${tenantId}/profile`)
        .send({ crewMinRestMinutes: 60 })
        .expect(200);
      await assign(k.t3.id, k.driverA.id, 'DRIVER').expect(204);
      await owner
        .call('patch', `/tenants/${tenantId}/profile`)
        .send({ crewMinRestMinutes: 5000 })
        .expect(400);

      await assign(k.t4.id, k.driverExpired.id, 'DRIVER').expect(409); // licence expired before 2031-03-11
      await assign(k.t4.id, k.driverNoLicence.id, 'DRIVER').expect(409); // no licence at all
      await assign(k.t4.id, k.conductorC.id, 'DRIVER').expect(409); // wrong job role
      await assign(k.t4.id, k.mechanicM.id, 'CONDUCTOR').expect(409);
      await assign(k.t4.id, k.conductorC.id, 'CONDUCTOR').expect(204);
      await assign(k.t4.id, '00000000-0000-4000-8000-000000000000', 'DRIVER').expect(400);

      const crew = (await owner.call('get', crewPath(tenantId, k.t4.id)).expect(200)).body.crew;
      expect(crew).toEqual([
        expect.objectContaining({ employeeId: k.conductorC.id, role: 'CONDUCTOR' }),
      ]);

      // Releasing frees the slot; cancelling a trip releases its whole crew.
      await owner.call('delete', `${crewPath(tenantId, k.t1.id)}/${k.driverA.id}`).expect(204);
      await owner.call('delete', `${crewPath(tenantId, k.t1.id)}/${k.driverA.id}`).expect(404);
      await assign(k.t2.id, k.driverA.id, 'DRIVER').expect(204); // 09:00-11:00 now fits (t3 starts 12:00, 60 min rest)
      await owner
        .call('post', `/tenants/${tenantId}/trips/${k.t3.id}/status`)
        .send({ status: 'CANCELLED' })
        .expect(204);
      expect((await owner.call('get', crewPath(tenantId, k.t3.id)).expect(200)).body.crew).toEqual(
        [],
      );
      await assign(k.t3.id, k.driverA.id, 'DRIVER').expect(409); // cancelled trips are closed
    });

    it('lets exactly one of two concurrent overlapping assignments win', async () => {
      const { tenantId, owner } = await company('crewrace');
      const k = await kit(tenantId);
      const results = await Promise.all(
        [k.t5, k.t6].map((t) =>
          owner
            .call('post', crewPath(tenantId, t.id))
            .send({ employeeId: k.driverRace.id, role: 'DRIVER' }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
      const live = await plat((tx) =>
        tx.tripCrew.count({ where: { tenantId, employeeId: k.driverRace.id, releasedAt: null } }),
      );
      expect(live).toBe(1);
    });

    it('protects people with upcoming duty from being terminated, and refuses inactive crew', async () => {
      const { tenantId, owner } = await company('crewterm');
      const hr = await member(tenantId, 'hr_manager');
      const k = await kit(tenantId);
      await owner
        .call('post', crewPath(tenantId, k.t4.id))
        .send({ employeeId: k.driverA.id, role: 'DRIVER' })
        .expect(204);
      await hr
        .call('patch', `/tenants/${tenantId}/employees/${k.driverA.id}`)
        .send({ status: 'TERMINATED' })
        .expect(409);
      await owner.call('delete', `${crewPath(tenantId, k.t4.id)}/${k.driverA.id}`).expect(204);
      await hr
        .call('patch', `/tenants/${tenantId}/employees/${k.driverA.id}`)
        .send({ status: 'TERMINATED' })
        .expect(204);
      await owner
        .call('post', crewPath(tenantId, k.t4.id))
        .send({ employeeId: k.driverA.id, role: 'DRIVER' })
        .expect(409); // not active
      await hr
        .call('patch', `/tenants/${tenantId}/employees/${k.driverA.id}`)
        .send({ status: 'ACTIVE' })
        .expect(409); // no reinstatement
    });

    it('will not change crew on a completed trip', async () => {
      const { tenantId, owner } = await company('crewdone');
      const k = await kit(tenantId);
      await plat((tx) => tx.trip.update({ where: { id: k.t4.id }, data: { status: 'COMPLETED' } }));
      await owner
        .call('post', crewPath(tenantId, k.t4.id))
        .send({ employeeId: k.driverA.id, role: 'DRIVER' })
        .expect(409);
    });
  });

  describe('maintenance and documents', () => {
    it('runs the maintenance lifecycle with vehicle status, odometer and one-job-at-a-time rules', async () => {
      const { tenantId, owner } = await company('maint');
      const k = await kit(tenantId);
      const m = (p = '') => `/tenants/${tenantId}/maintenance${p}`;
      const job = (vehicleId: string, over: Record<string, unknown> = {}) =>
        owner.call('post', m()).send({
          vehicleId,
          kind: 'SERVICE',
          scheduledFor: '2031-03-01',
          description: 'Oil and filter change',
          ...over,
        });

      await job(k.v1.id, { description: 'x' }).expect(400);
      const first = await job(k.v1.id).expect(201);
      const second = await job(k.v1.id, { kind: 'INSPECTION' }).expect(201);

      // A vehicle with upcoming trips cannot go to the workshop.
      await plat((tx) => tx.trip.update({ where: { id: k.t4.id }, data: { vehicleId: k.v1.id } }));
      await owner
        .call('post', m(`/${first.body.id}/start`))
        .send({})
        .expect(409);
      await plat((tx) => tx.trip.update({ where: { id: k.t4.id }, data: { vehicleId: null } }));

      await owner
        .call('post', m(`/${first.body.id}/start`))
        .send({})
        .expect(204);
      expect(
        (await owner.call('get', `/tenants/${tenantId}/vehicles/${k.v1.id}`).expect(200)).body
          .status,
      ).toBe('MAINTENANCE');
      await owner
        .call('post', m(`/${first.body.id}/start`))
        .send({})
        .expect(409); // already started
      await owner
        .call('post', m(`/${second.body.id}/start`))
        .send({})
        .expect(409); // only one job at a time
      await owner
        .call('post', m(`/${first.body.id}/cancel`))
        .send({})
        .expect(409); // cannot cancel work in progress

      await plat((tx) =>
        tx.vehicle.update({ where: { id: k.v1.id }, data: { odometerKm: 50_000 } }),
      );
      await owner
        .call('post', m(`/${first.body.id}/complete`))
        .send({ odometerKm: 49_000 })
        .expect(409); // backwards
      await owner
        .call('post', m(`/${first.body.id}/complete`))
        .send({ odometerKm: 51_250, costMinor: 150_000 })
        .expect(204);
      const veh = (await owner.call('get', `/tenants/${tenantId}/vehicles/${k.v1.id}`).expect(200))
        .body;
      expect(veh).toMatchObject({ status: 'ACTIVE', odometerKm: 51_250 });
      const done = (
        await owner.call('get', m(`?vehicleId=${k.v1.id}&status=COMPLETED`)).expect(200)
      ).body.records[0];
      expect(done).toMatchObject({ costMinor: 150_000, odometerKm: 51_250 });
      expect(done.completedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      await owner
        .call('post', m(`/${first.body.id}/complete`))
        .send({})
        .expect(409); // already completed

      await owner
        .call('post', m(`/${second.body.id}/cancel`))
        .send({})
        .expect(204);
      await plat((tx) =>
        tx.vehicle.update({ where: { id: k.v2.id }, data: { status: 'RETIRED' } }),
      );
      await job(k.v2.id).expect(409); // retired vehicles are not scheduled
    });

    it('raises alerts for expiring documents, overdue jobs and (HR only) licences', async () => {
      const { tenantId, owner } = await company('alerts');
      const dispatcher = await member(tenantId, 'dispatcher');
      const k = await kit(tenantId);
      const day = (offset: number) =>
        new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      const doc = (kind: string, ref: string, offset: number) =>
        owner
          .call('post', `/tenants/${tenantId}/vehicle-documents`)
          .send({ vehicleId: k.v1.id, kind, referenceNo: ref, expiresOn: day(offset) });

      await doc('INSURANCE', 'POL-EXPIRED', -5).expect(201);
      const soon = await doc('ROAD_LICENCE', 'RL-SOON', 10).expect(201);
      await doc('INSPECTION_CERTIFICATE', 'IC-FAR', 200).expect(201);
      await owner
        .call('post', `/tenants/${tenantId}/vehicle-documents`)
        .send({ vehicleId: k.v1.id, kind: 'OTHER', referenceNo: 'BAD', expiresOn: '2031-02-30' })
        .expect(400);
      await owner
        .call('post', `/tenants/${tenantId}/maintenance`)
        .send({
          vehicleId: k.v1.id,
          kind: 'SERVICE',
          scheduledFor: day(-3),
          description: 'Overdue brake check',
        })
        .expect(201);
      await owner
        .call('post', `/tenants/${tenantId}/maintenance`)
        .send({
          vehicleId: k.v1.id,
          kind: 'SERVICE',
          scheduledFor: day(100),
          description: 'Far future service',
        })
        .expect(201);
      await plat((tx) =>
        tx.driverLicence.updateMany({
          where: { tenantId, employeeId: k.driverA.id },
          data: { expiresOn: new Date(day(20)) },
        }),
      );

      const a = (await owner.call('get', `/tenants/${tenantId}/fleet/alerts?days=30`).expect(200))
        .body;
      expect(a.documents.map((d: { referenceNo: string }) => d.referenceNo).sort()).toEqual([
        'POL-EXPIRED',
        'RL-SOON',
      ]);
      expect(
        a.documents.find((d: { referenceNo: string }) => d.referenceNo === 'POL-EXPIRED'),
      ).toMatchObject({ expired: true });
      expect(
        a.documents.find((d: { referenceNo: string }) => d.referenceNo === 'RL-SOON'),
      ).toMatchObject({ expired: false, daysLeft: expect.any(Number) });
      expect(a.maintenance).toEqual([expect.objectContaining({ overdue: true })]); // the far-future job is outside the window
      expect(a.licences.map((l: { employee: string }) => l.employee)).toEqual(['driverA Person']);

      // Dispatchers (fleet.read, no hr.read) get fleet alerts but no licence data.
      const d = (
        await dispatcher.call('get', `/tenants/${tenantId}/fleet/alerts?days=30`).expect(200)
      ).body;
      expect(d.documents).toHaveLength(2);
      expect(d.licences).toBeUndefined();

      await owner
        .call('delete', `/tenants/${tenantId}/vehicle-documents/${soon.body.id}`)
        .expect(204);
      await owner
        .call('delete', `/tenants/${tenantId}/vehicle-documents/${soon.body.id}`)
        .expect(404);
      await dispatcher
        .call('post', `/tenants/${tenantId}/vehicle-documents`)
        .send({ vehicleId: k.v1.id, kind: 'OTHER', referenceNo: 'NOPE', expiresOn: day(5) })
        .expect(403);
      await owner.call('get', `/tenants/${tenantId}/fleet/alerts?days=9999`).expect(400);
    });
  });

  describe('tenant isolation', () => {
    it("keeps one company's crew, maintenance and HR data invisible and unusable to another", async () => {
      const a = await company('iso-crew-a');
      const b = await company('iso-crew-b');
      const ka = await kit(a.tenantId);
      const kb = await kit(b.tenantId);
      const maintA = await a.owner
        .call('post', `/tenants/${a.tenantId}/maintenance`)
        .send({
          vehicleId: ka.v1.id,
          kind: 'SERVICE',
          scheduledFor: '2031-03-01',
          description: 'A private job',
        })
        .expect(201);

      await b.owner.call('get', `/tenants/${a.tenantId}/employees`).expect(404);
      await b.owner.call('get', `/tenants/${a.tenantId}/crew/roster`).expect(404);

      // B cannot crew its trips with A's people, or touch A's records through B's own scope.
      await b.owner
        .call('post', crewPath(b.tenantId, kb.t4.id))
        .send({ employeeId: ka.driverA.id, role: 'DRIVER' })
        .expect(400);
      await b.owner
        .call('post', crewPath(b.tenantId, ka.t4.id))
        .send({ employeeId: kb.driverA.id, role: 'DRIVER' })
        .expect(404);
      await b.owner
        .call('patch', `/tenants/${b.tenantId}/employees/${ka.driverA.id}`)
        .send({ fullName: 'Hijacked Name' })
        .expect(404);
      await b.owner
        .call('post', `/tenants/${b.tenantId}/maintenance/${maintA.body.id}/start`)
        .send({})
        .expect(404);
      await b.owner
        .call('post', `/tenants/${b.tenantId}/maintenance`)
        .send({
          vehicleId: ka.v1.id,
          kind: 'SERVICE',
          scheduledFor: '2031-03-01',
          description: 'Cross tenant',
        })
        .expect(400);
      await b.owner
        .call('post', `/tenants/${b.tenantId}/vehicle-documents`)
        .send({ vehicleId: ka.v1.id, kind: 'OTHER', referenceNo: 'X', expiresOn: '2032-01-01' })
        .expect(400);
      const bRoster = (await b.owner.call('get', `/tenants/${b.tenantId}/crew/roster`).expect(200))
        .body.roster;
      expect(bRoster.some((r: { id: string }) => r.id === ka.driverA.id)).toBe(false);
      expect(
        (await plat((tx) => tx.employee.findFirstOrThrow({ where: { id: ka.driverA.id } })))
          .fullName,
      ).toBe('driverA Person');
    });

    it('enforces integrity in the database itself (RLS, composite FKs, exclusion, partial uniqueness)', async () => {
      const a = await company('db-crew-a');
      const b = await company('db-crew-b');
      const ka = await kit(a.tenantId);
      const kb = await kit(b.tenantId);

      expect(await withDb(db, {}, (tx) => tx.employee.count())).toBe(0);
      expect(await withDb(db, {}, (tx) => tx.tripCrew.count())).toBe(0);
      expect(await withDb(db, {}, (tx) => tx.maintenanceRecord.count())).toBe(0);
      expect(await withDb(db, {}, (tx) => tx.vehicleDocument.count())).toBe(0);
      const seen = await withDb(db, { tenantId: a.tenantId }, (tx) => tx.employee.findMany());
      expect(seen.some((e) => e.tenantId !== a.tenantId)).toBe(false);

      // Cross-tenant references fail on the composite foreign keys, even in platform scope.
      await expect(
        plat((tx) =>
          tx.tripCrew.createMany({
            data: [
              {
                tenantId: b.tenantId,
                tripId: kb.t4.id,
                employeeId: ka.driverA.id,
                role: 'DRIVER',
                startsAt: at('2031-03-11', 8),
                endsAt: at('2031-03-11', 10),
              },
            ],
          }),
        ),
      ).rejects.toThrow();
      await expect(
        plat((tx) =>
          tx.maintenanceRecord.createMany({
            data: [
              {
                tenantId: b.tenantId,
                vehicleId: ka.v1.id,
                kind: 'SERVICE',
                scheduledFor: new Date('2031-03-01'),
                description: 'cross tenant',
              },
            ],
          }),
        ),
      ).rejects.toThrow();

      // Overlapping live duty is rejected by the exclusion constraint regardless of application code.
      await plat((tx) =>
        tx.tripCrew.createMany({
          data: [
            {
              tenantId: a.tenantId,
              tripId: ka.t5.id,
              employeeId: ka.driverA.id,
              role: 'DRIVER',
              startsAt: at('2031-03-12', 8),
              endsAt: at('2031-03-12', 10),
            },
          ],
        }),
      );
      await expect(
        plat((tx) =>
          tx.tripCrew.createMany({
            data: [
              {
                tenantId: a.tenantId,
                tripId: ka.t6.id,
                employeeId: ka.driverA.id,
                role: 'DRIVER',
                startsAt: at('2031-03-12', 9),
                endsAt: at('2031-03-12', 11),
              },
            ],
          }),
        ),
      ).rejects.toThrow();
      // ...but a released assignment no longer counts.
      await plat((tx) =>
        tx.tripCrew.updateMany({
          where: { tenantId: a.tenantId, tripId: ka.t5.id },
          data: { releasedAt: new Date() },
        }),
      );
      await plat((tx) =>
        tx.tripCrew.createMany({
          data: [
            {
              tenantId: a.tenantId,
              tripId: ka.t6.id,
              employeeId: ka.driverA.id,
              role: 'DRIVER',
              startsAt: at('2031-03-12', 9),
              endsAt: at('2031-03-12', 11),
            },
          ],
        }),
      );

      // CHECK and partial-unique rules.
      await expect(
        plat((tx) =>
          tx.tripCrew.createMany({
            data: [
              {
                tenantId: a.tenantId,
                tripId: ka.t4.id,
                employeeId: ka.driverRace.id,
                role: 'DRIVER',
                startsAt: at('2031-03-11', 10),
                endsAt: at('2031-03-11', 8),
              },
            ],
          }),
        ),
      ).rejects.toThrow();
      await plat((tx) =>
        tx.maintenanceRecord.createMany({
          data: [
            {
              tenantId: a.tenantId,
              vehicleId: ka.v1.id,
              kind: 'REPAIR',
              status: 'IN_PROGRESS',
              scheduledFor: new Date('2031-03-01'),
              description: 'job one',
            },
          ],
        }),
      );
      await expect(
        plat((tx) =>
          tx.maintenanceRecord.createMany({
            data: [
              {
                tenantId: a.tenantId,
                vehicleId: ka.v1.id,
                kind: 'REPAIR',
                status: 'IN_PROGRESS',
                scheduledFor: new Date('2031-03-02'),
                description: 'job two',
              },
            ],
          }),
        ),
      ).rejects.toThrow();
      await expect(
        plat((tx) =>
          tx.maintenanceRecord.createMany({
            data: [
              {
                tenantId: a.tenantId,
                vehicleId: ka.v2.id,
                kind: 'REPAIR',
                status: 'COMPLETED',
                scheduledFor: new Date('2031-03-01'),
                description: 'no completion date',
              },
            ],
          }),
        ),
      ).rejects.toThrow();
    });
  });
});
