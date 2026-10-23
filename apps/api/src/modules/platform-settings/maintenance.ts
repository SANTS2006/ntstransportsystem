import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
  Router as ExpressRouter,
} from 'express';
import { z } from 'zod';
import type { Logger } from 'pino';
import { withDb, type Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { Router } from '../../platform/router.js';
import { writeAudit } from '../audit/audit.js';
import { requireAuth } from '../authentication/session.middleware.js';
import { platformGuard } from '../tenants/tenant.guards.js';

export interface MaintenanceState {
  enabled: boolean;
  message: string | null;
  since: string | null;
}
const OFF: MaintenanceState = { enabled: false, message: null, since: null };

/**
 * Platform-wide maintenance switch. The state is cached for a few seconds so the gate costs no
 * database round trip per request; other instances notice a change within one cache period.
 */
export class MaintenanceModeService {
  private cached: { at: number; state: MaintenanceState } | null = null;
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
    private readonly ttlMs = 5_000,
  ) {}

  async get(): Promise<MaintenanceState> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < this.ttlMs) return this.cached.state;
    try {
      const row = await withDb(this.db, {}, (tx) =>
        tx.platformSetting.findUnique({ where: { id: 'singleton' } }),
      );
      const state: MaintenanceState = row?.maintenanceEnabled
        ? {
            enabled: true,
            message: row.maintenanceMessage,
            since: row.maintenanceSince?.toISOString() ?? null,
          }
        : OFF;
      this.cached = { at: now, state };
      return state;
    } catch (err) {
      // Fail open: if the setting cannot be read, the request is about to fail on its own anyway,
      // and blocking everything on a read error would turn a blip into an outage.
      this.logger.warn(
        { err: err instanceof Error ? err.message : 'read failed' },
        'maintenance state unreadable',
      );
      return this.cached?.state ?? OFF;
    }
  }

  async set(
    userId: string,
    input: { enabled: boolean; message?: string | undefined },
    requestId?: string,
  ): Promise<MaintenanceState> {
    const state = await withDb(this.db, { platform: true, userId }, async (tx) => {
      const current = await tx.platformSetting.findUnique({ where: { id: 'singleton' } });
      const data = input.enabled
        ? {
            maintenanceEnabled: true,
            maintenanceMessage: input.message as string,
            // Keep the original start time if it is already on, so a message edit is not a new outage.
            maintenanceSince: current?.maintenanceEnabled
              ? (current.maintenanceSince ?? new Date())
              : new Date(),
            updatedBy: userId,
          }
        : {
            maintenanceEnabled: false,
            maintenanceMessage: null,
            maintenanceSince: null,
            updatedBy: userId,
          };
      await tx.platformSetting.update({ where: { id: 'singleton' }, data });
      await writeAudit(tx, {
        action: 'platform.maintenance_set',
        outcome: 'SUCCESS',
        actorUserId: userId,
        targetType: 'platform_settings',
        targetId: 'singleton',
        requestId,
        summary: { enabled: input.enabled },
      });
      return input.enabled
        ? {
            enabled: true,
            message: data.maintenanceMessage as string,
            since: (data.maintenanceSince as Date).toISOString(),
          }
        : OFF;
    });
    this.cached = { at: Date.now(), state };
    return state;
  }
}

/** Paths that stay up during maintenance, relative to /api/v1. */
const ALLOWED = [
  /^\/maintenance-status$/, // the public banner
  /^\/auth(\/|$)/, // so platform staff can sign in and verify MFA
  /^\/platform(\/|$)/, // and switch maintenance off again
  /^\/webhooks(\/|$)/, // payment providers must keep being acknowledged, or they back off and retry
  /^\/openapi\.json$/,
  /^\/docs(\/|$)/,
];

/** Answers 503 + Retry-After to everything except the allowed paths while maintenance is on. */
export function maintenanceGate(service: MaintenanceModeService): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'OPTIONS' || ALLOWED.some((re) => re.test(req.path))) return next();
    void service.get().then(
      (s) => {
        if (!s.enabled) return next();
        res.setHeader('Retry-After', '300');
        next(
          new AppError(
            503,
            'MAINTENANCE',
            s.message ?? 'The service is undergoing maintenance. Please try again shortly.',
          ),
        );
      },
      () => next(),
    );
  };
}

const setBody = z
  .object({
    enabled: z.boolean(),
    message: z.string().trim().min(3).max(300).optional(),
  })
  .strict()
  .refine((v) => !v.enabled || v.message !== undefined, {
    message: 'A message is required to turn maintenance on',
    path: ['message'],
  });

export function maintenanceRouter(db: Db, service: MaintenanceModeService): ExpressRouter {
  const r = Router();
  const readGuard = platformGuard(db, ['SUPER_ADMIN', 'OPERATIONS', 'SUPPORT']);
  const writeGuard = platformGuard(db, ['SUPER_ADMIN', 'OPERATIONS']);

  r.get('/maintenance-status', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.get());
  });
  r.get('/platform/maintenance', requireAuth, readGuard, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.get());
  });
  r.put('/platform/maintenance', requireAuth, writeGuard, async (req, res) => {
    if (!req.platform) throw AppError.unauthenticated();
    res.json(await service.set(req.platform.userId, setBody.parse(req.body), req.id));
  });
  return r;
}

export const requestSchemas = { setBody };
