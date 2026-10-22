import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
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

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-2xl font-semibold">Boarding</h1>
      <div>
        <label htmlFor="bd-trip" className="mb-1 block text-sm font-medium">
          Trip
        </label>
        <select
          id="bd-trip"
          className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
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
          <Card title="Scan or enter a ticket">
            <form
              className="mt-3 flex flex-wrap gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (value.trim() && !scan.isPending) scan.mutate(value);
              }}
            >
              <div className="min-w-56 flex-1">
                <label htmlFor="bd-code" className="mb-1 block text-sm font-medium">
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
                  className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm dark:border-slate-600 dark:bg-slate-900"
                />
              </div>
              <Button
                type="submit"
                className="mt-6"
                loading={scan.isPending}
                loadingText="Checking…"
                disabled={!value.trim()}
              >
                Check ticket
              </Button>
            </form>
            <p className="mt-2 text-xs text-slate-500">
              A USB or Bluetooth barcode scanner types into this box and presses Enter by itself.
            </p>
            <div aria-live="assertive" className="mt-3">
              {outcome?.kind === 'ok' && <Alert tone="success">{outcome.text}</Alert>}
              {outcome?.kind === 'refused' && <Alert tone="error">{outcome.text}</Alert>}
            </div>
          </Card>

          <Card title="Manifest">
            {manifest.isPending && <Spinner label="Loading manifest" />}
            {manifest.error && (
              <ErrorAlert error={manifest.error} onRetry={() => void manifest.refetch()} />
            )}
            {manifest.data && (
              <>
                <p className="mt-2 text-sm" aria-live="polite">
                  {manifest.data.counts.boarded} of {manifest.data.counts.total} boarded
                </p>
                <ul className="mt-2 divide-y divide-slate-200 text-sm dark:divide-slate-700">
                  {manifest.data.passengers.length === 0 && (
                    <li className="py-2 text-slate-500">No confirmed tickets on this trip.</li>
                  )}
                  {manifest.data.passengers.map((p) => (
                    <li
                      key={p.ticketId}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <span>
                        <span className="font-medium">Seat {p.seat}</span> · {p.name}{' '}
                        <span className="font-mono text-xs text-slate-500">{p.code}</span>
                      </span>
                      <span
                        className={
                          p.status === 'BOARDED'
                            ? 'font-medium text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-500'
                        }
                      >
                        {p.status === 'BOARDED' ? 'Boarded' : 'Not yet boarded'}
                      </span>
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
