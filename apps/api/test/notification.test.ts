import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderMail } from '../src/modules/notifications/templates.js';
import { NotificationService } from '../src/modules/notifications/notification.service.js';
import { BookingService } from '../src/modules/booking/booking.service.js';
import type { Mailer, MailMessage } from '../src/modules/notifications/mailer.js';
import { withDb, type Db, type Tx } from '../src/platform/db.js';
import { OutboxProcessor } from '../src/platform/outbox.js';
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

/** Records mail; can be told to fail for one address a number of times. */
class FlakyMailer implements Mailer {
  sent: MailMessage[] = [];
  failures = new Map<string, number>();
  async send(msg: MailMessage) {
    const left = this.failures.get(msg.to) ?? 0;
    if (left > 0) {
      this.failures.set(msg.to, left - 1);
      throw new Error('provider down');
    }
    this.sent.push(msg);
  }
  to(addr: string, template?: string) {
    return this.sent.filter((m) => m.to === addr && (!template || m.template === template));
  }
}

describe('notification templates', () => {
  const base = {
    reference: 'ABC123',
    route: 'Freetown to Bo',
    departure: 'Friday 1 January 2027 at 08:00',
    seats: '1, 2',
    link: 'https://app.test/app/bookings/1',
  };
  it('uses generic subjects and escapes everything that came from users', () => {
    const evil = {
      ...base,
      route: '<script>alert(1)</script>',
      reference: '"><img src=x>',
      vehicle: '<b>X</b>',
    };
    for (const template of [
      'booking-confirmed',
      'booking-cancelled',
      'trip-delayed',
      'trip-vehicle-changed',
    ] as const) {
      const m = renderMail({
        template,
        data: { ...evil, delayMinutes: '20', reason: 'trip_cancelled', refund: 'yes' },
      });
      expect(m.subject).not.toMatch(/ABC123|Freetown|Bo\b/);
      expect(m.html).not.toContain('<script>');
      expect(m.html).not.toContain('<img src=x>');
      expect(m.html).not.toContain('<b>X</b>');
      expect(m.html).toContain('&lt;script&gt;');
    }
  });
  it('refuses unsafe links and states refund and delay facts', () => {
    expect(() =>
      renderMail({ template: 'booking-confirmed', data: { ...base, link: 'javascript:alert(1)' } }),
    ).toThrow();
    expect(
      renderMail({
        template: 'booking-cancelled',
        data: { ...base, refund: 'yes', reason: 'trip_cancelled' },
      }).text,
    ).toMatch(/refund/);
    expect(
      renderMail({
        template: 'booking-cancelled',
        data: { ...base, refund: 'no', reason: 'cancelled' },
      }).text,
    ).toMatch(/No payment was taken/);
    expect(
      renderMail({ template: 'trip-delayed', data: { ...base, delayMinutes: '35' } }).text,
    ).toMatch(/35 minutes/);
    expect(
      renderMail({ template: 'trip-delayed', data: { ...base, delayMinutes: '0' } }).text,
    ).toMatch(/cleared/);
    expect(
      renderMail({
        template: 'refund-required',
        data: { reference: 'ABC123', amount: 'SLE 10.00', link: 'https://app.test/c/x/bookings' },
      }).subject,
    ).toBe('A payment needs a refund');
  });
});

