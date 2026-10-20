import { describe, expect, it } from 'vitest';
import { dbErrorKind } from './db-errors.js';
import { withDb, type Db } from './db.js';
import { AppError } from './errors.js';

const fakeDb = (impl: () => Promise<unknown>) => ({ $transaction: impl }) as unknown as Db;

describe('withDb error handling', () => {
  it('reports a transaction that could not start in time as a retryable 503', async () => {
    const db = fakeDb(() =>
      Promise.reject(Object.assign(new Error('Unable to start a transaction'), { code: 'P2028' })),
    );
    const err = await withDb(db, {}, async () => 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
  });

  it('passes other errors through unchanged', async () => {
    const boom = new Error('boom');
    await expect(
      withDb(
        fakeDb(() => Promise.reject(boom)),
        {},
        async () => 1,
      ),
    ).rejects.toBe(boom);
  });

  it('rejects malformed context identifiers before touching the database', async () => {
    let called = false;
    const db = fakeDb(async () => {
      called = true;
    });
    await expect(withDb(db, { tenantId: "'; DROP TABLE x;--" }, async () => 1)).rejects.toThrow(
      /Invalid database context/,
    );
    expect(called).toBe(false);
  });
});

describe('dbErrorKind', () => {
  it('classifies constraint violations from Prisma codes and driver text', () => {
    expect(dbErrorKind({ code: 'P2002', message: 'x' })).toBe('unique');
    expect(dbErrorKind({ code: 'P2003', message: 'x' })).toBe('foreign_key');
    expect(
      dbErrorKind(
        new Error('conflicting key value violates exclusion constraint "trips_vehicle_no_overlap"'),
      ),
    ).toBe('exclusion');
    expect(
      dbErrorKind(new Error('new row violates check constraint "trips_times_chk" (23514)')),
    ).toBe('check');
    expect(dbErrorKind(new Error('something else'))).toBeNull();
    expect(dbErrorKind('not an error')).toBeNull();
  });
});
