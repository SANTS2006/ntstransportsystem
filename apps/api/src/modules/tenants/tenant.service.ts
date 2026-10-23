import { randomBytes, randomUUID } from 'node:crypto';
import { DEFAULT_TENANT_ROLES } from '@nts/shared';
import type { TenantStatus } from '../../generated/prisma/enums.js';
import { withDb, type Db, type Tx } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../audit/audit.js';
import { checkSlug } from '../branding/branding.service.js';
import type { TenantScope } from './tenant.guards.js';

export interface RegisterInput {
  name: string;
  /** The company's web address name: <site>/<slug>/login. */
  slug: string;
  timezone: string;
  defaultCurrency: string;
  /** The first administrator, who gets the company's owner role. Recorded in the audit trail. */
  adminEmail: string;
  primaryColor?: string | null | undefined;
  accentColor?: string | null | undefined;
}

export interface ProfileUpdate {
  name?: string | undefined;
  timezone?: string | undefined;
  defaultCurrency?: string | undefined;
  crewMinRestMinutes?: number | undefined;
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'company';

/** Legal lifecycle transitions. Anything not listed is rejected. */
export const TENANT_TRANSITIONS = {
  approve: { from: ['PENDING'], to: 'ACTIVE' },
  reject: { from: ['PENDING'], to: 'REJECTED' },
  suspend: { from: ['ACTIVE'], to: 'SUSPENDED' },
  reactivate: { from: ['SUSPENDED'], to: 'ACTIVE' },
  deactivate: { from: ['ACTIVE', 'SUSPENDED'], to: 'DEACTIVATED' },
} as const;
export type TenantAction = keyof typeof TENANT_TRANSITIONS;

export class TenantService {
  constructor(private readonly db: Db) {}

  /** Creates the default roles for a new tenant and returns the owner role ID. */
  static async seedRoles(tx: Tx, tenantId: string): Promise<string> {
    // Two bulk statements instead of dozens of nested creates: IDs are generated here so no
    // read-back is needed, which keeps the transaction short on a high-latency database link.
    const defs = Object.entries(DEFAULT_TENANT_ROLES).map(([key, def]) => ({
      id: randomUUID(),
      key,
      def,
    }));
    await tx.role.createMany({
      data: defs.map(({ id, key, def }) => ({
        id,
        tenantId,
        key,
        name: def.name,
        isSystem: key === 'owner',
      })),
    });
    await tx.rolePermission.createMany({
      data: defs.flatMap(({ id, def }) =>
        def.permissions.map((permission) => ({ roleId: id, permission })),
      ),
    });
    const owner = defs.find((d) => d.key === 'owner');
    if (!owner) throw new Error('Default roles must include an owner');
    return owner.id;
  }

  /**
   * A platform administrator registers a company. Companies cannot register themselves: the
   * company goes live (ACTIVE) at once and its first owner is invited by email afterwards, so no
   * user account is made an owner here. Runs in platform scope because creating a tenant is a
   * platform-only database privilege; the caller's platform role is checked by the route guard.
   */
  async register(actorUserId: string, input: RegisterInput, requestId?: string) {
    return withDb(this.db, { platform: true, userId: actorUserId }, async (tx) => {
      checkSlug(input.slug);
      if (await tx.tenant.findUnique({ where: { slug: input.slug }, select: { id: true } })) {
        throw AppError.conflict('That web address name is already taken');
      }
      const slug = input.slug;
      const tenant = await tx.tenant.create({
        data: {
          name: input.name,
          slug,
          timezone: input.timezone,
          defaultCurrency: input.defaultCurrency,
          status: 'ACTIVE',
        },
      });
      const ownerRoleId = await TenantService.seedRoles(tx, tenant.id);
      if (input.primaryColor || input.accentColor) {
        await tx.tenantBranding.create({
          data: {
            tenantId: tenant.id,
            primaryColor: input.primaryColor ?? null,
            accentColor: input.accentColor ?? null,
          },
        });
      }
      await writeAudit(tx, {
        action: 'platform.tenant_created',
        outcome: 'SUCCESS',
        tenantId: tenant.id,
        actorUserId,
        targetType: 'tenant',
        targetId: tenant.id,
        requestId,
        summary: { adminEmail: input.adminEmail, slug },
      });
      return {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        ownerRoleId,
      };
    });
  }