describe.skipIf(!TEST_DB_URL)('notifications from the outbox (database)', () => {
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

  async function kit(label: string) {
    const t = await createTenantWithOwner(db, label);
    const tenantId = t.tenant.id;
    const owner = await loginClient(ctx.app, db, t.email, t.password);
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
        data: { tenantId, registration: uniq('NT').toUpperCase(), seatingCapacity: 8, type: 'BUS' },
      });
      const spare = await tx.vehicle.create({
        data: { tenantId, registration: uniq('SP').toUpperCase(), seatingCapacity: 8, type: 'BUS' },
      });
      const dep = new Date(Date.now() + 2 * 86_400_000);
      const trip = await tx.trip.create({
        data: {
          tenantId,
          routeId: route.id,
          serviceDate: new Date(dep.toISOString().slice(0, 10)),
          departureAt: dep,
          arrivalAt: new Date(dep.getTime() + 7_200_000),
          vehicleId: v.id,
        },
      });
      return { trip, spare };
    });
    const mailer = new FlakyMailer();
    const run = (opts: ConstructorParameters<typeof OutboxProcessor>[2] = {}) =>
      new OutboxProcessor(db, new NotificationService(db, mailer, 'https://app.test').handlers(), {
        tenantId,
        batchSize: 50,
        ...opts,
      });
    const drain = async (opts?: ConstructorParameters<typeof OutboxProcessor>[2]) => {
      const p = run(opts);
      let total = { claimed: 0, processed: 0, retried: 0, deadLettered: 0 };
      for (let i = 0; i < 5; i++) {
        const r = await p.runOnce();
        total = {
          claimed: total.claimed + r.claimed,
          processed: total.processed + r.processed,
          retried: total.retried + r.retried,
          deadLettered: total.deadLettered + r.deadLettered,
        };
        if (r.claimed === 0) break;
      }
      return total;
    };
    const book = async (seats: string[], email?: string, by: Client = owner) =>
      (
        await by
          .call('post', `/tenants/${tenantId}/bookings`)
          .send({
            tripId: fx.trip.id,
            contact: { name: 'Fanta Jalloh', phone: '+23277555000', ...(email ? { email } : {}) },
            passengers: seats.map((s, i) => ({ fullName: `P${i + 1}`, seatLabel: s })),
          })
          .expect(201)
      ).body as { id: string };
    return { tenantId, owner, owner_email: t.email, ...fx, mailer, drain, book };
  }

  it('emails the booking contact and the passenger account once on confirmation, never the staff member who booked', async () => {
    const k = await kit('nt-confirm');
    const b = await k.book(['1', '2'], 'fanta@example.test');
    await bookings.markPaid(k.tenantId, b.id);
    const first = await k.drain();
    expect(first.processed).toBe(1);
    expect(k.mailer.to('fanta@example.test', 'booking-confirmed')).toHaveLength(1);
    expect(k.mailer.to(k.owner_email)).toHaveLength(0); // the owner made the booking on the counter
    const m = k.mailer.to('fanta@example.test')[0]!;
    expect(m.data).toMatchObject({ seats: '1, 2' });
    expect(m.data.link).toBe(`https://app.test/app/bookings/${b.id}`);
    expect(m.data.reference).toMatch(/^[0-9A-Z]{10}$/);
    // Nothing is sent twice by a second pass.
    expect((await k.drain()).claimed).toBe(0);
    expect(k.mailer.sent).toHaveLength(1);
    expect(
      await withDb(db, { tenantId: k.tenantId }, (tx) => tx.notificationDelivery.count()),
    ).toBe(1);

    // A booking made by a passenger account is also sent to that account's own address.
    const pax = await newClient(ctx.app, db, 'ntpax');
    await plat((tx) =>
      tx.paymentSettings.create({
        data: {
          tenantId: k.tenantId,
          spaceId: 'spc-x',
          apiTokenEnc: 'v1.a.b.c',
          webhookSecretEnc: 'v1.a.b.c',
        },
      }),
    );
    const mine = (
      await pax
        .call('post', '/passenger/bookings')
        .send({
          tenantId: k.tenantId,
          tripId: k.trip.id,
          contact: { name: 'Pax', phone: '+23277000999' },
          passengers: [{ fullName: 'Pax', seatLabel: '5' }],
        })
        .expect(201)
    ).body as { id: string };
    await bookings.markPaid(k.tenantId, mine.id);
    await k.drain();
    expect(
      k.mailer.sent.filter(
        (x) => x.template === 'booking-confirmed' && x.data.link?.endsWith(mine.id),
      ),
    ).toHaveLength(1);
  }, 400_000);

  it('tells passengers about cancellations, with the refund position', async () => {
    const k = await kit('nt-cancel');
    const paid = await k.book(['1'], 'paid@example.test');
    await bookings.markPaid(k.tenantId, paid.id);
    const unpaid = await k.book(['2'], 'unpaid@example.test');
    await k.drain();
    k.mailer.sent.length = 0;

    await k.owner
      .call('post', `/tenants/${k.tenantId}/bookings/${paid.id}/cancel`)
      .send({ reason: 'customer request' })
      .expect(200);
    await k.owner
      .call('post', `/tenants/${k.tenantId}/bookings/${unpaid.id}/cancel`)
      .send({ reason: 'customer request' })
      .expect(200);
    await k.drain();
    expect(k.mailer.to('paid@example.test', 'booking-cancelled')[0]!.data).toMatchObject({
      refund: 'yes',
      reason: 'cancelled',
    });
    expect(k.mailer.to('unpaid@example.test', 'booking-cancelled')[0]!.data).toMatchObject({
      refund: 'no',
    });

    // Cancelling the whole trip: one notice per booking, not two.
    const b3 = await k.book(['3'], 'three@example.test');
    await bookings.markPaid(k.tenantId, b3.id);
    await k.owner
      .call('post', `/tenants/${k.tenantId}/trips/${k.trip.id}/status`)
      .send({ status: 'CANCELLED' })
      .expect(204);
    await k.drain();
    const three = k.mailer.to('three@example.test', 'booking-cancelled');
    expect(three).toHaveLength(1);
    expect(three[0]!.data).toMatchObject({ reason: 'trip_cancelled', refund: 'yes' });
  }, 400_000);

  it('notifies confirmed passengers of delays (only the latest), and of vehicle changes', async () => {
    const k = await kit('nt-delay');
    const a = await k.book(['1'], 'a@example.test');
    const b = await k.book(['2'], 'b@example.test');
    const pending = await k.book(['3'], 'pending@example.test'); // unpaid: not told
    await bookings.markPaid(k.tenantId, a.id);
    await bookings.markPaid(k.tenantId, b.id);
    await k.drain();
    k.mailer.sent.length = 0;

    await k.owner
      .call('post', `/tenants/${k.tenantId}/trips/${k.trip.id}/delay`)
      .send({ delayMinutes: 20 })
      .expect(204);
    await k.owner
      .call('post', `/tenants/${k.tenantId}/trips/${k.trip.id}/delay`)
      .send({ delayMinutes: 35 })
      .expect(204);
    await k.drain();
    const delays = k.mailer.sent.filter((m) => m.template === 'trip-delayed');
    expect(delays.map((m) => m.to).sort()).toEqual(['a@example.test', 'b@example.test']);
    expect(delays.every((m) => m.data.delayMinutes === '35')).toBe(true); // the superseded 20-minute notice is skipped
    expect(k.mailer.to('pending@example.test')).toHaveLength(0);

    await k.owner
      .call('post', `/tenants/${k.tenantId}/trips/${k.trip.id}/replace-vehicle`)
      .send({ vehicleId: k.spare.id, reason: 'breakdown' })
      .expect(200);
    await k.drain();
    const changed = k.mailer.sent.filter((m) => m.template === 'trip-vehicle-changed');
    expect(changed).toHaveLength(2);
    expect(changed[0]!.data.vehicle).toMatch(/^SP-/);
    void pending;
  }, 400_000);

  it('retries only the failed recipient and never double-sends', async () => {
    const k = await kit('nt-retry');
    const a = await k.book(['1'], 'ok@example.test');
    const b = await k.book(['2'], 'flaky@example.test');
    await bookings.markPaid(k.tenantId, a.id);
    await bookings.markPaid(k.tenantId, b.id);
    k.mailer.failures.set('flaky@example.test', 1);
    let clock = new Date();
    const opts = { now: () => clock, backoffBaseMs: 1000, random: () => 0 };

    const first = await k.drain(opts);
    // Two separate events: the healthy one is sent, the other fails once and is rescheduled.
    expect(first.retried).toBe(1);
    expect(k.mailer.to('ok@example.test')).toHaveLength(1);
    expect(k.mailer.to('flaky@example.test')).toHaveLength(0);

    clock = new Date(clock.getTime() + 60_000);
    const second = await k.drain(opts);
    expect(second.processed).toBe(1);
    expect(k.mailer.to('flaky@example.test')).toHaveLength(1);
    expect(k.mailer.to('ok@example.test')).toHaveLength(1); // not sent again
    const dead = await plat((tx) =>
      tx.outboxEvent.count({ where: { tenantId: k.tenantId, failedAt: { not: null } } }),
    );
    expect(dead).toBe(0);
  }, 400_000);

  it('asks only people who manage payments to issue a refund, and only in their own company', async () => {
    const k = await kit('nt-refund');
    const other = await kit('nt-refund-other');
    const driver = await member(k.tenantId, 'driver');
    const b = await k.book(['1'], 'late@example.test');
    await plat((tx) =>
      tx.outboxEvent.createMany({
        data: [
          {
            tenantId: k.tenantId,
            type: 'payment.refund_required',
            payload: { paymentId: 'p1', bookingId: b.id, amountMinor: 50_000, currency: 'SLE' },
            dedupeKey: `refund-${b.id}`,
          },
        ],
      }),
    );
    await k.drain();
    const mails = k.mailer.sent.filter((m) => m.template === 'refund-required');
    expect(mails.map((m) => m.to)).toEqual([k.owner_email]);
    expect(mails[0]!.data).toMatchObject({
      amount: 'SLE 500.00',
      link: `https://app.test/c/${k.tenantId}/bookings`,
    });
    expect(mails.some((m) => m.to === 'late@example.test')).toBe(false); // the customer is not sent staff text
    void driver;
    // The other company's mailer saw nothing from this company's events.
    expect(other.mailer.sent).toHaveLength(0);
  }, 400_000);
});
