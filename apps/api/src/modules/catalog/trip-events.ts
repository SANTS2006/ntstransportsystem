import type { Prisma } from '../../generated/prisma/client.js';
import type { Tx } from '../../platform/db.js';
import type { TenantScope } from '../tenants/tenant.guards.js';

export type TripEventKind =
  | 'STATUS_CHANGED'
  | 'DELAY_SET'
  | 'VEHICLE_ASSIGNED'
  | 'VEHICLE_REPLACED'
  | 'CREW_ASSIGNED'
  | 'CREW_RELEASED'
  | 'NOTE';

/** Appends to the trip's operational timeline (append-only; enforced by a database trigger). */
export async function recordTripEvent(
  tx: Tx,
  s: TenantScope,
  tripId: string,
  kind: TripEventKind,
  details: Prisma.InputJsonObject = {},
): Promise<void> {
  await tx.tripEvent.createMany({
    data: [{ tenantId: s.tenantId, tripId, kind, details, actorUserId: s.userId }],
  });
}
