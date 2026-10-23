import { withDb, type Db } from '../../platform/db.js';
import { assertRange, type DateRange } from './report.service.js';

const num = (v: bigint | number | null | undefined) => Number(v ?? 0);

export const TOP_COMPANIES = 10;

/**
 * Platform-wide figures for platform staff. Runs in platform scope (it spans every company), so it
 * is only ever reachable through the platform guard. Days are UTC because there is no single
 * company time zone to use; per-company reports use the company's own.
 */
export class PlatformReportService {
  constructor(private readonly db: Db) {}

  async overview(range: DateRange) {
    assertRange(range);
    return withDb(this.db, { platform: true }, async (tx) => {
      const from = range.from;
      const to = range.to;
      const [tenants, users, sold, top, complaints, outbox] = await Promise.all([
        tx.tenant.groupBy({ by: ['status'], _count: { _all: true } }),
        tx.$queryRaw<{ total: bigint; created: bigint }[]>`
          SELECT COUNT(*) AS total,
                 COUNT(*) FILTER (WHERE created_at >= ${from}::date AND created_at < ${to}::date + 1) AS created
          FROM users`,
        tx.$queryRaw<{ currency: string; bookings: bigint; seats: bigint; revenue: bigint }[]>`
          SELECT b.currency, COUNT(*) AS bookings, COALESCE(SUM(n.seats), 0) AS seats,
                 COALESCE(SUM(b.total_minor), 0) AS revenue
          FROM booking_status_history h
          JOIN bookings b ON b.id = h.booking_id AND b.tenant_id = h.tenant_id
          JOIN LATERAL (SELECT COUNT(*) AS seats FROM booking_passengers p
                        WHERE p.booking_id = b.id AND p.tenant_id = b.tenant_id) n ON true
          WHERE h.to_status = 'CONFIRMED'
            AND h.created_at >= ${from}::date AND h.created_at < ${to}::date + 1
          GROUP BY b.currency ORDER BY revenue DESC, b.currency`,
        tx.$queryRaw<
          { tenant_id: string; name: string; currency: string; bookings: bigint; revenue: bigint }[]
        >`
          SELECT t.id AS tenant_id, t.name, b.currency, COUNT(*) AS bookings,
                 COALESCE(SUM(b.total_minor), 0) AS revenue
          FROM booking_status_history h
          JOIN bookings b ON b.id = h.booking_id AND b.tenant_id = h.tenant_id
          JOIN tenants t ON t.id = b.tenant_id
          WHERE h.to_status = 'CONFIRMED'
            AND h.created_at >= ${from}::date AND h.created_at < ${to}::date + 1
          GROUP BY t.id, t.name, b.currency
          ORDER BY revenue DESC, t.name
          LIMIT ${TOP_COMPANIES}`,
        tx.complaint.count({ where: { status: { in: ['OPEN', 'IN_REVIEW'] } } }),
        tx.$queryRaw<{ pending: bigint; dead: bigint }[]>`
          SELECT COUNT(*) FILTER (WHERE processed_at IS NULL AND failed_at IS NULL) AS pending,
                 COUNT(*) FILTER (WHERE failed_at IS NOT NULL) AS dead
          FROM outbox_events`,
      ]);
      const statusCounts: Record<string, number> = {
        PENDING: 0,
        ACTIVE: 0,
        REJECTED: 0,
        SUSPENDED: 0,
        DEACTIVATED: 0,
      };
      for (const t of tenants) statusCounts[t.status] = t._count._all;
      return {
        range,
        tenants: statusCounts,
        users: { total: num(users[0]?.total), createdInRange: num(users[0]?.created) },
        sales: sold.map((r) => ({
          currency: r.currency,
          bookings: num(r.bookings),
          seats: num(r.seats),
          revenueMinor: num(r.revenue),
        })),
        topCompanies: top.map((r) => ({
          tenantId: r.tenant_id,
          name: r.name,
          currency: r.currency,
          bookings: num(r.bookings),
          revenueMinor: num(r.revenue),
        })),
        openComplaints: complaints,
        outbox: { pending: num(outbox[0]?.pending), deadLettered: num(outbox[0]?.dead) },
      };
    });
  }
}
