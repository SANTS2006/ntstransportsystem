import { createHash } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface Stored {
  status: number;
  body: Buffer | undefined;
  contentType: string | undefined;
  at: number;
}

/**
 * Makes a signed-in person's write safe to send twice. The browser tags every write with an
 * `Idempotency-Key`; when the same key arrives again with the same request (a double click, or a
 * retry after a slow link dropped the answer) the server does not run it a second time: while the
 * first is still working the repeat waits for it, and afterwards it gets the same answer back.
 * A different body under the same key is treated as a different request. Server errors are not
 * remembered, so a failed attempt can be tried again. Kept in memory for a few minutes.
 */
export function idempotency(
  opts: { ttlMs?: number; max?: number; now?: () => number } = {},
): RequestHandler {
  const ttl = opts.ttlMs ?? 10 * 60_000;
  const max = opts.max ?? 5000;
  const now = opts.now ?? Date.now;
  const done = new Map<string, Stored>();
  const running = new Map<string, Promise<Stored | null>>();

  const sweep = () => {
    const cutoff = now() - ttl;
    for (const [k, v] of done) if (v.at < cutoff) done.delete(k);
    while (done.size > max) done.delete(done.keys().next().value as string);
  };

  const replay = (res: Response, s: Stored) => {
    res.setHeader('Idempotent-Replay', 'true');
    res.status(s.status);
    if (s.contentType) res.setHeader('Content-Type', s.contentType);
    res.end(s.body);
  };

  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.get('idempotency-key');
    if (!WRITES.has(req.method) || !header || !req.auth) return next();
    if (!KEY_RE.test(header)) return next();
    const raw = Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body ?? null);
    const fingerprint = createHash('sha256')
      .update(`${req.auth.userId}\n${req.method}\n${req.originalUrl}\n${header}\n`)
      .update(raw)
      .digest('hex');

    sweep();
    const hit = done.get(fingerprint);
    if (hit) return replay(res, hit);
    const pending = running.get(fingerprint);
    if (pending) {
      void pending.then((s) => {
        if (s) replay(res, s);
        else next(); // the first attempt failed on the server: this one tries for itself
      });
      return;
    }

    let settle!: (s: Stored | null) => void;
    running.set(
      fingerprint,
      new Promise<Stored | null>((r) => {
        settle = r;
      }),
    );
    const chunks: Buffer[] = [];
    const write = res.write.bind(res) as (...a: unknown[]) => boolean;
    const end = res.end.bind(res) as (...a: unknown[]) => Response;
    res.write = ((chunk: unknown, ...rest: unknown[]) => {
      if (chunk) chunks.push(Buffer.from(chunk as string | Uint8Array));
      return write(chunk, ...rest);
    }) as typeof res.write;
    res.end = ((chunk?: unknown, ...rest: unknown[]) => {
      if (chunk && typeof chunk !== 'function')
        chunks.push(Buffer.from(chunk as string | Uint8Array));
      const out = end(chunk, ...rest);
      const stored: Stored = {
        status: res.statusCode,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
        contentType: res.getHeader('content-type')?.toString(),
        at: now(),
      };
      running.delete(fingerprint);
      if (res.statusCode < 500) {
        done.set(fingerprint, stored);
        settle(stored);
      } else settle(null);
      return out;
    }) as typeof res.end;
    res.on('close', () => {
      // The caller went away before an answer: let a waiting repeat run it itself.
      if (running.has(fingerprint)) {
        running.delete(fingerprint);
        settle(null);
      }
    });
    next();
  };
}
