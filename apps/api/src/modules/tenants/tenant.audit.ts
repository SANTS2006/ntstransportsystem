import type { Permission } from '@nts/shared';
import type { Request } from 'express';
import { withDb, type Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../audit/audit.js';
import type { TenantScope } from './tenant.guards.js';

/**
 * Records refused tenant-scope actions. Refusals are written in their own transaction, *after* the
 * failed one has rolled back, so the record survives. An audit-write failure must never change the
 * response the caller gets, so it is swallowed here (the refusal itself is still returned).
 */
export function createDenialAuditor(db: Db) {
  const record = async (
    scope: TenantScope,
    action: string,
    req: Request,
    summary: Record<string, string | number | boolean | null>,
  ) => {
    try {
      await withDb(db, { tenantId: scope.tenantId, userId: scope.userId }, (tx) =>
        writeAudit(tx, {
          action,
          outcome: 'DENIED',
          tenantId: scope.tenantId,
          actorUserId: scope.userId,
          requestId: req.id,
          summary,
        }),
      );
    } catch {
      /* see above */
    }
  };

  return {
    /** A route-level permission check failed. */
    permissionDenied: (req: Request, permission: Permission) =>
      req.tenant
        ? record(req.tenant, 'authz.permission_denied', req, {
            permission,
            method: req.method,
          })
        : Promise.resolve(),

    /**
     * Runs a service call; if it is refused (403 forbidden or 409 safety-rule conflict), records
     * a DENIED event under `action` and rethrows unchanged.
     */
    async guard<T>(req: Request, action: string, fn: () => Promise<T>): Promise<T> {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof AppError && (err.status === 403 || err.status === 409) && req.tenant) {
          await record(req.tenant, action, req, { reason: err.code, detail: err.message });
        }
        throw err;
      }
    },
  };
}

export type DenialAuditor = ReturnType<typeof createDenialAuditor>;
