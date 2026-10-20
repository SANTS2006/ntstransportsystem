import type { Permission } from '@nts/shared';
import { AppError } from '../../platform/errors.js';

export interface TenantPrincipal {
  userId: string;
  tenantId: string;
  permissions: ReadonlySet<Permission>;
}

export const can = (p: TenantPrincipal, permission: Permission) => p.permissions.has(permission);

export function requirePermission(
  p: TenantPrincipal | undefined,
  permission: Permission,
): TenantPrincipal {
  if (!p) throw AppError.unauthenticated();
  if (!can(p, permission)) throw AppError.forbidden();
  return p;
}
