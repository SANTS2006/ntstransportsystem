import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BookingService } from '../src/modules/booking/booking.service.js';
import { NotificationService } from '../src/modules/notifications/notification.service.js';
import { withDb, type Db, type Tx } from '../src/platform/db.js';
import { OutboxProcessor } from '../src/platform/outbox.js';
import {
  CaptureMailer,
  createDb,
  createTenantWithOwner,
  loginClient,
  makeApp,
  newClient,
  TEST_DB_URL,
  uniq,
  type Client,
} from './helpers.js';

describe.skipIf(!TEST_DB_URL)('complaints and trip ratings (database)', () => {
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

  /** A company with a trip, a PAID booking owned by `pax`, and an unpaid one. */
  async function setup(label: string) {
    const t = await createTenantWithOwner(db, label);
    const tenantId = t.tenant.id;
    const owner = await loginClient(ctx.app, db, t.email, t.password);
    const pax = await newClient(ctx.app, db, 'cmp-pax');
    const trip = await plat(async (tx) => {
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
          durationMin: 60,
          status: 'PUBLISHED',
        },
      });
      await tx.fare.create({ data: { tenantId, routeId: route.id, amountMinor: 20_000 } });
      const v = await tx.vehicle.create({
        data: {
          tenantId,
          registration: uniq('CP').toUpperCase(),
          seatingCapacity: 12,
          type: 'BUS',
        },
      });
      const dep = new Date(Date.now() + 86_400_000);
      return tx.trip.create({
        data: {
          tenantId,
          routeId: route.id,
          serviceDate: new Date(dep.toISOString().slice(0, 10)),
          departureAt: dep,
          arrivalAt: new Date(dep.getTime() + 3_600_000),
          vehicleId: v.id,
        },
      });
    });
    const book = async (seat: string, paid = true) => {
      const b = (
        await owner
          .call('post', `/tenants/${tenantId}/bookings`)
          .send({
            tripId: trip.id,
            contact: { name: 'Hawa Turay', phone: '+23277888000' },
            passengers: [{ fullName: 'Hawa Turay', seatLabel: seat }],
          })
          .expect(201)
      ).body as { id: string };
      // The passenger owns the booking (as if they had booked it themselves).
      await plat((tx) =>
        tx.booking.update({ where: { id: b.id }, data: { createdByUserId: pax.userId } }),
      );
      if (paid) await bookings.markPaid(tenantId, b.id);
      return b;
    };
    return { tenantId, owner, pax, trip, book, ownerEmail: t.email };
  }

  const complaintBody = (bookingId: string, extra: Record<string, unknown> = {}) => ({
    bookingId,
    category: 'DELAY',
    subject: 'Bus left an hour late',
    body: 'We waited at the terminal for an hour with no information.',
    ...extra,
  });

  it('lets a passenger complain about a paid booking, with validation, ownership and a cap on open complaints', async () => {
    const k = await setup('cmp-create');
    const paid = await k.book('1');
    const unpaid = await k.book('2', false);
    const other = await newClient(ctx.app, db, 'cmp-other');

    await k.pax.call('post', '/passenger/complaints').send(complaintBody(unpaid.id)).expect(409);
    await other.call('post', '/passenger/complaints').send(complaintBody(paid.id)).expect(404);
    await k.pax
      .call('post', '/passenger/complaints')
      .send(complaintBody(paid.id, { subject: 'x' }))
      .expect(400);
    await k.pax
      .call('post', '/passenger/complaints')
      .send(complaintBody(paid.id, { category: 'RUDE' }))
      .expect(400);
    await k.pax
      .call('post', '/passenger/complaints')
      .send(complaintBody(paid.id, { status: 'RESOLVED' }))
      .expect(400);
    await k.pax
      .call('post', '/passenger/complaints')
      .send(complaintBody(paid.id, { body: 'no' }))
      .expect(400);
    await request401(ctx);

    const made = await k.pax
      .call('post', '/passenger/complaints')
      .send(complaintBody(paid.id))
      .expect(201);
    const mine = await k.pax.call('get', '/passenger/complaints').expect(200);
    expect(mine.body.complaints).toHaveLength(1);
    expect(mine.body.complaints[0]).toMatchObject({ status: 'OPEN', category: 'DELAY' });
    const detail = await k.pax.call('get', `/passenger/complaints/${made.body.id}`).expect(200);
    expect(detail.body.messages).toHaveLength(1);
    expect(detail.body.messages[0]).toMatchObject({ from: 'YOU' });
    expect((await other.call('get', '/passenger/complaints').expect(200)).body.complaints).toEqual(
      [],
    );
    await other.call('get', `/passenger/complaints/${made.body.id}`).expect(404);
    await other
      .call('post', `/passenger/complaints/${made.body.id}/messages`)
      .send({ body: 'hello' })
      .expect(404);

    for (let i = 0; i < 4; i++)
      await k.pax.call('post', '/passenger/complaints').send(complaintBody(paid.id)).expect(201);
    await k.pax.call('post', '/passenger/complaints').send(complaintBody(paid.id)).expect(409); // the 6th open one
  }, 600_000);

  it('gives support staff the conversation, keeps it append-only, and closes it for good', async () => {
    const k = await setup('cmp-staff');
    const other = await setup('cmp-staff-other');
    const paid = await k.book('1');
    const made = (
      await k.pax.call('post', '/passenger/complaints').send(complaintBody(paid.id)).expect(201)
    ).body as { id: string };
    const base = `/tenants/${k.tenantId}/complaints`;
    const agent = await member(k.tenantId, 'sales_agent'); // no support.manage

    await agent.call('get', base).expect(403);
    await agent.call('post', `${base}/${made.id}/messages`).send({ body: 'hi' }).expect(403);
    await other.owner.call('get', `/tenants/${other.tenantId}/complaints/${made.id}`).expect(404);
    await other.owner.call('get', `/tenants/${k.tenantId}/complaints`).expect(404);
    expect(
      (await other.owner.call('get', `/tenants/${other.tenantId}/complaints`).expect(200)).body
        .complaints,
    ).toEqual([]);

    const list = await k.owner.call('get', `${base}?status=OPEN`).expect(200);
    expect(list.body.complaints).toHaveLength(1);
    expect(list.body.complaints[0]).toMatchObject({ customer: 'Hawa Turay', category: 'DELAY' });
    const d = await k.owner.call('get', `${base}/${made.id}`).expect(200);
    expect(d.body.messages[0]).toMatchObject({ from: 'CUSTOMER' });

    await k.owner.call('post', `${base}/${made.id}/messages`).send({ body: '' }).expect(400);
    await k.owner
      .call('post', `${base}/${made.id}/messages`)
      .send({ body: 'Sorry about that: we are investigating.' })
      .expect(201);
    expect((await k.owner.call('get', `${base}/${made.id}`).expect(200)).body.status).toBe(
      'IN_REVIEW',
    );
    const seen = (await k.pax.call('get', `/passenger/complaints/${made.id}`).expect(200)).body
      .messages;
    expect(seen.map((m: { from: string }) => m.from)).toEqual(['YOU', 'COMPANY']);

    // Resolve, then the customer replies: it reopens.
    await k.owner
      .call('post', `${base}/${made.id}/status`)
      .send({ status: 'RESOLVED' })
      .expect(204);
    await k.owner.call('post', `${base}/${made.id}/status`).send({ status: 'OPEN' }).expect(400); // not a staff action
    expect(
      (await plat((tx) => tx.complaint.findUniqueOrThrow({ where: { id: made.id } }))).resolvedAt,
    ).not.toBeNull();
    await k.pax
      .call('post', `/passenger/complaints/${made.id}/messages`)
      .send({ body: 'It is still not fixed.' })
      .expect(201);
    const reopened = await plat((tx) => tx.complaint.findUniqueOrThrow({ where: { id: made.id } }));
    expect(reopened).toMatchObject({ status: 'OPEN', resolvedAt: null });

    // The record cannot be edited or deleted.
    await expect(
      plat((tx) =>
        tx.complaintMessage.updateMany({
          where: { complaintId: made.id },
          data: { body: 'edited' },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      plat((tx) => tx.complaintMessage.deleteMany({ where: { complaintId: made.id } })),
    ).rejects.toThrow();

    // Closed is final for everyone.
    await k.owner.call('post', `${base}/${made.id}/status`).send({ status: 'CLOSED' }).expect(204);
    await k.owner
      .call('post', `${base}/${made.id}/messages`)
      .send({ body: 'one more' })
      .expect(409);
    await k.owner
      .call('post', `${base}/${made.id}/status`)
      .send({ status: 'IN_REVIEW' })
      .expect(409);
    await k.pax
      .call('post', `/passenger/complaints/${made.id}/messages`)
      .send({ body: 'hello?' })
      .expect(409);
  }, 600_000);

  it('emails the right people about complaints without putting the message text in the email', async () => {
    const k = await setup('cmp-mail');
    const paid = await k.book('1');
    const secretText = 'my phone number is 077123456 and I was overcharged';
    const made = (
      await k.pax
        .call('post', '/passenger/complaints')
        .send(complaintBody(paid.id, { body: secretText }))
        .expect(201)
    ).body as { id: string };
    await k.owner
      .call('post', `/tenants/${k.tenantId}/complaints/${made.id}/messages`)
      .send({ body: 'We have refunded the difference.' })
      .expect(201);

    const mailer = new CaptureMailer();
    const proc = new OutboxProcessor(
      db,
      new NotificationService(db, mailer, 'https://app.test').handlers(),
      { tenantId: k.tenantId, batchSize: 50 },
    );
    for (let i = 0; i < 4; i++) if ((await proc.runOnce()).claimed === 0) break;

    const toStaff = mailer.sent.filter((m) => m.template === 'complaint-received');
    expect(toStaff.map((m) => m.to)).toEqual([k.ownerEmail]);
    expect(toStaff[0]!.data.link).toMatch(/^https:\/\/app\.test\/[a-z0-9-]+\/complaints$/);
    const toPassenger = mailer.sent.filter((m) => m.template === 'complaint-reply');
    expect(toPassenger).toHaveLength(1);
    expect(toPassenger[0]!.data.link).toMatch(
      new RegExp(`^https://app[.]test/[a-z0-9-]+/complaints/${made.id}$`),
    );
    expect(JSON.stringify(mailer.sent)).not.toContain('077123456');
    expect(JSON.stringify(mailer.sent)).not.toContain('refunded');
  }, 600_000);

  it('accepts one rating per booking, only after the trip is completed', async () => {
    const k = await setup('cmp-rate');
    const paid = await k.book('1');
    const other = await newClient(ctx.app, db, 'cmp-rate-other');
    const rate = (who: Client, id: string, body: object) =>
      who.call('post', `/passenger/bookings/${id}/rating`).send(body);

    await rate(k.pax, paid.id, { rating: 5 }).expect(409); // trip not completed
    await plat((tx) => tx.trip.update({ where: { id: k.trip.id }, data: { status: 'COMPLETED' } }));
    await rate(k.pax, paid.id, { rating: 0 }).expect(400);
    await rate(k.pax, paid.id, { rating: 6 }).expect(400);
    await rate(k.pax, paid.id, { rating: 4.5 }).expect(400);
    await rate(k.pax, paid.id, { rating: 4, comment: 'x'.repeat(1001) }).expect(400);
    await rate(k.pax, paid.id, { rating: 4, extra: true }).expect(400);
    await rate(other, paid.id, { rating: 1 }).expect(404);
    await rate(k.pax, paid.id, { rating: 4, comment: 'Comfortable ride' }).expect(201);
    await rate(k.pax, paid.id, { rating: 1 }).expect(409); // only once
    expect(
      (await k.pax.call('get', `/passenger/bookings/${paid.id}/rating`).expect(200)).body.rating,
    ).toEqual({ rating: 4, comment: 'Comfortable ride' });
    expect(
      (await other.call('get', `/passenger/bookings/${paid.id}/rating`).expect(200)).body.rating,
    ).toBeNull();

    const sum = (await k.owner.call('get', `/tenants/${k.tenantId}/ratings/summary`).expect(200))
      .body;
    expect(sum).toMatchObject({ total: 1, average: 4 });
    expect(sum.distribution.find((d: { rating: number }) => d.rating === 4).count).toBe(1);
    expect(sum.routes).toHaveLength(1);
    const unrelated = await setup('cmp-rate-unrelated');
    expect(
      (
        await unrelated.owner
          .call('get', `/tenants/${unrelated.tenantId}/ratings/summary`)
          .expect(200)
      ).body.total,
    ).toBe(0);
  }, 600_000);
});

async function request401(ctx: ReturnType<typeof makeApp>) {
  const { default: request } = await import('supertest');
  await request(ctx.app).post('/api/v1/passenger/complaints').send({}).expect(401);
}
