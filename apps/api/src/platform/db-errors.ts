import { AppError } from './errors.js';

export type DbErrorKind = 'unique' | 'foreign_key' | 'exclusion' | 'check';

/**
 * Classifies a database error by SQLSTATE / Prisma code so callers can turn constraint violations
 * into precise client errors instead of 500s. Looks at both Prisma's code and the driver text,
 * because the adapter surfaces the SQLSTATE in different places depending on the failure.
 */
export function dbErrorKind(err: unknown): DbErrorKind | null {
  if (typeof err !== 'object' || err === null) return null;
  const code = (err as { code?: unknown }).code;
  let text: string;
  try {
    text = `${(err as Error).message ?? ''} ${JSON.stringify((err as { meta?: unknown }).meta ?? {})}`;
  } catch {
    text = String((err as Error).message ?? '');
  }
  if (/23P01|exclusion|_no_overlap/i.test(text)) return 'exclusion';
  if (code === 'P2002' || /\b23505\b|unique constraint/i.test(text)) return 'unique';
  if (code === 'P2003' || /\b23503\b|foreign key/i.test(text)) return 'foreign_key';
  if (/\b23514\b|check constraint/i.test(text)) return 'check';
  return null;
}

/** Runs `fn`; maps known constraint failures to AppErrors using the provided messages. */
export async function mapDbErrors<T>(
  fn: () => Promise<T>,
  messages: Partial<Record<DbErrorKind, string>>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) throw err;
    const kind = dbErrorKind(err);
    const msg = kind ? messages[kind] : undefined;
    if (kind && msg) {
      throw kind === 'check' ? AppError.validation(msg) : AppError.conflict(msg);
    }
    throw err;
  }
}
