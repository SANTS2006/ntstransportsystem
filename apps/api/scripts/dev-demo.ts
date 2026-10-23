/**
 * Local demo harness for exercising the payment and passenger flows in a browser. DEV ONLY.
 *
 * - Starts a tiny mock "Monime" HTTP server (the real one is never contacted).
 * - Seeds one demo company (+ owner, + passenger) on TEST_DATABASE_URL, once.
 * - Starts the real API against TEST_DATABASE_URL with MONIME_API_BASE pointing at the mock.
 * - GET http://localhost:4010/_complete/<sessionId> marks a session paid and delivers a correctly
 *   signed webhook to the API, exactly as Monime would.
 *
 * Credentials are generated per run, written to the git-ignored .dev-payments.json and never printed.
 *
 *   npx tsx scripts/dev-demo.ts      (from apps/api)
 */
/* eslint-disable no-console -- operator CLI */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { config } from 'dotenv';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run the demo harness in production.');
  process.exit(2);
}
config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error('TEST_DATABASE_URL is required.');
  process.exit(2);
}
// Demo-only encryption key (kept in the git-ignored credentials file) when .env has none.
const credsPath = resolve(import.meta.dirname, '../../../.dev-payments.json');
let demoKey = process.env.MFA_ENCRYPTION_KEY;
if (!demoKey) {
  try {
    demoKey = (JSON.parse(readFileSync(credsPath, 'utf8')) as { demoKey?: string }).demoKey;
  } catch {
    /* first run */
  }
  demoKey ??= randomBytes(32).toString('base64');
  process.env.MFA_ENCRYPTION_KEY = demoKey;
}
// Point the app at the restricted test database and at the mock provider.
process.env.DATABASE_URL = testUrl;
process.env.MONIME_API_BASE = 'http://localhost:4010/v1';
process.env.PORT = '4000';
process.env.STORAGE_DEV_DIR = process.env.STORAGE_DEV_DIR ?? '.dev-storage';

const { hashPassword } = await import('../src/platform/crypto.js');
const { createDb, withDb } = await import('../src/platform/db.js');
const { SecretBox } = await import('../src/platform/secretbox.js');
const { TenantService } = await import('../src/modules/tenants/tenant.service.js');
const { signMonime } = await import('../src/modules/payment/gateway.js');

const db = createDb(testUrl);
const box = new SecretBox(demoKey);
const password = () => `Dev-${randomBytes(9).toString('base64url')}-x1`;

// ---- Seed (once) -----------------------------------------------------------------------------
const SLUG = 'demo-coaches';
const existing = await withDb(db, { platform: true }, (tx) =>
  tx.tenant.findUnique({ where: { slug: SLUG } }),
);
const creds: Record<string, unknown> = { note: 'Dev-only credentials. Git-ignored.' };
let tenantId: string;
let webhookSecret = randomBytes(32).toString('base64url');
if (!existing) {
  const ownerPw = password();
  const paxPw = password();
  const mk = async (email: string, name: string, pw: string) =>
    db.user.create({
      data: {
        email,
        displayName: name,
        emailVerifiedAt: new Date(),
        passwordHash: await hashPassword(pw),
      },
    });
  const owner = await mk('demo-owner@example.test', 'Demo Owner', ownerPw);
  await mk('demo-passenger@example.test', 'Demo Passenger', paxPw);
  tenantId = await withDb(db, { platform: true }, async (tx) => {
    const t = await tx.tenant.create({
      data: { name: 'Demo Coaches', slug: SLUG, status: 'ACTIVE' },
    });
    const roleId = await TenantService.seedRoles(tx, t.id);
    await tx.membership.create({
      data: { tenantId: t.id, userId: owner.id, roleId, status: 'ACTIVE' },
    });
    await tx.paymentSettings.create({
      data: {
        tenantId: t.id,
        spaceId: 'spc-demo',
        apiTokenEnc: box.encrypt('mon_test_demo_token_not_real'),
        webhookSecretEnc: box.encrypt(webhookSecret),
      },
    });
    const locs = await tx.location.createManyAndReturn({
      data: [
        { tenantId: t.id, name: 'Freetown Terminal', city: 'Freetown' },
        { tenantId: t.id, name: 'Bo Terminal', city: 'Bo' },
      ],
    });
    const route = await tx.route.create({
      data: {
        tenantId: t.id,
        name: 'Freetown - Bo',
        originId: locs[0]!.id,
        destinationId: locs[1]!.id,
        distanceM: 250_000,
        durationMin: 240,
        status: 'PUBLISHED',
      },
    });
    await tx.fare.create({ data: { tenantId: t.id, routeId: route.id, amountMinor: 150_000 } });
    const vehicle = await tx.vehicle.create({
      data: { tenantId: t.id, registration: 'SLE-1001', seatingCapacity: 12, type: 'BUS' },
    });
    for (const d of [1, 2, 3]) {
      const dep = new Date(Date.now() + d * 86_400_000);
      dep.setUTCHours(8, 0, 0, 0);
      await tx.trip.create({
        data: {
          tenantId: t.id,
          routeId: route.id,
          serviceDate: new Date(dep.toISOString().slice(0, 10)),
          departureAt: dep,
          arrivalAt: new Date(dep.getTime() + 4 * 3_600_000),
          vehicleId: vehicle.id,
        },
      });
    }
    return t.id;
  });
  creds.owner = { email: 'demo-owner@example.test', password: ownerPw };
  creds.passenger = { email: 'demo-passenger@example.test', password: paxPw };
  creds.tenantId = tenantId;
  creds.webhookSecret = webhookSecret;
  creds.demoKey = demoKey;
  writeFileSync(
    resolve(import.meta.dirname, '../../../.dev-payments.json'),
    JSON.stringify(creds, null, 2),
  );
  console.log('Seeded Demo Coaches. Credentials are in .dev-payments.json (git-ignored).');
} else {
  tenantId = existing.id;
  const saved = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../../.dev-payments.json'), 'utf8'),
  ) as { webhookSecret: string };
  webhookSecret = saved.webhookSecret;
  console.log('Demo company already seeded; reusing it (see .dev-payments.json).');
}

