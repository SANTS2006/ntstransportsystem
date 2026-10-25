/**
 * Realistic test data for every feature: one complete transport company, "Sierra Express
 * Coaches" (/sierra-express), with staff in every role, customers, a network of Sierra Leone
 * routes, a fleet, schedules, three weeks of trips, bookings, payments, tickets, boarding, crews,
 * licences, vehicle papers, maintenance, complaints, ratings, job postings and applications.
 *
 * - Test database by default (TEST_DATABASE_URL). The main database only with `--db main --yes`.
 * - Runs once: if the company already exists it stops and changes nothing.
 * - Passwords are generated and written to `.test-data.<test|main>.json` (git-ignored), never printed.
 * - Mail addresses use the reserved `.test` domain, so nothing is ever delivered to a real person.
 *
 *   npx tsx scripts/seed-test-data.ts                 (test database)
 *   npx tsx scripts/seed-test-data.ts --db main --yes (main database)
 */
/* eslint-disable no-console -- operator CLI */
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '../src/config/dotenv.js';
import { hashPassword } from '../src/platform/crypto.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { createDb, withDb, type Tx } from '../src/platform/db.js';
import { TenantService } from '../src/modules/tenants/tenant.service.js';
import { newTicketCode } from '../src/modules/ticket/ticket-core.js';

const args = process.argv.slice(2);
const target = args.includes('--db') ? args[args.indexOf('--db') + 1] : 'test';
if (target !== 'test' && target !== 'main') {
  console.error('Use --db test (default) or --db main.');
  process.exit(2);
}
if (target === 'main' && !args.includes('--yes')) {
  console.error('Seeding the main database needs --yes as well, to be sure it is meant.');
  process.exit(2);
}
const url = target === 'main' ? process.env.DATABASE_URL : process.env.TEST_DATABASE_URL;
if (!url) {
  console.error(`${target === 'main' ? 'DATABASE_URL' : 'TEST_DATABASE_URL'} is not set.`);
  process.exit(2);
}

const db = createDb(url);
const SLUG = 'sierra-express';
const DOMAIN = 'sierraexpress.test';
const DAY = 86_400_000;
const tz = 'Africa/Freetown'; // UTC all year, so times below are local times too

const exists = await withDb(db, { platform: true }, (tx) =>
  tx.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } }),
);
if (exists) {
  console.log(`"${SLUG}" already exists on the ${target} database. Nothing was changed.`);
  await db.$disconnect();
  process.exit(0);
}

const credentials: Record<string, { name: string; email: string; password: string; role: string }> =
  {};
const password = () =>
  `Test-${randomBytes(6).toString('base64url')}-${randomBytes(2).toString('hex')}`;
const at = (day: number, hh: number, mm = 0) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + day * DAY + (hh * 60 + mm) * 60_000);
};
const dateOnly = (d: Date) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
let seq = 0;
const ref = () =>
  `SE${Date.now().toString(36).slice(-4).toUpperCase()}${String(++seq).padStart(4, '0')}`;

