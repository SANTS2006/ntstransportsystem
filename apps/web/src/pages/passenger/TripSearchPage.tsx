import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { SearchBar } from '../../components/travel/SearchBar';
import { TripResultCard, type TripCardData } from '../../components/travel/TripResultCard';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
import { addDays, isoDay } from '../../lib/format';

const tomorrow = () => addDays(isoDay(new Date()), 1);
const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${iso}T00:00:00Z`));

/** Search results for one day, earliest departure first, with a quick way to try the next day. */
export function TripSearchPage() {
  const [params, setParams] = useSearchParams();
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const active = params.get('date');
  const go = (v: { from: string; to: string; date: string }) =>
    setParams({
      ...(v.from ? { from: v.from } : {}),
      ...(v.to ? { to: v.to } : {}),
      date: v.date,
    });
  const results = useQuery({
    queryKey: ['public-trips', from || null, to || null, active],
    enabled: active !== null,
    queryFn: ({ signal }) =>
      api<{ trips: TripCardData[] }>(
        `/public/trips?date=${active}${from ? `&from=${encodeURIComponent(from)}` : ''}${to ? `&to=${encodeURIComponent(to)}` : ''}`,
        { signal },
      ),
  });
  const trips = [...(results.data?.trips ?? [])].sort(
    (a, b) => Date.parse(a.departureAt) - Date.parse(b.departureAt),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Find a trip</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Compare departures from licensed companies and choose your seats.
        </p>
      </div>
      <SearchBar
        key={`${from}|${to}|${active}`}
        initial={{ from, to, date: active ?? tomorrow() }}
        onSearch={go}
        compact
      />

      {active && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => go({ from, to, date: addDays(active, -1) })}
            className="grid size-11 place-items-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ChevronLeft className="size-5" />
          </button>
          <div className="text-center">
            <p className="font-semibold">{dayLabel(active)}</p>
            {results.data && (
              <p className="text-xs text-slate-500">
                {trips.length === 0
                  ? 'No departures'
                  : `${trips.length} departure${trips.length === 1 ? '' : 's'}`}
                {from || to ? ` · ${from || 'anywhere'} to ${to || 'anywhere'}` : ''}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Next day"
            onClick={() => go({ from, to, date: addDays(active, 1) })}
            className="grid size-11 place-items-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>
      )}

      {results.isFetching && <Spinner label="Searching" />}
      {results.error && <ErrorAlert error={results.error} onRetry={() => void results.refetch()} />}
      {results.data && trips.length === 0 && (
        <Alert tone="info">No trips found for that day. Try the next day, or a nearby city.</Alert>
      )}
      <ul className="space-y-3">
        {trips.map((t) => (
          <TripResultCard key={t.tripId} t={t} />
        ))}
      </ul>
    </div>
  );
}