// ---- Extras for browsing the newer pages (idempotent) ----------------------------------------
{
  const OTPAuth = await import('otpauth');
  const { issueTicketsInTx } = await import('../src/modules/ticket/ticket-core.js');
  const saved = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../../.dev-payments.json'), 'utf8'),
  ) as Record<string, unknown>;

  // A platform operator with MFA, to switch maintenance mode from the admin pages.
  if (!saved.ops) {
    const pw = password();
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    const ops = await db.user.create({
      data: {
        email: 'demo-ops@example.test',
        displayName: 'Demo Operator',
        emailVerifiedAt: new Date(),
        passwordHash: await hashPassword(pw),
        mfaEnabled: true,
      },
    });
    await db.mfaCredential.create({
      data: { userId: ops.id, secretEnc: box.encrypt(secret), confirmedAt: new Date() },
    });
    await withDb(db, { platform: true }, (tx) =>
      tx.platformRoleAssignment.create({ data: { userId: ops.id, role: 'OPERATIONS' } }),
    );
    saved.ops = { email: 'demo-ops@example.test', password: pw, totpSecret: secret };
    writeFileSync(
      resolve(import.meta.dirname, '../../../.dev-payments.json'),
      JSON.stringify(saved, null, 2),
    );
    console.log('Created a platform operator (see .dev-payments.json).');
  }

  await withDb(db, { platform: true }, async (tx) => {
    const pax = await tx.user.findUniqueOrThrow({
      where: { email: 'demo-passenger@example.test' },
    });
    const route = await tx.route.findFirstOrThrow({ where: { tenantId, name: 'Freetown - Bo' } });
    let bus2 = await tx.vehicle.findFirst({ where: { tenantId, registration: 'SLE-1002' } });
    bus2 ??= await tx.vehicle.create({
      data: { tenantId, registration: 'SLE-1002', seatingCapacity: 12, type: 'BUS' },
    });
    const now = Date.now();
    // A trip leaving in about 90 minutes: boarding is open (it opens 3 hours before departure).
    const soon = await tx.trip.findFirst({
      where: {
        tenantId,
        vehicleId: bus2.id,
        departureAt: { gt: new Date(now), lt: new Date(now + 6 * 3_600_000) },
      },
    });
    if (!soon) {
      const dep = new Date(now + 90 * 60_000);
      await tx.trip.create({
        data: {
          tenantId,
          routeId: route.id,
          serviceDate: new Date(dep.toISOString().slice(0, 10)),
          departureAt: dep,
          arrivalAt: new Date(dep.getTime() + 4 * 3_600_000),
          vehicleId: bus2.id,
        },
      });
    }
    // A finished trip with a paid booking by the demo passenger, for ratings and complaints.
    const done = await tx.booking.findFirst({ where: { tenantId, reference: 'DEMODONE01' } });
    if (!done) {
      const dep = new Date(now - 2 * 86_400_000);
      const trip = await tx.trip.create({
        data: {
          tenantId,
          routeId: route.id,
          serviceDate: new Date(dep.toISOString().slice(0, 10)),
          departureAt: dep,
          arrivalAt: new Date(dep.getTime() + 4 * 3_600_000),
          vehicleId: bus2.id,
          status: 'COMPLETED',
        },
      });
      const b = await tx.booking.create({
        data: {
          tenantId,
          tripId: trip.id,
          reference: 'DEMODONE01',
          status: 'CONFIRMED',
          contactName: 'Demo Passenger',
          contactPhone: '+23276000111',
          totalMinor: 150_000,
          currency: 'SLE',
          createdByUserId: pax.id,
        },
      });
      await tx.bookingPassenger.createMany({
        data: [
          {
            tenantId,
            bookingId: b.id,
            tripId: trip.id,
            seatLabel: '3',
            fullName: 'Demo Passenger',
            fareMinor: 150_000,
          },
        ],
      });
      await tx.bookingStatusHistory.createMany({
        data: [{ tenantId, bookingId: b.id, fromStatus: null, toStatus: 'CONFIRMED' }],
      });
      await issueTicketsInTx(tx, tenantId, b.id);
      console.log('Seeded a completed trip with a paid booking (DEMODONE01).');
    }
  });
}

