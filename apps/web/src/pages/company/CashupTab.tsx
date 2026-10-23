import { useQuery } from '@tanstack/react-query';
import { ErrorAlert } from '../../components/ui/Alert';
import { PageLoader } from '../../components/ui/Spinner';
import { api } from '../../lib/api';

export const METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash',
  ORANGE_MONEY: 'Orange Money',
  AFRIMONEY: 'AfriMoney',
  QMONEY: 'QMoney',
  MOBILE_MONEY: 'Other mobile money',
  BANK_TRANSFER: 'Bank transfer',
};

export const amount = (minor: number, currency: string) =>
  `${currency} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Cashup {
  timezone: string;
  byClerk: {
    userId: string;
    name: string;
    method: string;
    currency: string;
    payments: number;
    amountMinor: number;
  }[];
  refunds: { method: string; currency: string; refunds: number; amountMinor: number }[];
  net: {
    method: string;
    currency: string;
    collectedMinor: number;
    refundedMinor: number;
    netMinor: number;
  }[];
  refundsStillOwed: { currency: string; count: number; amountMinor: number }[];
}

/** End-of-day cash-up for payments taken at the desk. */
export function CashupTab({
  tenantId,
  from,
  to,
  enabled,
}: {
  tenantId: string;
  from: string;
  to: string;
  enabled: boolean;
}) {
  const q = useQuery({
    queryKey: ['company', tenantId, 'reports', 'cashup', from, to],
    enabled,
    queryFn: ({ signal }) =>
      api<Cashup>(`/tenants/${tenantId}/reports/cashup?from=${from}&to=${to}`, { signal }),
  });
  if (q.isPending && enabled) return <PageLoader label="Loading cash-up" />;
  if (q.error) return <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d) return null;
  const empty = d.byClerk.length === 0 && d.refunds.length === 0;
  return (
    <div className="mt-4 space-y-5 overflow-x-auto">
      <p className="text-xs text-slate-500">
        Payments taken at the desk, counted on the day they were taken, in {d.timezone}.
      </p>
      {d.refundsStillOwed.map((o) => (
        <p
          key={o.currency}
          role="status"
          className="rounded-lg bg-amber-100 p-3 text-sm text-amber-950 dark:bg-amber-900/40 dark:text-amber-100"
        >
          <strong>
            {o.count} refund{o.count === 1 ? '' : 's'} still owed (
            {amount(o.amountMinor, o.currency)}
            ):
          </strong>{' '}
          bookings paid at the desk and then cancelled. Hand the money back, then record it on the
          Bookings page.
        </p>
      ))}
      {empty ? (
        <p className="text-sm text-slate-500">No desk payments in this period.</p>
      ) : (
        <>
          <section aria-labelledby="cu-clerk">
            <h3 id="cu-clerk" className="mb-1 text-sm font-semibold">
              Collected, by clerk
            </h3>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Clerk</th>
                  <th className="py-2 pr-3">Method</th>
                  <th className="py-2 pr-3 text-right">Payments</th>
                  <th className="py-2 text-right">Collected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {d.byClerk.map((r) => (
                  <tr key={`${r.userId}:${r.method}:${r.currency}`}>
                    <td className="py-2 pr-3">{r.name}</td>
                    <td className="py-2 pr-3">{METHOD_LABEL[r.method] ?? r.method}</td>
                    <td className="py-2 pr-3 text-right">{r.payments}</td>
                    <td className="py-2 text-right">{amount(r.amountMinor, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section aria-labelledby="cu-net">
            <h3 id="cu-net" className="mb-1 text-sm font-semibold">
              Totals, by method
            </h3>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Method</th>
                  <th className="py-2 pr-3 text-right">Collected</th>
                  <th className="py-2 pr-3 text-right">Handed back</th>
                  <th className="py-2 text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {d.net.map((n) => (
                  <tr key={`${n.method}:${n.currency}`}>
                    <td className="py-2 pr-3">{METHOD_LABEL[n.method] ?? n.method}</td>
                    <td className="py-2 pr-3 text-right">{amount(n.collectedMinor, n.currency)}</td>
                    <td className="py-2 pr-3 text-right">{amount(n.refundedMinor, n.currency)}</td>
                    <td className="py-2 text-right font-medium">
                      {amount(n.netMinor, n.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
