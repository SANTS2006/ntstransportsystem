import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Star, Users, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Card, StatTile } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { PageLoader } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
import { CashupTab } from './CashupTab';
import { useCompany } from './company-context';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
const money = (minor: number) =>
  `SLE ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Summary {
  revenueMinor: number;
  bookings: number;
  seatsSold: number;
  trips: number;
  occupancyPct: number | null;
  boarded: number;
  cancelledAfterPayment: { count: number; amountMinor: number };
  refundsOwed: { count: number; amountMinor: number };
  complaints: number;
  averageRating: number | null;
  ratings: number;
}
interface Sales {
  timezone: string;
  rows: { key: string; bookings: number; seats: number; revenueMinor: number }[];
  totals: { bookings: number; seats: number; revenueMinor: number };
}
interface Occupancy {
  trips: {
    tripId: string;
    route: string;
    departureAt: string;
    capacity: number;
    sold: number;
    boarded: number;
    occupancyPct: number | null;
    revenueMinor: number;
  }[];
  truncated: boolean;
}

export function ReportsPage() {
  const { tenantId } = useCompany();
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(daysAgo(0));
  const [tab, setTab] = useState<'sales' | 'occupancy' | 'cashup'>('sales');
  const [by, setBy] = useState<'day' | 'route'>('day');
  const valid = from !== '' && to !== '' && from <= to;
  const qs = `from=${from}&to=${to}`;
  const base = `/tenants/${tenantId}/reports`;

  const summary = useQuery({
    queryKey: ['company', tenantId, 'reports', 'summary', from, to],
    enabled: valid,
    queryFn: ({ signal }) => api<Summary>(`${base}/summary?${qs}`, { signal }),
  });
  const sales = useQuery({
    queryKey: ['company', tenantId, 'reports', 'sales', from, to, by],
    enabled: valid && tab === 'sales',
    queryFn: ({ signal }) => api<Sales>(`${base}/sales?${qs}&by=${by}`, { signal }),
  });
  const occ = useQuery({
    queryKey: ['company', tenantId, 'reports', 'occupancy', from, to],
    enabled: valid && tab === 'occupancy',
    queryFn: ({ signal }) => api<Occupancy>(`${base}/occupancy?${qs}`, { signal }),
  });
  const s = summary.data;
  const csvHref =
    tab === 'sales'
      ? `/api/v1${base}/sales.csv?${qs}&by=${by}`
      : tab === 'cashup'
        ? `/api/v1${base}/cashup.csv?${qs}`
        : `/api/v1${base}/occupancy.csv?${qs}`;

  return (
    <div className="w-full space-y-5">
      <h1 className="text-2xl font-semibold">Reports</h1>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Field label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="w-44">
          <Field label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      {!valid && <Alert tone="error">Choose a start date that is not after the end date.</Alert>}

      {summary.isPending && valid && <PageLoader label="Loading summary" />}
      {summary.error && <ErrorAlert error={summary.error} onRetry={() => void summary.refetch()} />}
      {s && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            icon={Wallet}
            label="Revenue"
            value={money(s.revenueMinor)}
            note={`${s.bookings} bookings, ${s.seatsSold} seats`}
          />
          <StatTile
            icon={Users}
            label="Occupancy"
            value={s.occupancyPct === null ? '—' : `${s.occupancyPct}%`}
            note={`${s.trips} trips, ${s.boarded} boarded`}
          />
          <StatTile
            icon={Star}
            label="Rating"
            value={s.averageRating === null ? '—' : `${s.averageRating} / 5`}
            note={`${s.ratings} rating${s.ratings === 1 ? '' : 's'}, ${s.complaints} complaint${s.complaints === 1 ? '' : 's'}`}
          />
          <StatTile
            icon={AlertTriangle}
            tone="amber"
            label="Needs attention"
            value={money(s.refundsOwed.amountMinor + s.cancelledAfterPayment.amountMinor)}
            note={`${s.refundsOwed.count} payments for released seats, ${s.cancelledAfterPayment.count} cancelled after payment`}
          />
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Report" className="flex gap-2">
            {(['sales', 'occupancy', 'cashup'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                type="button"
                onClick={() => setTab(t)}
                className={`min-h-11 rounded-lg px-4 text-sm font-medium ${
                  tab === t
                    ? 'bg-brand-600 text-white'
                    : 'border border-slate-300 dark:border-slate-600'
                }`}
              >
                {t === 'sales' ? 'Sales' : t === 'occupancy' ? 'Occupancy' : 'Desk cash-up'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {tab === 'sales' && (
              <select
                aria-label="Group sales by"
                value={by}
                onChange={(e) => setBy(e.target.value as 'day' | 'route')}
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              >
                <option value="day">By day</option>
                <option value="route">By route</option>
              </select>
            )}
            {valid && (
              <a className="text-sm text-brand-700 font-medium dark:text-brand-500" href={csvHref}>
                Download CSV
              </a>
            )}
          </div>
        </div>

        {tab === 'sales' && (
          <div className="mt-4 overflow-x-auto">
            {sales.isPending && valid && <PageLoader label="Loading sales" />}
            {sales.error && <ErrorAlert error={sales.error} onRetry={() => void sales.refetch()} />}
            {sales.data && (
              <>
                <p className="mb-2 text-xs text-slate-500">
                  Counted on the day each booking was paid, in {sales.data.timezone}.
                </p>
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">{by === 'day' ? 'Date' : 'Route'}</th>
                      <th className="py-2 pr-3 text-right">Bookings</th>
                      <th className="py-2 pr-3 text-right">Seats</th>
                      <th className="py-2 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {sales.data.rows.length === 0 && (
                      <tr>
                        <td className="py-2 text-slate-500" colSpan={4}>
                          No sales in this period.
                        </td>
                      </tr>
                    )}
                    {sales.data.rows.map((r) => (
                      <tr key={r.key}>
                        <td className="py-2 pr-3">{r.key}</td>
                        <td className="py-2 pr-3 text-right">{r.bookings}</td>
                        <td className="py-2 pr-3 text-right">{r.seats}</td>
                        <td className="py-2 text-right">{money(r.revenueMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="font-medium">
                    <tr>
                      <td className="pt-3 pr-3">Total</td>
                      <td className="pt-3 pr-3 text-right">{sales.data.totals.bookings}</td>
                      <td className="pt-3 pr-3 text-right">{sales.data.totals.seats}</td>
                      <td className="pt-3 text-right">{money(sales.data.totals.revenueMinor)}</td>
                    </tr>
                  </tfoot>
                </table>
              </>
            )}
          </div>
        )}

        {tab === 'cashup' && <CashupTab tenantId={tenantId} from={from} to={to} enabled={valid} />}

        {tab === 'occupancy' && (
          <div className="mt-4 overflow-x-auto">
            {occ.isPending && valid && <PageLoader label="Loading occupancy" />}
            {occ.error && <ErrorAlert error={occ.error} onRetry={() => void occ.refetch()} />}
            {occ.data && (
              <>
                {occ.data.truncated && (
                  <Alert tone="info">
                    Showing the first 500 trips. Choose a shorter period to see the rest.
                  </Alert>
                )}
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">Departure</th>
                      <th className="py-2 pr-3">Route</th>
                      <th className="py-2 pr-3 text-right">Sold / seats</th>
                      <th className="py-2 pr-3 text-right">Boarded</th>
                      <th className="py-2 pr-3 text-right">Occupancy</th>
                      <th className="py-2 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {occ.data.trips.length === 0 && (
                      <tr>
                        <td className="py-2 text-slate-500" colSpan={6}>
                          No trips in this period.
                        </td>
                      </tr>
                    )}
                    {occ.data.trips.map((t) => (
                      <tr key={t.tripId}>
                        <td className="py-2 pr-3">
                          {new Date(t.departureAt).toLocaleString([], {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </td>
                        <td className="py-2 pr-3">{t.route}</td>
                        <td className="py-2 pr-3 text-right">
                          {t.sold} / {t.capacity}
                        </td>
                        <td className="py-2 pr-3 text-right">{t.boarded}</td>
                        <td className="py-2 pr-3 text-right">
                          {t.occupancyPct === null ? '—' : `${t.occupancyPct}%`}
                        </td>
                        <td className="py-2 text-right">{money(t.revenueMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