// ---- Mock Monime ----------------------------------------------------------------------------
interface Session {
  status: 'pending' | 'completed' | 'expired' | 'cancelled';
  reference: string;
  lineItems: { price: { currency: string; value: number }; quantity: number }[];
}
const sessions = new Map<string, Session>();
const readBody = (req: IncomingMessage) =>
  new Promise<string>((ok) => {
    let s = '';
    req.on('data', (c: Buffer) => (s += c.toString()));
    req.on('end', () => ok(s));
  });
const send = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost:4010');
    if (req.method === 'POST' && url.pathname === '/v1/checkout-sessions') {
      if (
        !req.headers.authorization?.startsWith('Bearer mon_') ||
        !req.headers['monime-space-id']
      ) {
        return send(res, 401, { success: false, error: { message: 'unauthorized' } });
      }
      const b = JSON.parse(await readBody(req)) as Session & { reference: string };
      const id = `cs-demo-${randomBytes(6).toString('hex')}`;
      sessions.set(id, { status: 'pending', reference: b.reference, lineItems: b.lineItems });
      console.log(`[mock-monime] session ${id} created for payment ${b.reference}`);
      return send(res, 200, {
        success: true,
        result: {
          id,
          status: 'pending',
          redirectUrl: `https://pay.monime.test/checkout/${id}`,
          reference: b.reference,
        },
      });
    }
    const get = /^\/v1\/checkout-sessions\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'GET' && get) {
      const s = sessions.get(get[1]!);
      if (!s) return send(res, 404, { success: false });
      return send(res, 200, {
        success: true,
        result: {
          id: get[1],
          status: s.status,
          reference: s.reference,
          lineItems: { data: s.lineItems },
        },
      });
    }
    const done = /^\/_(complete|expire)\/([^/]+)$/.exec(url.pathname);
    if (done) {
      const s = sessions.get(done[2]!);
      if (!s) return send(res, 404, { error: 'unknown session' });
      s.status = done[1] === 'complete' ? 'completed' : 'expired';
      const raw = Buffer.from(
        JSON.stringify({
          apiVersion: 'caph',
          event: {
            id: `evt-${randomBytes(6).toString('hex')}`,
            name: `checkout_session.${s.status}`,
            timestamp: String(Math.floor(Date.now() / 1000)),
          },
          data: { id: done[2], reference: s.reference, status: s.status },
        }),
      );
      const hook = await fetch(`http://localhost:4000/api/v1/webhooks/monime/${tenantId}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'monime-signature': signMonime(raw, webhookSecret, Math.floor(Date.now() / 1000)),
        },
        body: raw.toString(),
      }).catch(() => null);
      const text = hook ? await hook.text() : 'API unreachable';
      return send(res, 200, { session: s.status, webhookStatus: hook?.status, response: text });
    }
    send(res, 404, { error: 'not found' });
  })();
}).listen(4010, () => console.log('[mock-monime] listening on :4010'));

// ---- Real API against the test database ---------------------------------------------------------
await import('../src/server.js');
