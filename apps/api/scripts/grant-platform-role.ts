/**
 * Operator-only bootstrap: grants a platform role to an existing, verified account.
 *
 * There is deliberately no default admin and no HTTP path to the first platform role. Run this
 * by hand with the DIRECT (owner) database URL, after the person has registered, verified their
 * email, and enrolled MFA (platform access is refused without MFA).
 *
 *   npm run platform:grant -w @nts/api -- someone@example.com SUPER_ADMIN
 */
/* eslint-disable no-console -- this is an operator CLI; stdout/stderr is its interface */
import '../src/config/dotenv.js';
import { createDb, withDb } from '../src/platform/db.js';
import { writeAudit } from '../src/modules/audit/audit.js';

const ROLES = ['SUPER_ADMIN', 'OPERATIONS', 'FINANCE', 'SUPPORT', 'SECURITY_AUDIT'] as const;
type Role = (typeof ROLES)[number];

const [emailArg, roleArg] = process.argv.slice(2);
const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!emailArg || !roleArg || !(ROLES as readonly string[]).includes(roleArg) || !url) {
  console.error(`Usage: platform:grant <email> <${ROLES.join('|')}>  (needs DIRECT_DATABASE_URL)`);
  process.exit(2);
}

const db = createDb(url);
try {
  const email = emailArg.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.emailVerifiedAt || user.status !== 'ACTIVE') {
    console.error('No active, verified account with that email.');
    process.exit(1);
  }
  await withDb(db, { platform: true }, async (tx) => {
    await tx.platformRoleAssignment.upsert({
      where: { userId_role: { userId: user.id, role: roleArg as Role } },
      create: { userId: user.id, role: roleArg as Role },
      update: {},
    });
    await writeAudit(tx, {
      action: 'platform.role_granted',
      outcome: 'SUCCESS',
      targetType: 'user',
      targetId: user.id,
      summary: { role: roleArg, via: 'cli' },
    });
  });
  console.log(
    `Granted ${roleArg} to ${email}.${user.mfaEnabled ? '' : ' They must enroll MFA before platform access works.'}`,
  );
} finally {
  await db.$disconnect();
}
