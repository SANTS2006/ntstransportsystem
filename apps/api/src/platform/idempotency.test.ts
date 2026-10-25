import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { idempotency } from './idempotency.js';

function build(delayMs = 0) {
  let runs = 0;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { auth: { userId: string } }).auth = {
      userId: String(req.headers['x-user'] ?? 'u1'),
    };
    next();
  });
  app.use(idempotency());
  app.post('/make', async (req, res) => {
    runs += 1;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (req.body.fail) return res.status(500).json({ error: 'boom' });
    res.status(201).json({ n: runs });
  });
  return { app, runs: () => runs };
}
const KEY = 'abcdefgh-1234';

describe('idempotency', () => {
  it('runs a repeated write once and replays the answer', async () => {
    const { app, runs } = build();
    const a = await request(app).post('/make').set('idempotency-key', KEY).send({ x: 1 });
    const b = await request(app).post('/make').set('idempotency-key', KEY).send({ x: 1 });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body).toEqual(a.body);
    expect(b.headers['idempotent-replay']).toBe('true');
    expect(runs()).toBe(1);
  });

  it('makes simultaneous repeats wait for the first', async () => {
    const { app, runs } = build(80);
    const send = () => request(app).post('/make').set('idempotency-key', KEY).send({ x: 1 });
    const all = await Promise.all([send(), send(), send()]);
    expect(all.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(all.map((r) => r.body.n)).size).toBe(1);
    expect(runs()).toBe(1);
  });

  it('treats a different body, key or person as a different request', async () => {
    const { app, runs } = build();
    await request(app).post('/make').set('idempotency-key', KEY).send({ x: 1 });
    await request(app).post('/make').set('idempotency-key', KEY).send({ x: 2 });
    await request(app).post('/make').set('idempotency-key', 'another-key-1').send({ x: 1 });
    await request(app).post('/make').set('idempotency-key', KEY).set('x-user', 'u2').send({ x: 1 });
    expect(runs()).toBe(4);
  });

  it('does not remember server errors, so the retry runs again', async () => {
    const { app, runs } = build();
    const a = await request(app).post('/make').set('idempotency-key', KEY).send({ fail: true });
    const b = await request(app).post('/make').set('idempotency-key', KEY).send({ fail: true });
    expect([a.status, b.status]).toEqual([500, 500]);
    expect(runs()).toBe(2);
  });

  it('ignores requests without a key', async () => {
    const { app, runs } = build();
    await request(app).post('/make').send({ x: 1 });
    await request(app).post('/make').send({ x: 1 });
    expect(runs()).toBe(2);
  });
});
