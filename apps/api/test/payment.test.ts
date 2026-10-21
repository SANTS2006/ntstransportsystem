import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GatewayError,
  signMonime,
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

/** In-memory stand-in for Monime: records requests and lets a test decide what a session reports. */
class FakeGateway implements PaymentGateway {
  sessions = new Map<
    string,
    { req: CheckoutRequest; status: CheckoutState['status']; override?: Partial<CheckoutState> }
  >();
  created: { cfg: GatewayConfig; req: CheckoutRequest }[] = [];
  failCreate = false;
  failGet = false;
  private n = 0;
  async createCheckout(cfg: GatewayConfig, req: CheckoutRequest): Promise<CheckoutCreated> {
    if (this.failCreate) throw new GatewayError('Monime responded 503', true);
    const sessionId = `cs-${++this.n}-${Math.random().toString(36).slice(2, 8)}`;
    this.sessions.set(sessionId, { req, status: 'pending' });
    this.created.push({ cfg, req });
    return { sessionId, redirectUrl: `https://pay.monime.test/${sessionId}` };
  }
  async getCheckout(_cfg: GatewayConfig, sessionId: string): Promise<CheckoutState> {
    if (this.failGet) throw new GatewayError('Could not reach Monime', true);
    const s = this.sessions.get(sessionId);
    if (!s) throw new GatewayError('Monime responded 404', false);
    return {
      status: s.status,
      reference: s.req.reference,
      totalMinor: s.req.lineItems.reduce((a, l) => a + l.amountMinor * l.quantity, 0),
      currency: s.req.currency,
      ...s.override,
    };
  }
  set(sessionId: string, status: CheckoutState['status'], override?: Partial<CheckoutState>) {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('no session');
    s.status = status;
    if (override) s.override = override;
  }
}

