import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { PageLoader } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { useCompany } from './company-context';

interface StopFares {
  stops: { locationId: string; name: string; city: string; position: number }[];
  fares: { fromLocationId: string; toLocationId: string; amountMinor: number; currency: string }[];
}

const key = (from: string, to: string) => `${from}>${to}`;

/**
 * "Prices by stop": one box for every pair of stops (get on at an earlier one, get off at a later
 * one). A pair left empty has no price of its own: passengers cannot book just that part, and the
 * whole-route fare still applies to the whole trip.
 */
export function StopFaresDialog({
  routeId,
  open,
  canEdit,
  onClose,
}: {
  routeId: string;
  open: boolean;
  canEdit: boolean;
  onClose: () => void;
}) {
  const { tenantId } = useCompany();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['company', tenantId, 'stop-fares', routeId],
    enabled: open,
    queryFn: ({ signal }) =>
      api<StopFares>(`/tenants/${tenantId}/routes/${routeId}/stop-fares`, { signal }),
  });
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!q.data) return;
    const next: Record<string, string> = {};
    for (const f of q.data.fares)
      next[key(f.fromLocationId, f.toLocationId)] = String(f.amountMinor / 100);
    setValues(next);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => {
      const stops = q.data?.stops ?? [];
      const fares: { fromLocationId: string; toLocationId: string; amountMinor: number }[] = [];
      for (let i = 0; i < stops.length; i++) {
        for (let j = i + 1; j < stops.length; j++) {
          const raw = values[key(stops[i]!.locationId, stops[j]!.locationId)];
          if (raw === undefined || raw.trim() === '') continue;
          fares.push({
            fromLocationId: stops[i]!.locationId,
            toLocationId: stops[j]!.locationId,
            amountMinor: Math.round(Number(raw) * 100),
          });
        }
      }
      return api(`/tenants/${tenantId}/routes/${routeId}/stop-fares`, {
        method: 'PUT',
        body: { fares },
      });
    },
    onSuccess: async () => {
      toast('Prices by stop saved. Existing bookings keep their price.', 'success');
      await qc.invalidateQueries({ queryKey: ['company', tenantId, 'stop-fares', routeId] });
      onClose();
    },
  });
  const bad = Object.values(values).some(
    (v) => v.trim() !== '' && (Number.isNaN(Number(v)) || Number(v) < 0),
  );
  const stops = q.data?.stops ?? [];
  return (
    <Dialog open={open} title="Prices by stop" onClose={onClose}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        {q.isPending && <PageLoader label="Loading stops" />}
        {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
        {save.error && <ErrorAlert error={save.error} />}
        {q.data && stops.length < 3 && (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            This route has no stops between its two ends, so the route fare is the only price. Add
            stops to the route to price the parts in between.
          </p>
        )}
        {q.data && stops.length >= 3 && (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Type the price of each part of the route. Leave a part empty if it cannot be booked on
              its own.
            </p>
            <ul className="space-y-3">
              {stops.slice(0, -1).map((from, i) => (
                <li
                  key={from.locationId}
                  className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"
                >
                  <p className="text-sm font-semibold">From {from.name}</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {stops.slice(i + 1).map((to) => {
                      const k = key(from.locationId, to.locationId);
                      return (
                        <label key={k} className="flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate">to {to.name}</span>
                          <input
                            inputMode="decimal"
                            aria-label={`Price from ${from.name} to ${to.name}`}
                            disabled={!canEdit}
                            value={values[k] ?? ''}
                            onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                            className="min-h-10 w-28 rounded-lg border border-slate-300 bg-white px-2 text-right text-sm tabular-nums dark:border-slate-600 dark:bg-slate-900"
                          />
                        </label>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
            {bad && <p className="text-xs text-red-700">Prices must be numbers, zero or more.</p>}
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {canEdit && stops.length >= 3 ? 'Cancel' : 'Close'}
          </Button>
          {canEdit && stops.length >= 3 && (
            <Button
              disabled={bad}
              loading={save.isPending}
              loadingText="Saving…"
              onClick={() => save.mutate()}
            >
              Save prices
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
