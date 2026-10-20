/**
 * Development seed. Creates demo accounts and one demo company so the UI can be exercised.
 *
 * - Refuses to run when NODE_ENV=production.
 * - Idempotent: existing demo accounts are left as they are.
 * - Passwords are generated per run and written to `.dev-seed.json` (git-ignored), never printed.
 * - Uses DATABASE_URL, so run it with the restricted application role like the app itself.
 *
 *   npm run seed:dev -w @nts/api
 */
/* eslint-disable no-console -- operator CLI */
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as OTPAuth from 'otpauth';
import '../src/config/dotenv.js';
import { hashToken, hashPassword } from '../src/platform/crypto.js';
import { createDb, withDb } from '../src/platform/db.js';
import { SecretBox } from '../src/platform/secretbox.js';
import { TenantService } from '../src/modules/tenants/tenant.service.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(2);
}
const url = process.env.DATABASE_URL;
const mfaKey = process.env.MFA_ENCRYPTION_KEY;
if (!url || !mfaKey) {
  console.error('DATABASE_URL and MFA_ENCRYPTION_KEY are required.');
  process.exit(2);
}

const db = createDb(url);
const box = new SecretBox(mfaKey);
const out: Record<string, unknown> = {
  note: 'Dev-only credentials. Git-ignored. Not for production.',
};
const password = () => `Dev-${randomBytes(9).toString('base64url')}-x1`;

async function user(email: string, displayName: string) {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { id: existing.id, created: false, pw: undefined as string | undefined };
  const pw = password();
  const created = await db.user.create({
    data: { email, displayName, emailVerifiedAt: new Date(), passwordHash: await hashPassword(pw) },
  });
  return { id: created.id, created: true, pw };
}

try {
  const owner = await user('owner@dev.test', 'Olivia Owner');
  const driver = await user('driver@dev.test', 'Dave Driver');
  const applicant = await user('applicant@dev.test', 'Amara Applicant');
  const invitee = await user('invitee@dev.test', 'Ivy Invitee');
  const ops = await user('ops@dev.test', 'Omar Operations');

  // Platform operator with MFA (TOTP secret generated here so the UI flow can be driven).
  let opsSecret: string | undefined;
  if (ops.created) {
    opsSecret = new OTPAuth.Secret({ size: 20 }).base32;
    await db.mfaCredential.create({
      data: { userId: ops.id, secretEnc: box.encrypt(opsSecret), confirmedAt: new Date() },
    });
    await db.user.update({ where: { id: ops.id }, data: { mfaEnabled: true } });
    await withDb(db, { platform: true }, (tx) =>
      tx.platformRoleAssignment.create({ data: { userId: ops.id, role: 'OPERATIONS' } }),
    );
  }

  const inviteToken = randomBytes(32).toString('base64url');
  const companies = await withDb(db, { platform: true }, async (tx) => {
    let demo = await tx.tenant.findFirst({ where: { name: 'Demo Coaches' } });
    let pending = await tx.tenant.findFirst({ where: { name: 'Pending Transport' } });
    if (!demo) {
      demo = await tx.tenant.create({
        data: {
          name: 'Demo Coaches',
          slug: `demo-coaches-${randomBytes(3).toString('hex')}`,
          status: 'ACTIVE',
          timezone: 'Africa/Freetown',
        },
      });
      const ownerRole = await TenantService.seedRoles(tx, demo.id);
      await tx.membership.create({
        data: { tenantId: demo.id, userId: owner.id, roleId: ownerRole, status: 'ACTIVE' },
      });
      const driverRole = await tx.role.findFirstOrThrow({
        where: { tenantId: demo.id, key: 'driver' },
      });
      await tx.membership.create({
        data: { tenantId: demo.id, userId: driver.id, roleId: driverRole.id, status: 'ACTIVE' },
      });
      await tx.invitation.create({
        data: {
          tenantId: demo.id,
          email: 'invitee@dev.test',
          roleId: driverRole.id,
          tokenHash: hashToken(inviteToken),
          invitedBy: owner.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
        },
      });
      out.inviteLink = `http://localhost:5173/accept-invitation?token=${inviteToken}`;
    }
    if (!pending) {
      pending = await tx.tenant.create({
        data: {
          name: 'Pending Transport',
          slug: `pending-transport-${randomBytes(3).toString('hex')}`,
          status: 'PENDING',
        },
      });
      const ownerRole = await TenantService.seedRoles(tx, pending.id);
      await tx.membership.create({
        data: { tenantId: pending.id, userId: applicant.id, roleId: ownerRole, status: 'ACTIVE' },
      });
    }
    return { demo: demo.id, pending: pending.id };
  });

  out.accounts = {
    owner: { email: 'owner@dev.test', password: owner.pw ?? '(existing account)' },
    driver: { email: 'driver@dev.test', password: driver.pw ?? '(existing account)' },
    applicant: { email: 'applicant@dev.test', password: applicant.pw ?? '(existing account)' },
    invitee: { email: 'invitee@dev.test', password: invitee.pw ?? '(existing account)' },
    ops: {
      email: 'ops@dev.test',
      password: ops.pw ?? '(existing account)',
      totpSecret: opsSecret ?? '(existing account)',
    },
  };
  out.companies = companies;
  writeFileSync(resolve(process.cwd(), '../../.dev-seed.json'), JSON.stringify(out, null, 2));
  console.log('Seeded. Credentials written to .dev-seed.json (git-ignored).');
} finally {
  await db.$disconnect();
}
