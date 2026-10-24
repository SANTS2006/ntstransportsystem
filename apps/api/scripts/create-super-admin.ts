/**
 * Operator-only bootstrap: creates the first platform super admin (or makes an existing account
 * one). There is deliberately no default admin and no web page for this.
 *
 *   npm run platform:create-admin -w @nts/api -- you@example.com "Your Full Name"
 *
 * Run it on your own machine with DIRECT_DATABASE_URL (the owner URL of the database you want to
 * change) in the root .env. A new account gets a random one-time password, printed once here and
 * never stored anywhere readable; the account must replace it at its first sign-in. Platform
 * access also needs two-step verification: turn it on under Security after signing in.
 */
/* eslint-disable no-console -- this is an operator CLI; stdout/stderr is its interface */
import { randomBytes } from 'node:crypto';
import '../src/config/dotenv.js';
import { writeAudit } from '../src/modules/audit/audit.js';
import { hashPassword } from '../src/platform/crypto.js';
import { createDb, withDb } from '../src/platform/db.js';

const [emailArg, nameArg] = process.argv.slice(2);
const url = process.env.DIRECT_DATABASE_URL;
if (!emailArg || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailArg) || !url) {
  console.error(
    'Usage: platform:create-admin <email> "<full name>"   (needs DIRECT_DATABASE_URL in .env)',
  );
  process.exit(2);
}
const email = emailArg.trim().toLowerCase();

const db = createDb(url);
try {
  const existing = await db.user.findUnique({ where: { email } });
  let password: string | null = null;
  let userId: string;
  if (existing) {
    if (existing.status !== 'ACTIVE') {
      console.error('That account is not active.');
      process.exit(1);
    }
    userId = existing.id;
  } else {
    if (!nameArg || nameArg.trim().length < 2) {
      console.error('A new account needs a full name: platform:create-admin <email> "<full name>"');
      process.exit(2);
    }
    // 18 random bytes: far beyond guessing, and it must be replaced at first sign-in anyway.
    password = `Adm-${randomBytes(18).toString('base64url')}`;
    userId = (
      await db.user.create({
        data: {
          email,
          displayName: nameArg.trim(),
          emailVerifiedAt: new Date(),
          passwordHash: await hashPassword(password),
          mustChangePassword: true,
        },
      })
    ).id;
  }
  await withDb(db, { platform: true }, async (tx) => {
    await tx.platformRoleAssignment.upsert({
      where: { userId_role: { userId, role: 'SUPER_ADMIN' } },
      create: { userId, role: 'SUPER_ADMIN' },
      update: {},
    });
    await writeAudit(tx, {
      action: 'platform.role_granted',
      outcome: 'SUCCESS',
      targetType: 'user',
      targetId: userId,
      summary: { role: 'SUPER_ADMIN', via: 'cli', newAccount: password !== null },
    });
  });
  if (password) {
    console.log(`Created the super admin ${email}.`);
    console.log(`One-time password (shown once, change it at first sign-in): ${password}`);
  } else {
    console.log(`${email} is now a super admin. Their password is unchanged.`);
  }
  console.log(
    'Next: sign in, choose a new password, then turn on two-step verification (Security).',
  );
} finally {
  await db.$disconnect();
}
