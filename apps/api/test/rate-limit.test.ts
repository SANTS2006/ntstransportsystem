import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/platform/db.js';
import { createDb, makeApp, TEST_DB_URL } from './helpers.js';

describe.skipIf(!TEST_DB_URL)('auth rate limiting (database)', () => {
  let db: Db;
  beforeAll(() => {
    db = createDb(TEST_DB_URL as string);
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('throttles forgot-password after 5 requests with an unscaled limiter', async () => {
    const { app } = makeApp(db, { rateLimitScale: 1 });
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nobody@example.test' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 202)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it('throttles repeated MFA code guesses by IP', async () => {
    const { app } = makeApp(db, { rateLimitScale: 1 });
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) {
      const res = await request(app)
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken: 'x'.repeat(43), code: '123456' });
      statuses.push(res.status);
    }
    expect(statuses.at(-1)).toBe(429);
  });
});
