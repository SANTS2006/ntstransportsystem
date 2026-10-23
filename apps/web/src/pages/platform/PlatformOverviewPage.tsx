import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { api } from '../../lib/api';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

/** Minor units to a display amount; the currency code is always shown, never assumed. */
export const money = (minor: number, currency: string) =>
  `${currency} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Overview {
  range: { from: string; to: string };
  tenants: Record<string, number>;
  users: { total: number; createdInRange: number };
  sales: { currency: string; bookings: number; seats: number; revenueMinor: number }[];
  topCompanies: {
    tenantId: string;
    name: string;
    currency: string;
    bookings: number;
    revenueMinor: number;
  }[];
  openComplaints: number;
  outbox: { pending: number; deadLettered: number };
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

/** Platform-wide figures for platform staff. */
export function PlatformOverviewPage() {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(daysAgo(0));
  const valid = from !== '' && to !== '' && from <= to;
  const q = useQuery({
    queryKey: ['platform', 'overview', from, to],
    enabled: valid,
    queryFn: ({ signal }) => api<Overview>(`/platform/overview?from=${from}&to=${to}`, { signal }),
  });
  const o = q.data;
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <h1 className="text-2xl font-semibold">Overview</h1>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Field label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="w-44">
          <Field label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <p className="pb-2 text-xs text-slate-500">Days are UTC.</p>
      </div>
      {!valid && <Alert tone="error">Choose a start date that is not after the end date.</Alert>}
      {q.isPending && valid && <Spinner label="Loading overview" />}
      {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      {o && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label="Companies"
              value={String(o.tenants.ACTIVE ?? 0)}
              note={`active, ${o.tenants.PENDING ?? 0} awaiting approval, ${o.tenants.SUSPENDED ?? 0} suspended`}
            />
            <Tile
              label="Users"
              value={String(o.users.total)}
              note={`${o.users.createdInRange} new in this range`}
            />
            <Tile
              label="Open complaints"
              value={String(o.openComplaints)}
              note="across all companies"
            />
            <Tile
              label="Notification backlog"
              value={String(o.outbox.pending)}
              note={
                o.outbox.deadLettered > 0
                  ? `${o.outbox.deadLettered} failed for good: needs attention`
                  : 'none failed for good'
              }
            />
          </div>

          <Card title="Confirmed sales">
            {o.sales.length === 0 ? (
              <p className="text-sm text-slate-500">No confirmed bookings in this range.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700">
                      <th className="py-2 pr-4 font-medium">Currency</th>
                      <th className="py-2 pr-4 text-right font-medium">Bookings</th>
                      <th className="py-2 pr-4 text-right font-medium">Seats</th>
                      <th className="py-2 text-right font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.sales.map((r) => (
                      <tr
                        key={r.currency}
                        className="border-b border-slate-100 dark:border-slate-800"
                      >
                        <td className="py-2 pr-4">{r.currency}</td>
                        <td className="py-2 pr-4 text-right">{r.bookings}</td>
                        <td className="py-2 pr-4 text-right">{r.seats}</td>
                        <td className="py-2 text-right">{money(r.revenueMinor, r.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Biggest companies">
            {o.topCompanies.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing to show for this range.</p>
            ) : (
              <ol className="space-y-1 text-sm">
                {o.topCompanies.map((c) => (
                  <li
                    key={`${c.tenantId}:${c.currency}`}
                    className="flex justify-between gap-3 border-b border-slate-100 py-1.5 dark:border-slate-800"
                  >
                    <span className="min-w-0 truncate">{c.name}</span>
                    <span className="shrink-0 text-slate-600 dark:text-slate-400">
                      {c.bookings} booking{c.bookings === 1 ? '' : 's'} ·{' '}
                      {money(c.revenueMinor, c.currency)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
