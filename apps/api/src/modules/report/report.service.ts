import { withDb, type Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import type { TenantScope } from '../tenants/tenant.guards.js';

export const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

const ctxOf = (s: TenantScope) => ({ tenantId: s.tenantId, userId: s.userId });
const num = (v: bigint | number | null | undefined) => Number(v ?? 0);
const isoDay = (v: Date | string) => (typeof v === 'string' ? v : v.toISOString()).slice(0, 10);

export interface DateRange {
  from: string;
  to: string;
}

/** Inclusive local dates, at most a year, from before to. */
export function assertRange(r: DateRange): void {
  const a = Date.parse(`${r.from}T00:00:00Z`);
  const b = Date.parse(`${r.to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) throw AppError.validation('Use valid dates');
  if (b < a) throw AppError.validation('The end date must not be before the start date');
  if ((b - a) / DAY_MS + 1 > MAX_RANGE_DAYS)
    throw AppError.validation(`Choose at most ${MAX_RANGE_DAYS} days`);
}

export interface SalesRow {
  key: string;
  bookings: number;
  seats: number;
  revenueMinor: number;
}
export interface OccupancyRow {
  tripId: string;
  route: string;
  departureAt: string;
  status: string;
  capacity: number;
  sold: number;
  boarded: number;
  revenueMinor: number;
  occupancyPct: number | null;
}

/**
 * Company reports. Everything runs inside the company's row-level security (and filters by
 * tenant explicitly as well). "Sales" are counted on the day a booking was confirmed (paid), in
 * the company's own time zone, so a late-night payment lands on the right local day.
 */
export class ReportService {
  constructor(private readonly db: Db) {}

  private async timezone(s: TenantScope): Promise<string> {
    const t = await withDb(this.db, ctxOf(s), (tx) =>
      tx.tenant.findFirst({ where: { id: s.tenantId }, select: { timezone: true } }),
    );
    return t?.timezone ?? 'UTC';
  }

  async sales(s: TenantScope, range: DateRange, by: 'day' | 'route') {
    assertRange(range);
    const tz = await this.timezone(s);
    const rows = await withDb(this.db, ctxOf(s), async (tx) => {
      const sold =
        by === 'day'
          ? await tx.$queryRaw<{ key: Date; bookings: bigint; seats: bigint; revenue: bigint }[]>`
              SELECT (h.created_at AT TIME ZONE ${tz})::date AS key,
                     COUNT(*) AS bookings, COALESCE(SUM(n.seats), 0) AS seats, COALESCE(SUM(b.total_minor), 0) AS revenue
              FROM booking_status_history h
              JOIN bookings b ON b.id = h.booking_id AND b.tenant_id = h.tenant_id
              JOIN LATERAL (SELECT COUNT(*) AS seats FROM booking_passengers p WHERE p.booking_id = b.id AND p.tenant_id = b.tenant_id) n ON true
              WHERE h.tenant_id = ${s.tenantId}::uuid AND h.to_status = 'CONFIRMED'
                AND h.created_at >= (${range.from}::date)::timestamp AT TIME ZONE ${tz}
                AND h.created_at <  ((${range.to}::date + 1))::timestamp AT TIME ZONE ${tz}
              GROUP BY 1 ORDER BY 1`
          : await tx.$queryRaw<{ key: string; bookings: bigint; seats: bigint; revenue: bigint }[]>`
              SELECT r.name AS key,
                     COUNT(*) AS bookings, COALESCE(SUM(n.seats), 0) AS seats, COALESCE(SUM(b.total_minor), 0) AS revenue
              FROM booking_status_history h
              JOIN bookings b ON b.id = h.booking_id AND b.tenant_id = h.tenant_id
              JOIN trips t ON t.id = b.trip_id AND t.tenant_id = b.tenant_id
              JOIN routes r ON r.id = t.route_id AND r.tenant_id = t.tenant_id
              JOIN LATERAL (SELECT COUNT(*) AS seats FROM booking_passengers p WHERE p.booking_id = b.id AND p.tenant_id = b.tenant_id) n ON true
              WHERE h.tenant_id = ${s.tenantId}::uuid AND h.to_status = 'CONFIRMED'
                AND h.created_at >= (${range.from}::date)::timestamp AT TIME ZONE ${tz}
                AND h.created_at <  ((${range.to}::date + 1))::timestamp AT TIME ZONE ${tz}
              GROUP BY 1 ORDER BY 3 DESC, 1`;
      const reversed = await tx.$queryRaw<{ n: bigint; amount: bigint }[]>`
        SELECT COUNT(*) AS n, COALESCE(SUM(b.total_minor), 0) AS amount
        FROM booking_status_history h
        JOIN bookings b ON b.id = h.booking_id AND b.tenant_id = h.tenant_id
        WHERE h.tenant_id = ${s.tenantId}::uuid AND h.from_status = 'CONFIRMED' AND h.to_status = 'CANCELLED'
          AND h.created_at >= (${range.from}::date)::timestamp AT TIME ZONE ${tz}
          AND h.created_at <  ((${range.to}::date + 1))::timestamp AT TIME ZONE ${tz}`;
      const unfulfilled = await tx.$queryRaw<{ n: bigint; amount: bigint }[]>`
        SELECT COUNT(*) AS n, COALESCE(SUM(amount_minor), 0) AS amount
        FROM payments
        WHERE tenant_id = ${s.tenantId}::uuid AND status = 'PAID_UNFULFILLED'
          AND paid_at >= (${range.from}::date)::timestamp AT TIME ZONE ${tz}
          AND paid_at <  ((${range.to}::date + 1))::timestamp AT TIME ZONE ${tz}`;
      return { sold, reversed: reversed[0], unfulfilled: unfulfilled[0] };
    });
    const out: SalesRow[] = rows.sold.map((r) => ({
      key: r.key instanceof Date ? isoDay(r.key) : String(r.key),
      bookings: num(r.bookings),
      seats: num(r.seats),
      revenueMinor: num(r.revenue),
    }));
    return {
      range,
      timezone: tz,
      by,
      rows: out,
      totals: {
        bookings: out.reduce((a, r) => a + r.bookings, 0),
        seats: out.reduce((a, r) => a + r.seats, 0),
        revenueMinor: out.reduce((a, r) => a + r.revenueMinor, 0),
      },
      // Money that was taken and then given back or never matched to seats: these need a human.
      cancelledAfterPayment: {
        count: num(rows.reversed?.n),
        amountMinor: num(rows.reversed?.amount),
      },
      refundsOwed: { count: num(rows.unfulfilled?.n), amountMinor: num(rows.unfulfilled?.amount) },
    };
  }

  async occupancy(s: TenantScope, range: DateRange) {
    assertRange(range);
    const rows = await withDb(
      this.db,
      ctxOf(s),
      (tx) =>
        tx.$queryRaw<
          {
            id: string;
            route: string;
            departure_at: Date;
            status: string;
            capacity: number | null;
            sold: bigint;
            boarded: bigint;
            revenue: bigint;
          }[]
        >`
        SELECT t.id, r.name AS route, t.departure_at, t.status::text AS status, v.seating_capacity AS capacity,
          (SELECT COUNT(*) FROM booking_passengers p JOIN bookings b ON b.id = p.booking_id AND b.tenant_id = p.tenant_id
             WHERE p.trip_id = t.id AND p.tenant_id = t.tenant_id AND p.released_at IS NULL AND b.status = 'CONFIRMED') AS sold,
          (SELECT COUNT(*) FROM tickets k WHERE k.trip_id = t.id AND k.tenant_id = t.tenant_id AND k.status = 'BOARDED') AS boarded,
          (SELECT COALESCE(SUM(p.fare_minor), 0) FROM booking_passengers p JOIN bookings b ON b.id = p.booking_id AND b.tenant_id = p.tenant_id
             WHERE p.trip_id = t.id AND p.tenant_id = t.tenant_id AND p.released_at IS NULL AND b.status = 'CONFIRMED') AS revenue
        FROM trips t
        JOIN routes r ON r.id = t.route_id AND r.tenant_id = t.tenant_id
        LEFT JOIN vehicles v ON v.id = t.vehicle_id AND v.tenant_id = t.tenant_id
        WHERE t.tenant_id = ${s.tenantId}::uuid AND t.status <> 'CANCELLED'
          AND t.service_date >= ${range.from}::date AND t.service_date <= ${range.to}::date
        ORDER BY t.departure_at LIMIT 500`,
    );
    const trips: OccupancyRow[] = rows.map((r) => {
      const capacity = r.capacity ?? 0;
      const sold = num(r.sold);
      return {
        tripId: r.id,
        route: r.route,
        departureAt: r.departure_at.toISOString(),
        status: r.status,
        capacity,
        sold,
        boarded: num(r.boarded),
        revenueMinor: num(r.revenue),
        occupancyPct: capacity > 0 ? Math.round((sold / capacity) * 1000) / 10 : null,
      };
    });
    const cap = trips.reduce((a, t) => a + t.capacity, 0);
    const sold = trips.reduce((a, t) => a + t.sold, 0);
    return {
      range,
      trips,
      totals: {
        trips: trips.length,
        capacity: cap,
        sold,
        boarded: trips.reduce((a, t) => a + t.boarded, 0),
        revenueMinor: trips.reduce((a, t) => a + t.revenueMinor, 0),
        occupancyPct: cap > 0 ? Math.round((sold / cap) * 1000) / 10 : null,
      },
      truncated: rows.length === 500,
    };
  }

  /** Headline figures for a period, in one place. */
  async summary(s: TenantScope, range: DateRange) {
    const [sales, occ] = await Promise.all([this.sales(s, range, 'day'), this.occupancy(s, range)]);
    const counts = await withDb(this.db, ctxOf(s), async (tx) => {
      const complaints = await tx.complaint.count({
        where: {
          tenantId: s.tenantId,
          createdAt: {
            gte: new Date(`${range.from}T00:00:00Z`),
            lt: new Date(Date.parse(`${range.to}T00:00:00Z`) + DAY_MS),
          },
        },
      });
      const ratings = await tx.tripRating.aggregate({
        where: {
          tenantId: s.tenantId,
          createdAt: {
            gte: new Date(`${range.from}T00:00:00Z`),
            lt: new Date(Date.parse(`${range.to}T00:00:00Z`) + DAY_MS),
          },
        },
        _avg: { rating: true },
        _count: true,
      });
      return {
        complaints,
        averageRating:
          ratings._avg.rating === null ? null : Math.round(ratings._avg.rating * 100) / 100,
        ratings: ratings._count,
      };
    });
    return {
      range,
      revenueMinor: sales.totals.revenueMinor,
      bookings: sales.totals.bookings,
      seatsSold: sales.totals.seats,
      trips: occ.totals.trips,
      occupancyPct: occ.totals.occupancyPct,
      boarded: occ.totals.boarded,
      cancelledAfterPayment: sales.cancelledAfterPayment,
      refundsOwed: sales.refundsOwed,
      complaints: counts.complaints,
      averageRating: counts.averageRating,
      ratings: counts.ratings,
    };
  }
}