describe.skipIf(!TEST_DB_URL)('payments (database, fake Monime)', () => {
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

  /** Company with Monime configured, a trip with a fare, and a pending 2-seat booking. */
  async function setup(label: string, configure = true) {
    const { tenantId, owner } = await company(label);
    let secret = '';
    if (configure) {
      const r = await owner
        .call('put', `/tenants/${tenantId}/payment-settings`)
        .send({ spaceId: 'spc-test123', apiToken: 'mon_test_abcdefghij123456' })
        .expect(200);
      secret = r.body.webhookSecret as string;
    }
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
      await tx.fare.create({ data: { tenantId, routeId: route.id, amountMinor: 50_000 } });
      const v = await tx.vehicle.create({
        data: { tenantId, registration: uniq('PV').toUpperCase(), seatingCapacity: 6, type: 'BUS' },
      });
      const dep = new Date(Date.now() + 3 * 86_400_000);
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
    const book = async (seats: string[] = ['1', '2']) =>
      (
        await owner
          .call('post', `/tenants/${tenantId}/bookings`)
          .send({
            tripId: trip.id,
            contact: { name: 'Aminata Kamara', phone: '+23277123456' },
            passengers: seats.map((s, i) => ({ fullName: `P${i + 1}`, seatLabel: s })),
          })
          .expect(201)
      ).body as { id: string; totalMinor: number };
    return { tenantId, owner, secret, trip, book };
  }

  /** Sends a webhook exactly as Monime would: raw JSON, signed over "t_body". */
  const deliver = (
    tenantId: string,
    secret: string,
    event: { id: string; name: string; data: Record<string, unknown> },
    opts: { t?: number; tamper?: boolean; header?: string } = {},
  ) => {
    const raw = Buffer.from(
      JSON.stringify({
        apiVersion: 'caph',
        event: { id: event.id, name: event.name, timestamp: '1' },
        data: event.data,
      }),
    );
    const t = opts.t ?? Math.floor(Date.now() / 1000);
    const header = opts.header ?? signMonime(raw, secret, t);
    return request(ctx.app)
      .post(`/api/v1/webhooks/monime/${tenantId}`)
      .set('content-type', 'application/json')
      .set('monime-signature', header)
      .send(opts.tamper ? raw.toString().replace('"1"', '"2"') : raw.toString());
  };
  const statusOf = async (owner: Client, tenantId: string, bookingId: string) =>
    (
      (await owner.call('get', `/tenants/${tenantId}/bookings/${bookingId}`).expect(200)).body as {
        status: string;
      }
    ).status;

  it('keeps credentials encrypted, write-only and permission-gated', async () => {
    const a = await company('pay-settings-a');
    const b = await company('pay-settings-b');
    const url = `/tenants/${a.tenantId}/payment-settings`;
    await a.owner.call('put', url).send({ spaceId: 'spc-1' }).expect(400); // token required first time
    await a.owner
      .call('put', url)
      .send({ spaceId: 'bad', apiToken: 'mon_test_abcdefghij' })
      .expect(400);
    await a.owner
      .call('put', url)
      .send({ spaceId: 'spc-1', apiToken: 'sk_live_whatever1234' })
      .expect(400);
    await a.owner
      .call('put', url)
      .send({ spaceId: 'spc-1', apiToken: 'mon_test_abcdefghij', webhookSecret: 'short' })
      .expect(400);
    await a.owner
      .call('put', url)
      .send({ spaceId: 'spc-1', apiToken: 'mon_test_abcdefghij', extra: 1 })
      .expect(400);
    const first = await a.owner
      .call('put', url)
      .send({ spaceId: 'spc-1', apiToken: 'mon_test_abcdefghij' })
      .expect(200);
    expect(first.body.webhookSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.body.webhookUrl).toContain(`/api/v1/webhooks/monime/${a.tenantId}`);
    const again = await a.owner
      .call('put', url)
      .send({ spaceId: 'spc-2', enabled: true })
      .expect(200);
    expect(again.body.webhookSecret).toBeNull(); // shown once only
    const got = await a.owner.call('get', url).expect(200);
    expect(got.body).toMatchObject({ configured: true, enabled: true, spaceId: 'spc-2' });
    expect(JSON.stringify(got.body)).not.toMatch(/mon_test|apiToken|secret/i);

    const row = await plat((tx) =>
      tx.paymentSettings.findFirstOrThrow({ where: { tenantId: a.tenantId } }),
    );
    expect(row.apiTokenEnc).not.toContain('mon_test');
    expect(row.apiTokenEnc.startsWith('v1.')).toBe(true);
    expect(row.webhookSecretEnc).not.toContain(first.body.webhookSecret);

    const agent = await member(a.tenantId, 'sales_agent');
    await agent.call('get', url).expect(403);
    await agent
      .call('put', url)
      .send({ spaceId: 'spc-9', apiToken: 'mon_test_abcdefghij' })
      .expect(403);
    await b.owner.call('get', `/tenants/${a.tenantId}/payment-settings`).expect(404);
    expect(
      (await b.owner.call('get', `/tenants/${b.tenantId}/payment-settings`).expect(200)).body
        .configured,
    ).toBe(false);
  }, 300_000);

  it('starts a payment from the booking snapshot, reuses the open one, and survives provider failure', async () => {
    const unconfigured = await setup('pay-start-none', false);
    const bk0 = await unconfigured.book(['1']);
    await unconfigured.owner
      .call('post', `/tenants/${unconfigured.tenantId}/bookings/${bk0.id}/payments`)
      .expect(409);

    const { tenantId, owner, book } = await setup('pay-start');
    const bk = await book(['1', '2']);
    const before = (await owner.call('get', `/tenants/${tenantId}/bookings/${bk.id}`).expect(200))
      .body.holdExpiresAt as string;

    gw.failCreate = true;
    const fail = await owner
      .call('post', `/tenants/${tenantId}/bookings/${bk.id}/payments`)
      .expect(502);
    expect(fail.body.error.code).toBe('PAYMENT_PROVIDER_ERROR');
    gw.failCreate = false;
    expect(
      (await owner.call('get', `/tenants/${tenantId}/bookings/${bk.id}/payments`).expect(200)).body
        .payments[0].status,
    ).toBe('FAILED');

    const ok = await owner
      .call('post', `/tenants/${tenantId}/bookings/${bk.id}/payments`)
      .send({ amount: 1 })
      .expect(201);
    expect(ok.body.redirectUrl).toMatch(/^https:\/\/pay\.monime\.test\//);
    const sent = gw.created.at(-1)!;
    expect(sent.req.lineItems.reduce((a, l) => a + l.amountMinor * l.quantity, 0)).toBe(100_000); // from the snapshot
    expect(sent.req.reference).toBe(ok.body.paymentId);
    expect(sent.req.idempotencyKey.length).toBeGreaterThan(25);
    expect(sent.req.idempotencyKey.length).toBeLessThan(64);
    expect(sent.req.metadata).toMatchObject({ tenantId, bookingId: bk.id });
    expect(sent.cfg).toMatchObject({ spaceId: 'spc-test123', token: 'mon_test_abcdefghij123456' });

    const count = gw.created.length;
    const same = await owner
      .call('post', `/tenants/${tenantId}/bookings/${bk.id}/payments`)
      .expect(201);
    expect(same.body).toMatchObject({ paymentId: ok.body.paymentId, reused: true });
    expect(gw.created.length).toBe(count); // no second session

    const after = (await owner.call('get', `/tenants/${tenantId}/bookings/${bk.id}`).expect(200))
      .body.holdExpiresAt as string;
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());

    // Only a pending booking can be paid.
    await owner
      .call('post', `/tenants/${tenantId}/bookings/${bk.id}/cancel`)
      .send({ reason: 'changed mind' })
      .expect(200);
    await owner.call('post', `/tenants/${tenantId}/bookings/${bk.id}/payments`).expect(409);
    const list = (
      await owner.call('get', `/tenants/${tenantId}/bookings/${bk.id}/payments`).expect(200)
    ).body.payments as { status: string }[];
    expect(list.find((p) => p.status === 'CANCELLED')).toBeTruthy(); // the open payment was closed with the booking
  }, 300_000);

  it('confirms a booking only from a signed webhook that the provider confirms, once', async () => {
    const { tenantId, owner, secret, book } = await setup('pay-webhook');
    const bk = await book();
    const p = (
      await owner.call('post', `/tenants/${tenantId}/bookings/${bk.id}/payments`).expect(201)
    ).body as { paymentId: string; redirectUrl: string };
    const sessionId = p.redirectUrl.split('/').pop()!;
    const ev = (id: string) => ({
      id,
      name: 'checkout_session.completed',
      data: { id: sessionId, reference: p.paymentId },
    });

    // The provider has not completed it yet: a signed "completed" claim changes nothing.
    const forged = await deliver(tenantId, secret, ev('evt-1')).expect(200);
    expect(forged.body.status).toBe('still_pending');
    expect(await statusOf(owner, tenantId, bk.id)).toBe('PENDING_PAYMENT');

    gw.set(sessionId, 'completed');
    const paid = await deliver(tenantId, secret, ev('evt-2')).expect(200);
    expect(paid.body.status).toBe('paid');
    expect(await statusOf(owner, tenantId, bk.id)).toBe('CONFIRMED');
    const pay = (
      await owner.call('get', `/tenants/${tenantId}/bookings/${bk.id}/payments`).expect(200)
    ).body.payments[0];
    expect(pay).toMatchObject({ status: 'PAID', amountMinor: 100_000 });
    expect(pay.paidAt).not.toBeNull();

    // Providers retry: the same event id is acknowledged and does nothing more.
    expect((await deliver(tenantId, secret, ev('evt-2')).expect(200)).body.status).toBe(
      'duplicate',
    );
    // A different event id for the same session is also harmless.
    expect((await deliver(tenantId, secret, ev('evt-3')).expect(200)).body.status).toBe(
      'already_settled',
    );
    const confirmed = await plat((tx) =>
      tx.outboxEvent.count({ where: { tenantId, type: 'booking.confirmed' } }),
    );
    expect(confirmed).toBe(1);
    // A paid booking is no longer payable.
    await owner.call('post', `/tenants/${tenantId}/bookings/${bk.id}/payments`).expect(409);
  }, 300_000);

  it('rejects unsigned, tampered, stale, wrong-secret and wrong-company deliveries', async () => {
    const a = await setup('pay-sec-a');
    const b = await setup('pay-sec-b');
    const bk = await a.book(['1']);
    const p = (
      await a.owner.call('post', `/tenants/${a.tenantId}/bookings/${bk.id}/payments`).expect(201)
    ).body as { paymentId: string; redirectUrl: string };
    const sessionId = p.redirectUrl.split('/').pop()!;
    gw.set(sessionId, 'completed'); // even if the provider really completed it...
    const ev = {
      id: 'evt-sec',
      name: 'checkout_session.completed',
      data: { id: sessionId, reference: p.paymentId },
    };

    await deliver(a.tenantId, a.secret, ev, { tamper: true }).expect(401);
    await deliver(a.tenantId, b.secret, ev).expect(401); // another company's secret
    await deliver(b.tenantId, a.secret, ev).expect(401); // right secret, wrong company
    await deliver(a.tenantId, a.secret, ev, { t: Math.floor(Date.now() / 1000) - 3600 }).expect(
      401,
    ); // replayed later
    await deliver(a.tenantId, a.secret, ev, { header: 'nonsense' }).expect(401);
    await request(ctx.app)
      .post(`/api/v1/webhooks/monime/${a.tenantId}`)
      .set('content-type', 'application/json')
      .send(ev)
      .expect(401); // no signature
    await deliver('00000000-0000-4000-8000-000000000000', a.secret, ev).expect(401);
    expect(await statusOf(a.owner, a.tenantId, bk.id)).toBe('PENDING_PAYMENT'); // none of it confirmed anything
    expect(
      await plat((tx) => tx.paymentWebhookEvent.count({ where: { tenantId: a.tenantId } })),
    ).toBe(0);

    await deliver(a.tenantId, a.secret, {
      id: 'e',
      name: 'checkout_session.completed',
      data: {},
    } as never).expect(400);
  }, 300_000);

  it('does not confirm when the session reference or amount does not match', async () => {
    const { tenantId, owner, secret, book } = await setup('pay-mismatch');
    const one = await book(['1']);
    const p1 = (
      await owner.call('post', `/tenants/${tenantId}/bookings/${one.id}/payments`).expect(201)
    ).body as { paymentId: string; redirectUrl: string };
    const s1 = p1.redirectUrl.split('/').pop()!;
    gw.set(s1, 'completed', { reference: 'someone-else' });
    await deliver(tenantId, secret, {
      id: 'm1',
      name: 'checkout_session.completed',
      data: { id: s1 },
    }).expect(200);
    expect(await statusOf(owner, tenantId, one.id)).toBe('PENDING_PAYMENT');

    const two = await book(['2']);
    const p2 = (
      await owner.call('post', `/tenants/${tenantId}/bookings/${two.id}/payments`).expect(201)
    ).body as { paymentId: string; redirectUrl: string };
    const s2 = p2.redirectUrl.split('/').pop()!;
    gw.set(s2, 'completed', { totalMinor: 100 }); // paid far less than the fare
    await deliver(tenantId, secret, {
      id: 'm2',
      name: 'checkout_session.completed',
      data: { id: s2 },
    }).expect(200);
    expect(await statusOf(owner, tenantId, two.id)).toBe('PENDING_PAYMENT');
    const pays = await plat((tx) => tx.payment.findMany({ where: { tenantId, status: 'FAILED' } }));
    expect(pays.map((x) => x.lastError).sort()).toEqual(['Amount mismatch', 'Reference mismatch']);
  }, 300_000);

  it('asks the provider to retry when it is unreachable, and covers missed webhooks with refresh', async () => {
    const { tenantId, owner, secret, book } = await setup('pay-retry');
    const bk = await book(['3']);
    const p = (
      await owner.call('post', `/tenants/${tenantId}/bookings/${bk.id}/payments`).expect(201)
    ).body as { paymentId: string; redirectUrl: string };
    const sessionId = p.redirectUrl.split('/').pop()!;
    gw.set(sessionId, 'completed');
    const ev = { id: 'evt-retry', name: 'checkout_session.completed', data: { id: sessionId } };

    gw.failGet = true;
    await deliver(tenantId, secret, ev).expect(503); // not recorded, so Monime will retry
    await owner.call('post', `/tenants/${tenantId}/payments/${p.paymentId}/refresh`).expect(502);
    expect(await statusOf(owner, tenantId, bk.id)).toBe('PENDING_PAYMENT');
    gw.failGet = false;

    // The webhook never arrives again; staff refresh instead.
    const r = await owner
      .call('post', `/tenants/${tenantId}/payments/${p.paymentId}/refresh`)
      .expect(200);
    expect(r.body.outcome).toBe('paid');
    expect(await statusOf(owner, tenantId, bk.id)).toBe('CONFIRMED');
    // ...and a late retry of the original event is harmless.
    expect((await deliver(tenantId, secret, ev).expect(200)).body.status).toBe('already_settled');
  }, 300_000);

  it('closes payments when the session expires or is cancelled', async () => {
    const { tenantId, owner, secret, book } = await setup('pay-expire');
    const bk = await book(['4']);
    const p = (
      await owner.call('post', `/tenants/${tenantId}/bookings/${bk.id}/payments`).expect(201)
    ).body as { paymentId: string; redirectUrl: string };
    const sessionId = p.redirectUrl.split('/').pop()!;
    gw.set(sessionId, 'expired');
    expect(
      (
        await deliver(tenantId, secret, {
          id: 'x1',
          name: 'checkout_session.expired',
          data: { id: sessionId },
        }).expect(200)
      ).body.status,
    ).toBe('expired');
    expect(await statusOf(owner, tenantId, bk.id)).toBe('PENDING_PAYMENT'); // still holds seats until its own hold lapses
    const list = (
      await owner.call('get', `/tenants/${tenantId}/bookings/${bk.id}/payments`).expect(200)
    ).body.payments as { status: string }[];
    expect(list[0]!.status).toBe('EXPIRED');
    // The customer can try again.
    await owner.call('post', `/tenants/${tenantId}/bookings/${bk.id}/payments`).expect(201);
  }, 300_000);

  it('flags money received for seats that were already released', async () => {
    const { tenantId, owner, secret, book } = await setup('pay-late');
    const bk = await book(['5']);
    const p = (
      await owner.call('post', `/tenants/${tenantId}/bookings/${bk.id}/payments`).expect(201)
    ).body as { paymentId: string; redirectUrl: string };
    const sessionId = p.redirectUrl.split('/').pop()!;
    // The booking expires (hold lapsed and swept) before the customer finishes paying.
    await plat((tx) =>
      tx.booking.update({
        where: { id: bk.id },
        data: { holdExpiresAt: new Date(Date.now() - 1000) },
      }),
    );
    const { BookingService } = await import('../src/modules/booking/booking.service.js');
    await new BookingService(db).expireDue(100, tenantId);
    expect(await statusOf(owner, tenantId, bk.id)).toBe('EXPIRED');

    gw.set(sessionId, 'completed');
    const out = await deliver(tenantId, secret, {
      id: 'late-1',
      name: 'checkout_session.completed',
      data: { id: sessionId },
    }).expect(200);
    expect(out.body.status).toBe('paid_unfulfilled');
    expect(await statusOf(owner, tenantId, bk.id)).toBe('EXPIRED'); // not resurrected
    const pay = await plat((tx) => tx.payment.findFirstOrThrow({ where: { id: p.paymentId } }));
    expect(pay.status).toBe('PAID_UNFULFILLED');
    const refund = await plat((tx) =>
      tx.outboxEvent.findMany({ where: { tenantId, type: 'payment.refund_required' } }),
    );
    expect(refund).toHaveLength(1);
    expect(refund[0]!.payload).toMatchObject({ paymentId: p.paymentId, amountMinor: 50_000 });
  }, 300_000);

  it('keeps payments private to their company', async () => {
    const a = await setup('pay-iso-a');
    const b = await setup('pay-iso-b');
    const bk = await a.book(['1']);
    const p = (
      await a.owner.call('post', `/tenants/${a.tenantId}/bookings/${bk.id}/payments`).expect(201)
    ).body as { paymentId: string };
    await b.owner.call('post', `/tenants/${b.tenantId}/bookings/${bk.id}/payments`).expect(404);
    await b.owner.call('get', `/tenants/${b.tenantId}/bookings/${bk.id}/payments`).expect(404);
    await b.owner
      .call('post', `/tenants/${b.tenantId}/payments/${p.paymentId}/refresh`)
      .expect(404);
    expect(await withDb(db, { tenantId: b.tenantId }, (tx) => tx.payment.count())).toBe(0);
    expect(await withDb(db, { tenantId: b.tenantId }, (tx) => tx.paymentSettings.count())).toBe(1); // only its own
    const driver = await member(a.tenantId, 'driver');
    await driver.call('post', `/tenants/${a.tenantId}/bookings/${bk.id}/payments`).expect(403);
  }, 300_000);
});
