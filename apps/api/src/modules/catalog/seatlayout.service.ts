import { withDb, type Db } from '../../platform/db.js';
import { mapDbErrors } from '../../platform/db-errors.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../audit/audit.js';
import type { TenantScope } from '../tenants/tenant.guards.js';

const ctxOf = (s: TenantScope) => ({ tenantId: s.tenantId, userId: s.userId });
const LETTERS = 'ABCDEF';

export interface LayoutSpec {
  name: string;
  /** Number of seat rows (1-60). */
  rows: number;
  /** Seats per row (1-6), lettered A.. */
  columns: number;
  /** Labels (e.g. "1A") reserved as wheelchair-accessible seats. */
  accessible?: string[] | undefined;
}

export interface GeneratedSeat {
  label: string;
  rowNo: number;
  colNo: number;
  accessible: boolean;
}

/** Pure generator: rows x columns grid labelled 1A, 1B, ... */
export function generateSeats(
  spec: Pick<LayoutSpec, 'rows' | 'columns' | 'accessible'>,
): GeneratedSeat[] {
  const accessible = new Set((spec.accessible ?? []).map((l) => l.toUpperCase()));
  const seats: GeneratedSeat[] = [];
  for (let r = 1; r <= spec.rows; r++) {
    for (let c = 1; c <= spec.columns; c++) {
      const label = `${r}${LETTERS[c - 1]}`;
      seats.push({ label, rowNo: r, colNo: c, accessible: accessible.has(label) });
    }
  }
  for (const label of accessible) {
    if (!seats.some((s) => s.label === label))
      throw AppError.validation(`Accessible seat ${label} does not exist in this layout`);
  }
  return seats;
}

/** Seat layouts. A vehicle linked to a layout must have the same number of seats as the layout. */
export class SeatLayoutService {
  constructor(private readonly db: Db) {}

  async list(s: TenantScope) {
    const rows = await withDb(this.db, ctxOf(s), (tx) =>
      tx.seatLayout.findMany({
        where: { tenantId: s.tenantId },
        include: { _count: { select: { seats: true, vehicles: true } } },
        orderBy: { name: 'asc' },
        take: 200,
      }),
    );
    return rows.map((l) => ({
      id: l.id,
      name: l.name,
      seats: l._count.seats,
      vehicles: l._count.vehicles,
    }));
  }

  async get(s: TenantScope, id: string) {
    const l = await withDb(this.db, ctxOf(s), (tx) =>
      tx.seatLayout.findFirst({
        where: { id, tenantId: s.tenantId },
        include: { seats: { orderBy: [{ rowNo: 'asc' }, { colNo: 'asc' }] } },
      }),
    );
    if (!l) throw AppError.notFound();
    return {
      id: l.id,
      name: l.name,
      seats: l.seats.map((x) => ({
        label: x.label,
        row: x.rowNo,
        col: x.colNo,
        accessible: x.accessible,
      })),
    };
  }

  async create(s: TenantScope, spec: LayoutSpec, requestId?: string) {
    const seats = generateSeats(spec);
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const layout = await tx.seatLayout.create({
            data: { tenantId: s.tenantId, name: spec.name.trim() },
          });
          await tx.seatLayoutSeat.createMany({
            data: seats.map((x) => ({
              tenantId: s.tenantId,
              layoutId: layout.id,
              label: x.label,
              rowNo: x.rowNo,
              colNo: x.colNo,
              accessible: x.accessible,
            })),
          });
          await writeAudit(tx, {
            action: 'fleet.seat_layout_created',
            outcome: 'SUCCESS',
            tenantId: s.tenantId,
            actorUserId: s.userId,
            targetType: 'seat_layout',
            targetId: layout.id,
            requestId,
            summary: { seats: seats.length },
          });
          return { id: layout.id, name: layout.name, seats: seats.length };
        }),
      { unique: 'A seat layout with this name already exists' },
    );
  }

  async remove(s: TenantScope, id: string, requestId?: string) {
    await withDb(this.db, ctxOf(s), async (tx) => {
      const layout = await tx.seatLayout.findFirst({ where: { id, tenantId: s.tenantId } });
      if (!layout) throw AppError.notFound();
      const used = await tx.vehicle.count({ where: { tenantId: s.tenantId, seatLayoutId: id } });
      if (used > 0) throw AppError.conflict('This layout is used by a vehicle');
      await tx.seatLayout.delete({ where: { id } });
      await writeAudit(tx, {
        action: 'fleet.seat_layout_deleted',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'seat_layout',
        targetId: id,
        requestId,
      });
    });
  }
}
