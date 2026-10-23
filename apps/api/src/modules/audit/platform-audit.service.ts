import { withDb, type Db } from '../../platform/db.js';

export interface AuditFilter {
  action?: string | undefined;
  outcome?: 'SUCCESS' | 'FAILURE' | 'DENIED' | undefined;
  tenantId?: string | undefined;
  actorUserId?: string | undefined;
  /** Inclusive UTC days, YYYY-MM-DD. */
  from?: string | undefined;
  to?: string | undefined;
}

/** Platform-wide read of the append-only audit log, with the people and companies named. */
export class PlatformAuditService {
  constructor(private readonly db: Db) {}

  async list(filter: AuditFilter, page: { limit: number; offset: number }) {
    const createdAt: { gte?: Date; lt?: Date } = {};
    if (filter.from) createdAt.gte = new Date(`${filter.from}T00:00:00Z`);
    if (filter.to) createdAt.lt = new Date(Date.parse(`${filter.to}T00:00:00Z`) + 86_400_000);
    const where = {
      ...(filter.action
        ? { action: { contains: filter.action, mode: 'insensitive' as const } }
        : {}),
      ...(filter.outcome ? { outcome: filter.outcome } : {}),
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      ...(filter.actorUserId ? { actorUserId: filter.actorUserId } : {}),
      ...(createdAt.gte || createdAt.lt ? { createdAt } : {}),
    };
    return withDb(this.db, { platform: true }, async (tx) => {
      const [rows, total] = await Promise.all([
        tx.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: page.limit,
          skip: page.offset,
        }),
        tx.auditLog.count({ where }),
      ]);
      const userIds = [...new Set(rows.map((r) => r.actorUserId).filter((v): v is string => !!v))];
      const tenantIds = [...new Set(rows.map((r) => r.tenantId).filter((v): v is string => !!v))];
      const [users, tenants] = await Promise.all([
        userIds.length
          ? tx.user.findMany({
              where: { id: { in: userIds } },
              select: { id: true, email: true, phone: true, displayName: true },
            })
          : [],
        tenantIds.length
          ? tx.tenant.findMany({
              where: { id: { in: tenantIds } },
              select: { id: true, name: true },
            })
          : [],
      ]);
      const userById = new Map(users.map((u) => [u.id, u]));
      const tenantById = new Map(tenants.map((t) => [t.id, t.name]));
      return {
        total,
        events: rows.map((r) => {
          const u = r.actorUserId ? userById.get(r.actorUserId) : undefined;
          return {
            id: r.id,
            at: r.createdAt,
            action: r.action,
            outcome: r.outcome,
            actor: u
              ? { id: u.id, name: u.displayName, contact: u.email ?? u.phone ?? null }
              : null,
            tenant: r.tenantId
              ? { id: r.tenantId, name: tenantById.get(r.tenantId) ?? null }
              : null,
            targetType: r.targetType,
            targetId: r.targetId,
            requestId: r.requestId,
            summary: r.summary,
          };
        }),
      };
    });
  }
}
