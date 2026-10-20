import type { Db, Tx } from '../../platform/db.js';

export interface AuditEntry {
  action: string;
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
  tenantId?: string | null;
  actorUserId?: string | null;
  targetType?: string;
  targetId?: string;
  requestId?: string | undefined;
  /** Must already be redacted: never pass credentials, tokens or full payloads. */
  summary?: Record<string, string | number | boolean | null>;
}

export async function writeAudit(client: Db | Tx, e: AuditEntry): Promise<void> {
  // createMany, not create: create issues INSERT ... RETURNING, and RETURNING must satisfy the
  // SELECT policy. Platform-scope rows (tenant_id NULL) are deliberately unreadable to the app
  // role, so RETURNING would fail. createMany inserts without RETURNING.
  await client.auditLog.createMany({
    data: [
      {
        action: e.action,
        outcome: e.outcome,
        tenantId: e.tenantId ?? null,
        actorUserId: e.actorUserId ?? null,
        targetType: e.targetType ?? null,
        targetId: e.targetId ?? null,
        requestId: e.requestId ?? null,
        summary: e.summary ?? {},
      },
    ],
  });
}