// ---- People -----------------------------------------------------------------------------------
interface Person {
  key: string;
  name: string;
  phone: string;
  role: string; // the company role key, or 'customer'
  job?: 'DRIVER' | 'CONDUCTOR' | 'DISPATCHER' | 'MECHANIC' | 'OTHER';
}
const PEOPLE: Person[] = [
  { key: 'owner', name: 'Mohamed Kamara', phone: '+23276100101', role: 'owner' },
  { key: 'admin', name: 'Fatmata Sesay', phone: '+23277100102', role: 'admin' },
  {
    key: 'dispatcher',
    name: 'Ibrahim Conteh',
    phone: '+23278100103',
    role: 'dispatcher',
    job: 'DISPATCHER',
  },
  {
    key: 'sales',
    name: 'Aminata Bangura',
    phone: '+23279100104',
    role: 'sales_agent',
    job: 'OTHER',
  },
  {
    key: 'finance',
    name: 'Abu Bakarr Jalloh',
    phone: '+23230100105',
    role: 'finance_officer',
    job: 'OTHER',
  },
  { key: 'hr', name: 'Isatu Koroma', phone: '+23231100106', role: 'hr_manager', job: 'OTHER' },
  { key: 'auditor', name: 'Joseph Lahai', phone: '+23232100107', role: 'auditor', job: 'OTHER' },
  { key: 'driver1', name: 'Sorie Turay', phone: '+23233100108', role: 'driver', job: 'DRIVER' },
  { key: 'driver2', name: 'Alhaji Mansaray', phone: '+23234100109', role: 'driver', job: 'DRIVER' },
  { key: 'driver3', name: 'Musa Kargbo', phone: '+23276100110', role: 'driver', job: 'DRIVER' },
  {
    key: 'conductor1',
    name: 'Hawa Fofanah',
    phone: '+23277100111',
    role: 'driver',
    job: 'CONDUCTOR',
  },
  {
    key: 'conductor2',
    name: 'Kadiatu Barrie',
    phone: '+23278100112',
    role: 'driver',
    job: 'CONDUCTOR',
  },
  {
    key: 'mechanic',
    name: 'Christian Cole',
    phone: '+23279100113',
    role: 'auditor',
    job: 'MECHANIC',
  },
  { key: 'pax1', name: 'Mariama Kanu', phone: '+23276200201', role: 'customer' },
  { key: 'pax2', name: 'Zainab Sankoh', phone: '+23277200202', role: 'customer' },
  { key: 'pax3', name: 'Emmanuel Williams', phone: '+23278200203', role: 'customer' },
  { key: 'pax4', name: 'Adama Kallon', phone: '+23279200204', role: 'customer' },
  { key: 'pax5', name: 'Samuel Thomas', phone: '+23230200205', role: 'customer' },
  { key: 'pax6', name: 'Rugiatu Bah', phone: '+23231200206', role: 'customer' },
];

console.log(
  `Seeding "${SLUG}" on the ${target} database. This takes a few minutes on a slow link…`,
);

// Accounts first (password hashing is slow; do it outside any transaction).
const hashed = new Map<string, { pw: string; hash: string }>();
for (const p of PEOPLE) {
  const pw = password();
  hashed.set(p.key, { pw, hash: await hashPassword(pw) });
}

/** One short transaction per step: a slow link must never hold one transaction for minutes. */
const step = <T>(label: string, fn: (tx: Tx) => Promise<T>) => {
  console.log(`  ${label}…`);
  return withDb(db, { platform: true }, fn, { timeoutMs: 300_000 });
};
const id = () => randomUUID();

