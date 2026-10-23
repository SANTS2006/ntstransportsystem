import { CheckCircle2, ScanLine, XCircle } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Badge, Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { api, ApiError } from '../../lib/api';
import { useCompany } from './company-context';

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

interface TripRow {
  id: string;
  route: string;
  departureAt: string;
  status: string;
}
interface Manifest {
  trip: { id: string; route: string; status: string; departureAt: string };
  counts: { total: number; boarded: number };
  passengers: {
    ticketId: string;
    seat: string;
    name: string;
    code: string;
    status: 'ISSUED' | 'BOARDED';
    boardedAt: string | null;
  }[];
}
type Outcome = { kind: 'ok'; text: string } | { kind: 'refused'; text: string };

const REASON_HELP: Record<string, string> = {
  ALREADY_BOARDED: 'Do not let them board again.',
  VOID: 'Send them to the ticket office.',
  WRONG_TRIP: 'Check the trip selected above.',
  TOO_EARLY: 'Boarding opens 3 hours before departure.',
};

export function BoardingPage() {
  const { tenantId } = useCompany();
  const qc = useQueryClient();
  const trips = useQuery({
    queryKey: ['company', tenantId, 'boarding-trips'],
    queryFn: ({ signal }) =>
      api<{ trips: TripRow[] }>(
        `/tenants/${tenantId}/trips?from=${today()}&to=${plusDays(1)}&limit=100`,
        { signal },
      ),
  });
  const open = (trips.data?.trips ?? []).filter((t) =>
    ['SCHEDULED', 'BOARDING', 'IN_TRANSIT'].includes(t.status),
  );
  const [tripId, setTripId] = useState('');
  const [value, setValue] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const manifest = useQuery({
    queryKey: ['company', tenantId, 'manifest', tripId],
    enabled: tripId !== '',
    refetchInterval: 15_000,
    queryFn: ({ signal }) =>
      api<Manifest>(`/tenants/${tenantId}/trips/${tripId}/manifest`, { signal }),
  });

  const scan = useMutation({
    mutationFn: (raw: string) => {
      const v = raw.trim();
      // A QR token is long and starts "t1."; anything else is treated as a typed code.
      const body = v.startsWith('t1.') ? { token: v, tripId } : { code: v, tripId };
      return api<{ ticket: { seat: string; passengerName: string } }>(
        `/tenants/${tenantId}/tickets/scan`,
        { method: 'POST', body },
      );
    },
    onSuccess: async (r) => {
      setOutcome({
        kind: 'ok',
        text: `Welcome aboard: ${r.ticket.passengerName}, seat ${r.ticket.seat}`,
      });
      await qc.invalidateQueries({ queryKey: ['company', tenantId, 'manifest', tripId] });
    },
    onError: (e) => {
      const reason =
        e instanceof ApiError ? (e.details as { reason?: string } | undefined)?.reason : undefined;
      setOutcome({
        kind: 'refused',
        text: `${e instanceof Error ? e.message : 'Could not check the ticket.'} ${reason ? (REASON_HELP[reason] ?? '') : ''}`.trim(),
      });
    },
    onSettled: () => {
      setValue('');
      input.current?.focus();
    },
  });
  useEffect(() => {
    if (tripId) input.current?.focus();
  }, [tripId]);

  const counts = manifest.data?.counts;
  const pct = counts && counts.total > 0 ? Math.round((counts.boarded / counts.total) * 100) : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Boarding</h1>
      <div>
        <label htmlFor="bd-trip" className="mb-1 block text-sm font-medium">
          Trip
        </label>
        <select
          id="bd-trip"
          className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-[15px] focus:border-brand-600 dark:border-slate-600 dark:bg-slate-900"
          value={tripId}
          onChange={(e) => {
            setTripId(e.target.value);
            setOutcome(null);
          }}
        >
          <option value="">Choose the trip you are boarding…</option>
          {open.map((t) => (
            <option key={t.id} value={t.id}>
              {t.route} ·{' '}
              {new Date(t.departureAt).toLocaleString([], {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </option>
          ))}
        </select>
        {trips.isPending && <Spinner label="Loading trips" />}
        {trips.error && <ErrorAlert error={trips.error} onRetry={() => void trips.refetch()} />}
      </div>

      {tripId && (
        <>
          {counts && (
            <section
              aria-label="Boarding progress"
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-level1 dark:border-slate-700 dark:bg-slate-900 dark:shadow-none"
            >
              <div className="flex items-end justify-between gap-3">
                <p className="tabular text-3xl font-bold">
                  {counts.boarded}
                  <span className="text-lg font-medium text-slate-500"> / {counts.total}</span>
                  <span className="ml-2 text-sm font-medium text-slate-500">boarded</span>
                </p>
                <p className="tabular text-sm font-medium text-brand-700 dark:text-brand-500">
                  {pct}%
                </p>
              </div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={counts.total}
                aria-valuenow={counts.boarded}
                className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
              >
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
              </div>
            </section>
          )}

          <Card title="Scan or enter a ticket">
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (value.trim() && !scan.isPending) scan.mutate(value);
              }}
            >
              <div className="min-w-56 flex-1">
                <label
                  htmlFor="bd-code"
                  className="mb-1 flex items-center gap-1.5 text-sm font-medium"
                >
                  <ScanLine aria-hidden="true" className="size-4" strokeWidth={1.8} />
                  Ticket code or scanner input
                </label>
                <input
                  id="bd-code"
                  ref={input}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-base focus:border-brand-600 dark:border-slate-600 dark:bg-slate-900"
                />
              </div>
              <Button
                type="submit"
                className="min-h-12"
                loading={scan.isPending}
                loadingText="Checking…"
                disabled={!value.trim()}
              >
                <CheckCircle2 aria-hidden="true" className="size-4" strokeWidth={1.8} />
                Check ticket
              </Button>
            </form>
            <p className="mt-2 text-xs text-slate-500">
              A USB or Bluetooth barcode scanner types into this box and presses Enter by itself.
            </p>
            <div aria-live="assertive" className="mt-3">
              {outcome?.kind === 'ok' && (
                <div
                  role="status"
                  className="flex items-center gap-4 rounded-xl border border-green-200 bg-green-50 p-4 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100"
                >
                  <CheckCircle2
                    aria-hidden="true"
                    className="size-9 shrink-0 text-green-600"
                    strokeWidth={1.8}
                  />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide">Valid</p>
                    <p className="text-lg font-semibold">{outcome.text}</p>
                  </div>
                </div>
              )}
              {outcome?.kind === 'refused' && (
                <div
                  role="alert"
                  className="flex items-center gap-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
                >
                  <XCircle
                    aria-hidden="true"
                    className="size-9 shrink-0 text-red-600"
                    strokeWidth={1.8}
                  />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide">Do not board</p>
                    <p className="text-lg font-semibold">{outcome.text}</p>
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card title="Manifest">
            {manifest.isPending && <Spinner label="Loading manifest" />}
            {manifest.error && (
              <ErrorAlert error={manifest.error} onRetry={() => void manifest.refetch()} />
            )}
            {manifest.data && (
              <>
                <p className="sr-only" aria-live="polite">
                  {manifest.data.counts.boarded} of {manifest.data.counts.total} boarded
                </p>
                <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                  {manifest.data.passengers.length === 0 && (
                    <li className="py-2 text-slate-500">No confirmed tickets on this trip.</li>
                  )}
                  {manifest.data.passengers.map((p) => (
                    <li
                      key={p.ticketId}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="tabular grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-base font-bold text-brand-700 dark:bg-slate-800 dark:text-brand-500">
                          {p.seat}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{p.name}</span>
                          <span className="block font-mono text-xs text-slate-500">{p.code}</span>
                        </span>
                      </span>
                      <Badge tone={p.status === 'BOARDED' ? 'green' : 'slate'}>
                        {p.status === 'BOARDED' ? 'Boarded' : 'Not yet boarded'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