  /** The caller's own companies. Row-level security limits this to their memberships. */
  async listMine(userId: string) {
    const rows = await withDb(this.db, { userId }, (tx) =>
      tx.membership.findMany({
        where: { userId, status: { in: ['ACTIVE', 'INVITED'] } },
        include: { tenant: true, role: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return rows.map((m) => ({
      tenantId: m.tenantId,
      name: m.tenant.name,
      slug: m.tenant.slug,
      status: m.tenant.status,
      membershipStatus: m.status,
      role: { key: m.role.key, name: m.role.name },
    }));
  }

  async getProfile(scope: TenantScope) {
    const t = await withDb(this.db, { tenantId: scope.tenantId, userId: scope.userId }, (tx) =>
      tx.tenant.findUnique({ where: { id: scope.tenantId } }),
    );
    if (!t) throw AppError.notFound();
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      timezone: t.timezone,
      defaultCurrency: t.defaultCurrency,
      crewMinRestMinutes: t.crewMinRestMinutes,
    };
  }

  /** Whitelisted fields only. Status and slug are never client-writable here (mass-assignment safe). */
  async updateProfile(scope: TenantScope, update: ProfileUpdate, requestId?: string) {
    const data = {
      ...(update.name !== undefined ? { name: update.name } : {}),
      ...(update.timezone !== undefined ? { timezone: update.timezone } : {}),
      ...(update.defaultCurrency !== undefined ? { defaultCurrency: update.defaultCurrency } : {}),
      ...(update.crewMinRestMinutes !== undefined
        ? { crewMinRestMinutes: update.crewMinRestMinutes }
        : {}),
    };
    if (Object.keys(data).length === 0) throw AppError.validation('Nothing to update');
    await withDb(this.db, { tenantId: scope.tenantId, userId: scope.userId }, async (tx) => {
      await tx.tenant.update({ where: { id: scope.tenantId }, data });
      await writeAudit(tx, {
        action: 'tenant.profile_updated',
        outcome: 'SUCCESS',
        tenantId: scope.tenantId,
        actorUserId: scope.userId,
        targetType: 'tenant',
        targetId: scope.tenantId,
        requestId,
        summary: { fields: Object.keys(data).join(',') },
      });
    });
    return this.getProfile(scope);
  }

  async listAuditEvents(scope: TenantScope, page: { limit: number; offset: number }) {
    return withDb(this.db, { tenantId: scope.tenantId, userId: scope.userId }, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: scope.tenantId },
        orderBy: { createdAt: 'desc' },
        take: page.limit,
        skip: page.offset,
        select: {
          id: true,
          action: true,
          outcome: true,
          actorUserId: true,
          targetType: true,
          targetId: true,
          requestId: true,
          createdAt: true,
        },
      }),
    );
  }

  /** Platform lifecycle operations. Caller must already have passed platformGuard. */
  async transition(
    actorUserId: string,
    tenantId: string,
    action: TenantAction,
    reason: string | undefined,
    requestId?: string,
  ) {
    const rule = TENANT_TRANSITIONS[action];
    // Refusals are returned (not thrown) from inside the transaction: a throw would roll back the
    // DENIED audit row, and refused attempts are exactly what the audit trail must keep.
    const outcome = await withDb(this.db, { platform: true, userId: actorUserId }, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw AppError.notFound();
      if (!(rule.from as readonly string[]).includes(tenant.status)) {
        await writeAudit(tx, {
          action: `platform.tenant_${action}`,
          outcome: 'DENIED',
          tenantId,
          actorUserId,
          targetType: 'tenant',
          targetId: tenantId,
          requestId,
          summary: { from: tenant.status, reason: 'illegal_transition' },
        });
        return {
          refused: AppError.conflict(
            `A ${tenant.status.toLowerCase()} company cannot be ${action}d`,
          ),
        } as const;
      }
      // Compare-and-set: concurrent operators cannot both apply a transition.
      const res = await tx.tenant.updateMany({
        where: { id: tenantId, status: tenant.status },
        data: { status: rule.to },
      });
      if (res.count !== 1) {
        await writeAudit(tx, {
          action: `platform.tenant_${action}`,
          outcome: 'DENIED',
          tenantId,
          actorUserId,
          targetType: 'tenant',
          targetId: tenantId,
          requestId,
          summary: { from: tenant.status, reason: 'concurrent_change' },
        });
        return { refused: AppError.conflict('The company status changed; please retry') } as const;
      }
      await writeAudit(tx, {
        action: `platform.tenant_${action}`,
        outcome: 'SUCCESS',
        tenantId,
        actorUserId,
        targetType: 'tenant',
        targetId: tenantId,
        requestId,
        summary: {
          from: tenant.status,
          to: rule.to,
          ...(reason ? { reason: reason.slice(0, 300) } : {}),
        },
      });
      return { id: tenantId, status: rule.to } as const;
    });
    if ('refused' in outcome) throw outcome.refused;
    return outcome;
  }

  async listForPlatform(status: TenantStatus | undefined, page: { limit: number; offset: number }) {
    return withDb(this.db, { platform: true }, (tx) =>
      tx.tenant.findMany({
        where: status ? { status } : {},
        orderBy: { createdAt: 'desc' },
        take: page.limit,
        skip: page.offset,
        select: { id: true, name: true, slug: true, status: true, timezone: true, createdAt: true },
      }),
    );
  }
}
