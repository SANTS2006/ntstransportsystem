import { isPermission, type Permission } from '@nts/shared';
import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { withDb, type Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import type { TenantPrincipal } from '../authorization/policy.js';
import { writeAudit } from '../audit/audit.js';

type TenantStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED' | 'DEACTIVATED';
type PlatformRole = 'SUPER_ADMIN' | 'OPERATIONS' | 'FINANCE' | 'SUPPORT' | 'SECURITY_AUDIT';

export interface TenantScope extends TenantPrincipal {
  roleKey: string;
  roleId: string;
  tenantStatus: TenantStatus;
}

export interface PlatformScope {
  userId: string;
  roles: ReadonlySet<PlatformRole>;
}

declare module 'express-serve-static-core' {
  interface Request {
    tenant?: TenantScope;
    platform?: PlatformScope;
  }
}

/** Resolves a UUID route parameter or fails with the same 404 as a missing object. */
export function uuidParam(req: Request, name: string): string {
  const parsed = z.uuid().safeParse(req.params[name]);
  if (!parsed.success) throw AppError.notFound();
  return parsed.data;
}

/**
 * Establishes tenant scope for `/tenants/:tenantId/...` routes.
 *
 * The tenant ID in the URL is only a *selector*: access is granted solely from the caller's own
 * ACTIVE membership, read under row-level security. Non-members, revoked members and unknown
 * tenants all get the identical 404, so a company's existence is never disclosed.
 */
export function tenantScope(
  db: Db,
  opts: { allowStatuses?: readonly TenantStatus[]; allowPassengerMode?: boolean } = {},
): RequestHandler {
  const allowed = opts.allowStatuses ?? ['ACTIVE'];
  return async (req, _res, next) => {
    if (!req.auth) return next(AppError.unauthenticated());
    const tenantId = uuidParam(req, 'tenantId');
    const userId = req.auth.userId;

    const membership = await withDb(db, { userId, tenantId }, (tx) =>
      tx.membership.findFirst({
        where: { tenantId, userId, status: 'ACTIVE' },
        include: { role: { include: { permissions: true } }, tenant: true },
      }),
    );
    if (!membership) return next(AppError.notFound());
    // Acting as a passenger: nothing of the staff roles is reachable until they switch back.
    if (membership.passengerMode && !opts.allowPassengerMode) {
      return next(
        new AppError(
          403,
          'ROLE_NOT_ACTIVE',
          'You are using the Passenger role. Switch to a company role to use this.',
        ),
      );
    }
    if (!allowed.includes(membership.tenant.status)) {
      return next(AppError.forbidden('This company is not currently active'));
    }
    req.tenant = {
      userId,
      tenantId,
      roleKey: membership.role.key,
      roleId: membership.role.id,
      tenantStatus: membership.tenant.status,
      permissions: new Set(
        membership.role.permissions.map((p) => p.permission).filter(isPermission),
      ),
    };
    next();
  };
}

/** `onDenied` lets the caller record the refusal (e.g. in the audit log) before the 403 is sent. */
export const requireTenantPermission =
  (
    permission: Permission,
    onDenied?: (req: Request, permission: Permission) => Promise<void>,
  ): RequestHandler =>
  async (req, _res, next) => {
    if (!req.tenant) return next(AppError.unauthenticated());
    if (!req.tenant.permissions.has(permission)) {
      await onDenied?.(req, permission);
      return next(AppError.forbidden());
    }
    next();
  };

/**
 * Platform administration gate. Requires an explicit platform role (never a tenant membership),
 * and an active account. Two-step verification is the administrator's own choice (they can turn
 * it on or off on the Security page); when it is on, sign-in asks for the code. Every denial is
 * audited.
 */
export function platformGuard(db: Db, allowed: readonly PlatformRole[]): RequestHandler {
  return async (req, _res, next) => {
    if (!req.auth) return next(AppError.unauthenticated());
    const userId = req.auth.userId;
    const user = await db.user.findUnique({
      where: { id: userId },
      include: { platformRoles: true },
    });
    const roles = new Set(user?.platformRoles.map((r) => r.role as PlatformRole) ?? []);
    const hasRole = allowed.some((r) => roles.has(r));
    // Same 404 for "no platform role" so the existence of the admin area is not advertised.
    if (!user || user.status !== 'ACTIVE' || roles.size === 0) return next(AppError.notFound());
    if (!hasRole) {
      await writeAudit(db, {
        action: 'platform.access_denied',
        outcome: 'DENIED',
        actorUserId: userId,
        requestId: req.id,
        summary: { reason: 'insufficient_role', path: req.path },
      });
      return next(AppError.forbidden());
    }
    req.platform = { userId, roles };
    next();
  };
}

/**
 * The passenger features (bookings, tickets, complaints, job applications) belong to the Passenger
 * role. A staff member who is acting as one of their company roles must switch to Passenger first.
 * Ordinary accounts and staff who are acting as passengers pass straight through.
 */
export function passengerRoleGuard(db: Db): RequestHandler {
  return async (req, _res, next) => {
    if (!req.auth) return next(); // the route's own sign-in check answers
    const userId = req.auth.userId;
    const acting = await withDb(db, { userId }, (tx) =>
      tx.membership.count({
        where: { userId, status: 'ACTIVE', passengerMode: false, tenant: { status: 'ACTIVE' } },
      }),
    );
    if (acting > 0) {
      return next(
        new AppError(
          403,
          'ROLE_NOT_ACTIVE',
          'You are acting as a company role. Switch to the Passenger role to use this.',
        ),
      );
    }
    next();
  };
}