let tenantId = '';
try {
  // ---- Company, people, staff records -------------------------------------------------------
  const users = new Map(PEOPLE.map((p) => [p.key, id()] as const));
  const employees = new Map<string, string>();
  await step('company and people', async (tx) => {
    const t = await tx.tenant.create({
      data: { name: 'Sierra Express Coaches', slug: SLUG, status: 'ACTIVE', timezone: tz },
    });
    tenantId = t.id;
    await TenantService.seedRoles(tx, tenantId);
    await tx.tenantBranding.create({
      data: { tenantId, primaryColor: '#0b6e4f', accentColor: '#f59e0b' },
    });
    const roles = new Map(
      (await tx.role.findMany({ where: { tenantId } })).map((r) => [r.key, r.id] as const),
    );
    await tx.user.createMany({
      data: PEOPLE.map((p) => ({
        id: users.get(p.key)!,
        email: `${p.key}@${DOMAIN}`,
        phone: p.phone,
        phoneVerifiedAt: new Date(),
        displayName: p.name,
        emailVerifiedAt: new Date(),
        passwordHash: hashed.get(p.key)!.hash,
        homeTenantId: tenantId,
      })),
    });
    const memberships = PEOPLE.filter((p) => p.role !== 'customer').map((p) => ({
      id: id(),
      tenantId,
      userId: users.get(p.key)!,
      roleId: roles.get(p.role)!,
      status: 'ACTIVE' as const,
    }));
    await tx.membership.createMany({ data: memberships });
    // The owner can also switch to working as a dispatcher.
    const owner = memberships.find((m) => m.userId === users.get('owner'))!;
    await tx.membershipRole.createMany({
      data: [{ tenantId, membershipId: owner.id, roleId: roles.get('dispatcher')! }],
      skipDuplicates: true,
    });
    const staff = PEOPLE.filter((p) => p.job);
    staff.forEach((p) => employees.set(p.key, id()));
    await tx.employee.createMany({
      data: staff.map((p, i) => ({
        id: employees.get(p.key)!,
        tenantId,
        userId: users.get(p.key)!,
        employeeNumber: `SE-${String(i + 1).padStart(3, '0')}`,
        fullName: p.name,
        role: p.job!,
        phone: p.phone,
        hiredOn: dateOnly(at(-400 + i * 25, 0)),
      })),
    });
    await tx.driverLicence.createMany({
      data: [
        {
          tenantId,
          employeeId: employees.get('driver1')!,
          licenceNumber: 'SL-DL-204118',
          category: 'D',
          expiresOn: dateOnly(at(420, 0)),
        },
        {
          tenantId,
          employeeId: employees.get('driver2')!,
          licenceNumber: 'SL-DL-198342',
          category: 'D',
          expiresOn: dateOnly(at(12, 0)),
        },
        {
          tenantId,
          employeeId: employees.get('driver3')!,
          licenceNumber: 'SL-DL-177509',
          category: 'D',
          expiresOn: dateOnly(at(260, 0)),
        },
      ],
    });
  });
  for (const p of PEOPLE) {
    credentials[p.key] = {
      name: p.name,
      email: `${p.key}@${DOMAIN}`,
      password: hashed.get(p.key)!.pw,
      role: p.role === 'customer' ? 'passenger (customer)' : p.role,
    };
  }

  // ---- Network and fleet --------------------------------------------------------------------
  const L = {
    freetown: id(),
    waterloo: id(),
    masiaka: id(),
    bo: id(),
    kenema: id(),
    makeni: id(),
    koidu: id(),
  };
  const R = {
    bo: {
      id: id(),
      name: 'Freetown - Bo',
      from: L.freetown,
      to: L.bo,
      km: 250,
      min: 300,
      fare: 25_000,
    },
    kenema: {
      id: id(),
      name: 'Freetown - Kenema',
      from: L.freetown,
      to: L.kenema,
      km: 320,
      min: 390,
      fare: 32_000,
    },
    makeni: {
      id: id(),
      name: 'Freetown - Makeni',
      from: L.freetown,
      to: L.makeni,
      km: 190,
      min: 210,
      fare: 18_000,
    },
    boKenema: {
      id: id(),
      name: 'Bo - Kenema',
      from: L.bo,
      to: L.kenema,
      km: 70,
      min: 90,
      fare: 8_000,
    },
    koidu: {
      id: id(),
      name: 'Freetown - Koidu',
      from: L.freetown,
      to: L.koidu,
      km: 330,
      min: 420,
      fare: 35_000,
    },
  };
  type RouteRow = (typeof R)[keyof typeof R];
  const V = Array.from({ length: 7 }, () => id());
  const layoutId = id();
  await step('network and fleet', async (tx) => {
    await tx.location.createMany({
      data: [
        {
          id: L.freetown,
          tenantId,
          name: 'Freetown Central Terminal',
          city: 'Freetown',
          kind: 'TERMINAL',
          address: 'Wallace Johnson Street, Freetown',
        },
        {
          id: L.waterloo,
          tenantId,
          name: 'Waterloo Lorry Park',
          city: 'Waterloo',
          kind: 'STOP',
          address: 'Main Motor Road, Waterloo',
        },
        {
          id: L.masiaka,
          tenantId,
          name: 'Masiaka Junction',
          city: 'Masiaka',
          kind: 'STOP',
          address: 'Masiaka-Bo Highway',
        },
        {
          id: L.bo,
          tenantId,
          name: 'Bo Terminal',
          city: 'Bo',
          kind: 'TERMINAL',
          address: 'Bojon Street, Bo',
        },
        {
          id: L.kenema,
          tenantId,
          name: 'Kenema Terminal',
          city: 'Kenema',
          kind: 'TERMINAL',
          address: 'Hangha Road, Kenema',
        },
        {
          id: L.makeni,
          tenantId,
          name: 'Makeni Terminal',
          city: 'Makeni',
          kind: 'TERMINAL',
          address: 'Azzolini Highway, Makeni',
        },
        {
          id: L.koidu,
          tenantId,
          name: 'Koidu Terminal',
          city: 'Koidu',
          kind: 'TERMINAL',
          address: 'Main Street, Koidu Town',
        },
      ],
    });
    await tx.route.createMany({
      data: Object.values(R).map((r) => ({
        id: r.id,
        tenantId,
        name: r.name,
        originId: r.from,
        destinationId: r.to,
        distanceM: r.km * 1000,
        durationMin: r.min,
        status: 'PUBLISHED' as const,
        allowedVehicleTypes: ['BUS' as const, 'MINIBUS' as const],
      })),
    });
    await tx.fare.createMany({
      data: Object.values(R).map((r) => ({
        tenantId,
        routeId: r.id,
        amountMinor: r.fare,
        currency: 'SLE',
      })),
    });
    await tx.routeStop.createMany({
      data: [
        { tenantId, routeId: R.kenema.id, locationId: L.waterloo, sequence: 1, offsetMin: 35 },
        { tenantId, routeId: R.kenema.id, locationId: L.masiaka, sequence: 2, offsetMin: 95 },
        { tenantId, routeId: R.kenema.id, locationId: L.bo, sequence: 3, offsetMin: 300 },
      ],
    });
    await tx.stopFare.createMany({
      data: [
        {
          tenantId,
          routeId: R.kenema.id,
          fromLocationId: L.freetown,
          toLocationId: L.waterloo,
          amountMinor: 3_000,
        },
        {
          tenantId,
          routeId: R.kenema.id,
          fromLocationId: L.freetown,
          toLocationId: L.masiaka,
          amountMinor: 8_000,
        },
        {
          tenantId,
          routeId: R.kenema.id,
          fromLocationId: L.freetown,
          toLocationId: L.bo,
          amountMinor: 25_000,
        },
        {
          tenantId,
          routeId: R.kenema.id,
          fromLocationId: L.bo,
          toLocationId: L.kenema,
          amountMinor: 8_000,
        },
      ],
    });
    await tx.serviceBlackout.create({
      data: {
        tenantId,
        routeId: R.koidu.id,
        startsOn: dateOnly(at(24, 0)),
        endsOn: dateOnly(at(26, 0)),
        reason: 'Bridge repairs on the Koidu highway',
      },
    });
    await tx.seatLayout.create({
      data: { id: layoutId, tenantId, name: 'Coaster 2+2 (30 seats)' },
    });
    await tx.seatLayoutSeat.createMany({
      data: Array.from({ length: 30 }, (_, k) => ({
        tenantId,
        layoutId,
        label: String(k + 1),
        rowNo: Math.ceil((k + 1) / 4),
        colNo: (k % 4) + 1,
        accessible: k < 2,
      })),
    });
    const fleet = [
      ['AKV 512', 'Express 1', 'Toyota', 'Coaster', 2019],
      ['AKV 513', 'Express 2', 'Toyota', 'Coaster', 2020],
      ['AMB 220', 'Express 3', 'Nissan', 'Civilian', 2018],
      ['AMB 221', 'Express 4', 'Nissan', 'Civilian', 2021],
      ['APD 734', 'Express 5', 'Mitsubishi', 'Rosa', 2017],
      ['APD 735', 'Express 6', 'Mitsubishi', 'Rosa', 2022],
      ['ARX 108', 'Express 7', 'Toyota', 'Coaster', 2016],
    ] as const;
    await tx.vehicle.createMany({
      data: fleet.map(([registration, label, make, model, year], k) => ({
        id: V[k]!,
        tenantId,
        registration,
        label,
        type: 'BUS' as const,
        make,
        model,
        year,
        seatingCapacity: 30,
        seatLayoutId: layoutId,
        odometerKm: 48_000 + k * 9_350,
        status: k === 6 ? ('MAINTENANCE' as const) : ('ACTIVE' as const),
      })),
    });
    await tx.vehicleDocument.createMany({
      data: [
        {
          tenantId,
          vehicleId: V[0]!,
          kind: 'INSURANCE',
          referenceNo: 'NIC-INS-55210',
          expiresOn: dateOnly(at(200, 0)),
        },
        {
          tenantId,
          vehicleId: V[0]!,
          kind: 'ROAD_LICENCE',
          referenceNo: 'SLRSA-RL-88412',
          expiresOn: dateOnly(at(9, 0)),
        },
        {
          tenantId,
          vehicleId: V[1]!,
          kind: 'INSURANCE',
          referenceNo: 'NIC-INS-55211',
          expiresOn: dateOnly(at(150, 0)),
        },
        {
          tenantId,
          vehicleId: V[2]!,
          kind: 'INSPECTION_CERTIFICATE',
          referenceNo: 'SLRSA-IC-30177',
          expiresOn: dateOnly(at(-3, 0)),
        },
        {
          tenantId,
          vehicleId: V[3]!,
          kind: 'ROAD_LICENCE',
          referenceNo: 'SLRSA-RL-88413',
          expiresOn: dateOnly(at(300, 0)),
        },
      ],
    });
    await tx.maintenanceRecord.createMany({
      data: [
        {
          tenantId,
          vehicleId: V[0]!,
          kind: 'SERVICE',
          status: 'COMPLETED',
          scheduledFor: dateOnly(at(-20, 0)),
          completedOn: dateOnly(at(-19, 0)),
          description: '10,000 km service: oil, filters, brake check',
          vendor: 'Kissy Motors',
          odometerKm: 74_000,
          costMinor: 450_000,
        },
        {
          tenantId,
          vehicleId: V[6]!,
          kind: 'REPAIR',
          status: 'IN_PROGRESS',
          scheduledFor: dateOnly(at(-2, 0)),
          description: 'Gearbox repair after breakdown at Masiaka',
          vendor: 'Wellington Auto Works',
          costMinor: 1_200_000,
        },
        {
          tenantId,
          vehicleId: V[2]!,
          kind: 'INSPECTION',
          status: 'SCHEDULED',
          scheduledFor: dateOnly(at(-1, 0)),
          description: 'Annual roadworthiness inspection (overdue)',
          vendor: 'SLRSA Kissy',
        },
        {
          tenantId,
          vehicleId: V[4]!,
          kind: 'SERVICE',
          status: 'SCHEDULED',
          scheduledFor: dateOnly(at(6, 0)),
          description: 'Tyre rotation and wheel alignment',
          vendor: 'Kissy Motors',
        },
      ],
    });
  });

  // ---- Schedules, three weeks of trips and crews ---------------------------------------------
  const plan = [
    { r: R.bo, time: '07:00', h: 7, m: 0, vehicle: V[0]! },
    { r: R.kenema, time: '06:30', h: 6, m: 30, vehicle: V[1]! },
    { r: R.makeni, time: '08:00', h: 8, m: 0, vehicle: V[2]! },
    { r: R.bo, time: '14:00', h: 14, m: 0, vehicle: V[3]! },
    { r: R.makeni, time: '15:00', h: 15, m: 0, vehicle: V[4]! },
    { r: R.koidu, time: '07:30', h: 7, m: 30, vehicle: V[5]! },
  ];
  interface TripRow {
    id: string;
    dep: Date;
    arr: Date;
    r: RouteRow;
    status: 'SCHEDULED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';
  }
  const trips: TripRow[] = [];
  await step('schedules, trips and crews', async (tx) => {
    const schedules = plan.map((p) => ({ ...p, sid: id() }));
    await tx.schedule.createMany({
      data: schedules.map((p) => ({
        id: p.sid,
        tenantId,
        routeId: p.r.id,
        departureTime: p.time,
        daysOfWeek: 127,
        validFrom: dateOnly(at(-7, 0)),
        defaultVehicleId: p.vehicle,
      })),
    });
    const rows = [];
    for (const p of schedules) {
      for (let d = -7; d <= 14; d++) {
        const dep = at(d, p.h, p.m);
        const arr = new Date(dep.getTime() + p.r.min * 60_000);
        const cancelled = d === 3 && p.r === R.makeni && p.h === 15;
        const status: TripRow['status'] = cancelled
          ? 'CANCELLED'
          : arr.getTime() < Date.now()
            ? 'COMPLETED'
            : dep.getTime() < Date.now()
              ? 'IN_TRANSIT'
              : 'SCHEDULED';
        const t: TripRow = { id: id(), dep, arr, r: p.r, status };
        trips.push(t);
        rows.push({
          id: t.id,
          tenantId,
          scheduleId: p.sid,
          routeId: p.r.id,
          serviceDate: dateOnly(dep),
          departureAt: dep,
          arrivalAt: arr,
          vehicleId: p.vehicle,
          status,
          delayMinutes: d === 0 && p.r === R.kenema ? 25 : 0,
        });
      }
    }
    await tx.trip.createMany({ data: rows });
    const crew = [];
    const drivers = ['driver1', 'driver2', 'driver3'];
    const conductors = ['conductor1', 'conductor2'];
    for (let d = 0; d <= 2; d++) {
      const day = trips
        .filter(
          (t) =>
            dateOnly(t.dep).getTime() === dateOnly(at(d, 0)).getTime() && t.status !== 'CANCELLED',
        )
        .sort((a, b) => a.dep.getTime() - b.dep.getTime())
        .slice(0, 3);
      for (const [i, t] of day.entries()) {
        crew.push({
          tenantId,
          tripId: t.id,
          employeeId: employees.get(drivers[i]!)!,
          role: 'DRIVER' as const,
          startsAt: t.dep,
          endsAt: t.arr,
        });
        if (conductors[i]) {
          crew.push({
            tenantId,
            tripId: t.id,
            employeeId: employees.get(conductors[i]!)!,
            role: 'CONDUCTOR' as const,
            startsAt: t.dep,
            endsAt: t.arr,
          });
        }
      }
    }
    await tx.tripCrew.createMany({ data: crew });
  });

  // ---- Bookings, payments, tickets and boarding ----------------------------------------------
  const customers = ['pax1', 'pax2', 'pax3', 'pax4', 'pax5', 'pax6'];
  const methods = ['CASH', 'ORANGE_MONEY', 'AFRIMONEY', 'QMONEY', 'CASH', 'MOBILE_MONEY'];
  const bookings: Prisma.BookingCreateManyInput[] = [];
  const passengers: Prisma.BookingPassengerCreateManyInput[] = [];
  const history: Prisma.BookingStatusHistoryCreateManyInput[] = [];
  const payments: Prisma.PaymentCreateManyInput[] = [];
  const tickets: Prisma.TicketCreateManyInput[] = [];
  const completed: { id: string; tripId: string; userId: string }[] = [];
  for (const [ti, t] of trips.entries()) {
    if (t.status === 'CANCELLED') continue;
    const count = ti % 3 === 0 ? 3 : ti % 3 === 1 ? 2 : 1;
    let seat = 1;
    for (let k = 0; k < count; k++) {
      const who = customers[(ti + k) % customers.length]!;
      const person = PEOPLE.find((p) => p.key === who)!;
      const seatsHere = (ti + k) % 4 === 0 ? 2 : 1;
      const future = t.dep.getTime() > Date.now();
      const pending = future && (ti + k) % 7 === 0;
      const cancelled = !pending && (ti + k) % 11 === 0;
      const status = pending ? 'PENDING_PAYMENT' : cancelled ? 'CANCELLED' : 'CONFIRMED';
      const bookingId = id();
      const total = t.r.fare * seatsHere;
      bookings.push({
        id: bookingId,
        tenantId,
        tripId: t.id,
        reference: ref(),
        status,
        contactName: person.name,
        contactPhone: person.phone,
        contactEmail: `${who}@${DOMAIN}`,
        totalMinor: total,
        currency: 'SLE',
        createdByUserId: users.get(who)!,
        holdExpiresAt: pending ? new Date(Date.now() + 2 * 3_600_000) : null,
      });
      const names = [person.name];
      if (seatsHere === 2) names.push(`${person.name.split(' ')[0]} (companion)`);
      for (const fullName of names) {
        const passengerId = id();
        const seatLabel = String(seat++);
        passengers.push({
          id: passengerId,
          tenantId,
          bookingId,
          tripId: t.id,
          seatLabel,
          fullName,
          fareMinor: t.r.fare,
          releasedAt: cancelled ? new Date() : null,
        });
        if (status === 'CONFIRMED') {
          const boarded = t.status === 'COMPLETED';
          tickets.push({
            tenantId,
            bookingId,
            passengerId,
            tripId: t.id,
            seatLabel,
            passengerName: fullName,
            code: newTicketCode(),
            ...(boarded
              ? {
                  status: 'BOARDED' as const,
                  boardedAt: t.dep,
                  boardedByUserId: users.get('conductor1')!,
                }
              : {}),
          });
        }
      }
      history.push({ tenantId, bookingId, fromStatus: null, toStatus: 'PENDING_PAYMENT' });
      if (status !== 'PENDING_PAYMENT') {
        history.push({
          tenantId,
          bookingId,
          fromStatus: 'PENDING_PAYMENT',
          toStatus: status,
          reason: cancelled ? 'Cancelled by the passenger' : 'Paid',
        });
      }
      if (status === 'CONFIRMED') {
        const method = methods[(ti + k) % methods.length]!;
        payments.push({
          tenantId,
          bookingId,
          provider: 'DESK',
          status: 'PAID',
          amountMinor: total,
          currency: 'SLE',
          idempotencyKey: `seed:${bookingId}`,
          paidAt: new Date(Math.min(Date.now(), t.dep.getTime() - 3_600_000)),
          method,
          collectedBy: users.get('sales')!,
          reference: method === 'CASH' ? null : `TX${randomBytes(4).toString('hex').toUpperCase()}`,
        });
        if (t.status === 'COMPLETED')
          completed.push({ id: bookingId, tripId: t.id, userId: users.get(who)! });
      }
    }
  }
  await step(`${bookings.length} bookings with payments and tickets`, async (tx) => {
    await tx.booking.createMany({ data: bookings });
    await tx.bookingPassenger.createMany({ data: passengers });
    await tx.bookingStatusHistory.createMany({ data: history });
    await tx.payment.createMany({ data: payments });
    await tx.ticket.createMany({ data: tickets });
  });

  // ---- Complaints, ratings and recruitment ----------------------------------------------------
  await step('complaints, ratings and recruitment', async (tx) => {
    const staffId = users.get('admin')!;
    const cases = [
      {
        category: 'DELAY' as const,
        subject: 'Bus left Freetown 90 minutes late',
        first:
          'We waited at the terminal from 7am and the bus only left at 8:30. Nobody told us why.',
        reply: null,
        status: 'OPEN' as const,
      },
      {
        category: 'VEHICLE' as const,
        subject: 'Air conditioning not working',
        first: 'The air conditioning was broken for the whole trip to Bo.',
        reply: 'Thank you for telling us. The bus has been booked in for repair this week.',
        status: 'IN_REVIEW' as const,
      },
      {
        category: 'STAFF_CONDUCT' as const,
        subject: 'Conductor was very helpful',
        first: 'Just to say the conductor helped my mother with her bags at every stop. Thank you.',
        reply: 'Thank you, we have passed your kind words on to the crew.',
        status: 'RESOLVED' as const,
      },
    ];
    for (const [i, c] of cases.entries()) {
      const b = completed[i];
      if (!b) break;
      const complaintId = id();
      await tx.complaint.create({
        data: {
          id: complaintId,
          tenantId,
          bookingId: b.id,
          userId: b.userId,
          category: c.category,
          subject: c.subject,
          status: c.status,
          resolvedAt: c.status === 'RESOLVED' ? new Date() : null,
        },
      });
      await tx.complaintMessage.createMany({
        data: [
          { tenantId, complaintId, authorId: b.userId, authorKind: 'PASSENGER', body: c.first },
          ...(c.reply
            ? [
                {
                  tenantId,
                  complaintId,
                  authorId: staffId,
                  authorKind: 'STAFF' as const,
                  body: c.reply,
                },
              ]
            : []),
        ],
      });
    }
    const comments = [
      'Smooth trip and on time.',
      'Good driver, clean bus.',
      'A bit crowded at Masiaka but fine.',
      'Comfortable seats, will travel again.',
      null,
      'Late again, please improve.',
    ];
    await tx.tripRating.createMany({
      data: completed.slice(3, 9).map((b, i) => ({
        tenantId,
        bookingId: b.id,
        tripId: b.tripId,
        userId: b.userId,
        rating: [5, 4, 3, 5, 4, 2][i] ?? 4,
        comment: comments[i] ?? null,
      })),
    });
    const jDriver = id();
    const jMech = id();
    await tx.jobPosting.createMany({
      data: [
        {
          id: jDriver,
          tenantId,
          title: 'Long-distance coach driver',
          jobRole: 'DRIVER',
          description:
            'Drive our Freetown - Bo and Freetown - Kenema services. Class D licence and 3 years of coach experience required.',
          location: 'Freetown',
          status: 'OPEN',
          closesOn: dateOnly(at(21, 0)),
          createdBy: users.get('hr')!,
        },
        {
          id: jMech,
          tenantId,
          title: 'Workshop mechanic',
          jobRole: 'MECHANIC',
          description:
            'Service and repair Toyota Coaster and Nissan Civilian buses at our Wellington depot.',
          location: 'Freetown',
          status: 'OPEN',
          closesOn: dateOnly(at(30, 0)),
          createdBy: users.get('hr')!,
        },
        {
          tenantId,
          title: 'Bus conductor',
          jobRole: 'CONDUCTOR',
          description: 'Sell tickets on board and look after passengers on the Makeni route.',
          location: 'Makeni',
          status: 'CLOSED',
          closesOn: dateOnly(at(-5, 0)),
          createdBy: users.get('hr')!,
        },
      ],
    });
    await tx.jobApplication.createMany({
      data: [
        {
          tenantId,
          jobId: jDriver,
          userId: users.get('pax3')!,
          fullName: 'Emmanuel Williams',
          phone: '+23278200203',
          experience: 'Five years driving minibuses between Freetown and Makeni; clean record.',
          licenceNumber: 'SL-DL-221904',
          status: 'SHORTLISTED',
        },
        {
          tenantId,
          jobId: jMech,
          userId: users.get('pax5')!,
          fullName: 'Samuel Thomas',
          phone: '+23230200205',
          experience:
            'Trained at the Government Technical Institute, Kissy; two years at a Toyota workshop.',
          status: 'SUBMITTED',
        },
      ],
    });
  });

  const file = resolve(import.meta.dirname, `../../../.test-data.${target}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        note: `Test accounts for Sierra Express Coaches on the ${target} database. Git-ignored; do not share.`,
        signIn: `/${SLUG}/login`,
        accounts: credentials,
      },
      null,
      2,
    ),
  );
  console.log(
    `Done: Sierra Express Coaches (/${SLUG}) with ${PEOPLE.length} accounts, ${trips.length} trips, ${bookings.length} bookings and ${tickets.length} tickets.`,
  );
  console.log(
    `Sign-in details are in .test-data.${target}.json at the project root (git-ignored).`,
  );
} catch (err) {
  // Leave nothing half made: the company (and everything under it) and its test accounts go.
  console.error('Seeding failed; removing what was created so it can simply be run again.');
  await withDb(db, { platform: true }, async (tx) => {
    if (tenantId) await tx.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await tx.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  }).catch((e: unknown) => console.error('Clean-up also failed:', (e as Error).message));
  throw err;
} finally {
  await db.$disconnect();
}
