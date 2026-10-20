import type { Router as ExpressRouter } from 'express';
import { Router } from '../../platform/router.js';

export interface ReadinessCheck {
  name: string;
  check: () => Promise<void>;
}

/**
 * Public health endpoints expose only up/down status, never internal detail.
 * /live: process is running. /ready: dependencies reachable.
 */
export function healthRouter(checks: ReadinessCheck[]): ExpressRouter {
  const router = Router();

  router.get('/live', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/ready', async (_req, res) => {
    const results = await Promise.all(
      checks.map(async ({ check }) => {
        try {
          await Promise.race([
            check(),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
          ]);
          return true;
        } catch {
          return false;
        }
      }),
    );
    const ok = results.every(Boolean);
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'unavailable' });
  });

  return router;
}
