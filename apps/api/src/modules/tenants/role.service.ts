import { PERMISSIONS, isPermission } from '@nts/shared';
import { withDb, type Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../audit/audit.js';
import { assertCanGrant } from './delegation.js';
import type { TenantScope } from './tenant.guards.js';

export class RoleService {
  constructor(private readonly db: Db) {}

  private ctx(s: TenantScope) {
    return { tenantId: s.tenantId, userId: s.userId };
  }

  /** The catalog of grantable permissions (the caller sees what exists, not what others hold). */
  permissionCatalog() {
    return [...PERMISSIONS];
  }

  async list(s: TenantScope) {
    const roles = await withDb(this.db, this.ctx(s), (tx) =>
      tx.role.findMany({
        where: { tenantId: s.tenantId },
        include: { permissions: true, _count: { select: { heldBy: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      isSystem: r.isSystem,
      members: r._count.heldBy,
      permissions: r.permissions.map((p) => p.permission).sort(),
    }));
  }

  private validate(permissions: string[]) {
    const unique = [...new Set(permissions)];
    if (!unique.every(isPermission)) throw AppError.validation('Unknown permission in request');
    return unique;
  }

  /** Custom roles are created only with permissions the creator holds (no escalation). */
  async create(
    s: TenantScope,
    input: { key: string; name: string; permissions: string[] },
    requestId?: string,
  ) {
    const permissions = this.validate(input.permissions);
    assertCanGrant(s, permissions);
    return withDb(this.db, this.ctx(s), async (tx) => {
      const clash = await tx.role.findFirst({ where: { tenantId: s.tenantId, key: input.key } });
      if (clash) throw AppError.conflict('A role with this key already exists');
      const role = await tx.role.create({
        data: {
          tenantId: s.tenantId,
          key: input.key,
          name: input.name,
          isSystem: false,
          permissions: { create: permissions.map((permission) => ({ permission })) },
        },
      });
      await writeAudit(tx, {
        action: 'role.created',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'role',
        targetId: role.id,
        requestId,
        summary: { key: role.key, permissions: permissions.length },
      });
      return { id: role.id, key: role.key, name: role.name };
    });
  }

  /**
   * Replace a role's permission set. The owner role is immutable (system safety rule), and the
   * caller may not add permissions they lack, nor edit a role that exceeds their own authority.
   */
  async setPermissions(s: TenantScope, roleId: string, permissions: string[], requestId?: string) {
    const next = this.validate(permissions);
    await withDb(this.db, this.ctx(s), async (tx) => {
      const role = await tx.role.findFirst({
        where: { id: roleId, tenantId: s.tenantId },
        include: { permissions: true },
      });
      if (!role) throw AppError.notFound();
      if (role.isSystem) throw AppError.forbidden('System roles cannot be modified');
      if (role.id === s.roleId) throw AppError.forbidden('You cannot edit your own role');
      assertCanGrant(
        s,
        role.permissions.map((p) => p.permission),
      ); // not a role above you
      assertCanGrant(s, next);
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({
        data: next.map((permission) => ({ roleId, permission })),
      });
      await writeAudit(tx, {
        action: 'role.permissions_changed',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'role',
        targetId: roleId,
        requestId,
        summary: { before: role.permissions.length, after: next.length },
      });
    });
  }

  async remove(s: TenantScope, roleId: string, requestId?: string) {
    await withDb(this.db, this.ctx(s), async (tx) => {
      const role = await tx.role.findFirst({ where: { id: roleId, tenantId: s.tenantId } });
      if (!role) throw AppError.notFound();
      if (role.isSystem) throw AppError.forbidden('System roles cannot be deleted');
      const inUse =
        (await tx.membershipRole.count({ where: { roleId } })) +
        (await tx.invitation.count({ where: { roleId } }));
      if (inUse > 0) throw AppError.conflict('This role is still assigned or referenced');
      await tx.role.delete({ where: { id: roleId } });
      await writeAudit(tx, {
        action: 'role.deleted',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'role',
        targetId: roleId,
        requestId,
        summary: { key: role.key },
      });
    });
  }
}
