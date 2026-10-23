/**
 * Prepares an EMPTY Postgres database (for example a fresh Neon project) for the application:
 *
 *  1. creates the restricted `nts_app` role (no superuser, no BYPASSRLS) the app connects as;
 *  2. applies every migration as the owner;
 *  3. re-applies each migration's grant/revoke block, so privileges are right whichever order the
 *     role and the tables came into being;
 *  4. proves the role is restricted, then prints the connection string the app should use.
 *
 * Run it from your own machine; the owner URL never needs to be given to the hosting service.
 * It reads ONLY OWNER_DATABASE_URL (not .env), so it cannot touch a database by accident:
 *
 *   OWNER_DATABASE_URL="postgresql://owner:...@ep-xxx.region.aws.neon.tech/neondb?sslmode=require" \
 *     npm run db:provision -w @nts/api
 *
 * Optional: NTS_APP_PASSWORD (16+ letters/digits/_/-) to choose the role's password; otherwise one
 * is generated and printed once. Re-running is safe; an existing role keeps its password unless
 * NTS_APP_PASSWORD is given.
 */
/* eslint-disable no-console -- operator CLI; stdout/stderr is its interface */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const migrationsDir = resolve(import.meta.dirname, '../prisma/migrations');

/** The `DO $$ ... nts_app ... $$;` blocks of every migration, in order. */
export function grantBlocks(sqlByMigration: string[]): string[] {
  const out: string[] = [];
  for (const sql of sqlByMigration) {
    for (const m of sql.matchAll(/DO \$\$[\s\S]*?END \$\$;/g)) {
      if (m[0].includes('nts_app')) out.push(m[0]);
    }
  }
  return out;
}

/** Neon's pooled endpoint is the same host with `-pooler` after the endpoint id. */
export function pooledHost(host: string): string {
  const [first = '', ...rest] = host.split('.');
  return first.endsWith('-pooler') ? host : [`${first}-pooler`, ...rest].join('.');
}

async function main() {
  const ownerUrl = process.env.OWNER_DATABASE_URL;
  if (!ownerUrl) {
    console.error(
      'Set OWNER_DATABASE_URL to the owner (direct) connection string. See the file header.',
    );
    process.exit(2);
  }
  const owner = new URL(ownerUrl);
  owner.searchParams.delete('channel_binding');
  const dbName = owner.pathname.slice(1);
  if (!dbName) {
    console.error('OWNER_DATABASE_URL must name a database.');
    process.exit(2);
  }
  const given = process.env.NTS_APP_PASSWORD;
  if (given !== undefined && !/^[A-Za-z0-9_-]{16,}$/.test(given)) {
    console.error('NTS_APP_PASSWORD must be 16+ letters, digits, _ or -.');
    process.exit(2);
  }

  const c = new pg.Client({ connectionString: owner.toString(), connectionTimeoutMillis: 120_000 });
  await c.connect();
  let password = given;
  try {
    const exists = (await c.query("SELECT 1 FROM pg_roles WHERE rolname = 'nts_app'")).rowCount;
    if (!exists) {
      password ??= randomBytes(24).toString('hex');
      await c.query(`CREATE ROLE nts_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);
      console.log('Created role nts_app.');
    } else if (password) {
      await c.query(`ALTER ROLE nts_app PASSWORD '${password}'`);
      console.log('Role nts_app existed: password updated.');
    } else {
      console.log('Role nts_app already exists: its password is unchanged and will not be shown.');
    }
    await c.query(`GRANT CONNECT ON DATABASE "${dbName.replaceAll('"', '')}" TO nts_app`);
  } finally {
    await c.end();
  }

  console.log('Applying migrations...');
  const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      DIRECT_DATABASE_URL: (() => {
        const u = new URL(owner.toString());
        u.searchParams.set('connect_timeout', '120');
        return u.toString();
      })(),
    },
    stdio: 'inherit',
    shell: true,
  });
  if (migrate.status !== 0) {
    console.error('Migrations failed; nothing else was changed.');
    process.exit(1);
  }

  const c2 = new pg.Client({
    connectionString: owner.toString(),
    connectionTimeoutMillis: 120_000,
  });
  await c2.connect();
  try {
    const names = readdirSync(migrationsDir)
      .filter((n) => /^\d/.test(n))
      .sort();
    const blocks = grantBlocks(
      names.map((n) => readFileSync(resolve(migrationsDir, n, 'migration.sql'), 'utf8')),
    );
    for (const b of blocks) await c2.query(b);
    console.log(`Re-applied ${blocks.length} privilege blocks.`);
  } finally {
    await c2.end();
  }

  if (!password) {
    console.log(
      'Done. Build the app URL yourself: postgresql://nts_app:<password>@<pooled host>/<db>?sslmode=require',
    );
    return;
  }
  const app = new URL(owner.toString());
  app.username = 'nts_app';
  app.password = password;
  app.hostname = pooledHost(app.hostname);
  app.search = '?sslmode=require';

  const check = new pg.Client({
    connectionString: app.toString(),
    connectionTimeoutMillis: 120_000,
  });
  await check.connect();
  try {
    const who = (
      await check.query(
        'SELECT current_user AS u, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass',
      )
    ).rows[0] as { u: string; bypass: boolean };
    let deleteDenied = false;
    try {
      await check.query('DELETE FROM audit_logs');
    } catch (e) {
      deleteDenied = /permission denied/.test((e as Error).message);
    }
    if (who.u !== 'nts_app' || who.bypass || !deleteDenied) {
      throw new Error('The app role is not restricted as expected; do not use it.');
    }
    console.log('Verified: nts_app cannot bypass row-level security and cannot delete audit logs.');
  } finally {
    await check.end();
  }

  console.log('\nSet this as DATABASE_URL on the app (shown once, not saved anywhere):\n');
  console.log(app.toString());
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((e: Error) => {
    console.error('Failed:', e.message);
    process.exit(1);
  });
}
