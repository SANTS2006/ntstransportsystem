import { isPermission, type Permission } from '@nts/shared';
import { AppError } from '../../platform/errors.js';
import type { TenantPrincipal } from '../authorization/policy.js';

/**
 * Privilege-escalation guard: a user may only hand out permissions they hold themselves.
 * This applies to inviting members, changing roles, and editing role permissions.
 */
export function assertCanGrant(p: TenantPrincipal, permissions: Iterable<string>): void {
  for (const permission of permissions) {
    if (!isPermission(permission) || !p.permissions.has(permission as Permission)) {
      throw AppError.forbidden('You cannot grant permissions you do not hold');
    }
  }
}
