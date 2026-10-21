import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';
import { AppError } from './errors.js';

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

export function createDb(databaseUrl: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

/**
 * Database access context. Values come from verified server-side state (session + membership),
 * never from request input.
 */
export interface DbContext {
  tenantId?: string | undefined;
  userId?: string | undefined;
  /** Platform-scope access. Callers must be authorized and audited upstream. */
  platform?: boolean | undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOrEmpty(v: string | undefined): string {
  if (v === undefined || v === '') return '';
  if (!UUID_RE.test(v)) throw new Error('Invalid database context identifier');
  return v;
}

/**
 * Runs `fn` in a transaction with RLS context applied. set_config(..., is_local=true) scopes the
 * values to this transaction, so they cannot leak to another request on a pooled connection.
 */
export async function withDb<T>(
  db: Db,
  ctx: DbContext,
  fn: (tx: Tx) => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const tenant = uuidOrEmpty(ctx.tenantId);
  const user = uuidOrEmpty(ctx.userId);
  const platform = ctx.platform ? 'on' : '';
  try {
    return await db.$transaction(
      async (tx: Tx) => {
        await tx.$executeRaw`SELECT
      set_config('app.tenant_id', ${tenant}, true),
      set_config('app.user_id', ${user}, true),
      set_config('app.platform', ${platform}, true)`;
        return fn(tx);
      },
      { timeout: opts.timeoutMs ?? 15_000, maxWait: 20_000 },
    );
  } catch (err) {
    // P2028: Prisma could not start the transaction in time (e.g. slow connection setup or an
    // exhausted pool) or it expired mid-way. The transaction is rolled back, so the caller can
    // safely retry: report "busy" (503) rather than an opaque 500.
    if ((err as { code?: unknown } | null)?.code === 'P2028') {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'The service is busy. Please try again.');
    }
    throw err;
  }
}
