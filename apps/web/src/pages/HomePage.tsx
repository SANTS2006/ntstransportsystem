import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Building2, QrCode, ShieldCheck, Smartphone } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { SearchBar } from '../components/travel/SearchBar';
import type { TripCardData } from '../components/travel/TripResultCard';
import { linkButton } from '../components/ui/Button';
import { api } from '../lib/api';
import { addDays, isoDay, minutesLabel, money } from '../lib/format';

interface PopularRoute {
  key: string;
  from: string;
  to: string;
  fromName: string;
  toName: string;
  departures: number;
  seats: number;
  fareMinor: number;
  currency: string;
  minutes: number;
  companies: string[];
}

/** Today's real departures, grouped by route: nothing here is invented, it is what can be booked. */
function groupRoutes(trips: TripCardData[]): PopularRoute[] {
  const by = new Map<string, PopularRoute>();
  for (const t of trips) {
    const key = `${t.origin.city}>${t.destination.city}`;
    const r = by.get(key) ?? {
      key,
      from: t.origin.city,
      to: t.destination.city,
      fromName: t.origin.name,
      toName: t.destination.name,
      departures: 0,
      seats: 0,
      fareMinor: t.fareMinor,
      currency: t.currency,
      minutes: 0,
      companies: [],
    };
    r.departures += 1;
    r.seats += t.seatsLeft;
    r.fareMinor = Math.min(r.fareMinor, t.fareMinor);
    r.minutes = Math.round((Date.parse(t.arrivalAt) - Date.parse(t.departureAt)) / 60_000);
    if (!r.companies.includes(t.company)) r.companies.push(t.company);
    by.set(key, r);
  }
  return [...by.values()].sort((a, b) => b.departures - a.departures).slice(0, 4);
}

const FEATURES = [
  {
    icon: Smartphone,
    title: 'Pay with mobile money',
    text: 'Choose Orange Money, AfriMoney or QMoney when you book. Your seats are held while you pay.',
  },
  {
    icon: QrCode,
    title: 'Tickets on your phone',
    text: 'Every seat gets its own QR ticket. Show it when you board; you can also download a PDF.',
  },
  {
    icon: ShieldCheck,
    title: 'Licensed companies',
    text: 'Only companies approved on the platform can sell seats, each with its own routes and vehicles.',
  },
];

export default function HomePage() {
  const navigate = useNavigate();
  const today = isoDay(new Date());
  const q = useQuery({
    queryKey: ['home-departures', today],
    staleTime: 60_000,
    retry: false,
    queryFn: ({ signal }) =>
      api<{ trips: TripCardData[] }>(`/public/trips?date=${today}`, { signal }),
  });
  const routes = groupRoutes(q.data?.trips ?? []);

  return (
    <div className="space-y-14">
      <section className="space-y-6 text-center">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Book your seat. Travel with confidence.
          </h1>
          <p className="mx-auto w-[90%] text-slate-600 dark:text-slate-400">
            Compare coach departures across Sierra Leone, choose your seat, and pay securely with
            mobile money.
          </p>
        </div>
        <div className="mx-auto w-[90%] text-left">
          <SearchBar
            initial={{ from: '', to: '', date: addDays(today, 1) }}
            onSearch={(v) => {
              const p = new URLSearchParams({ date: v.date });
              if (v.from) p.set('from', v.from);
              if (v.to) p.set('to', v.to);
              void navigate(`/trips?${p.toString()}`);
            }}
          />
        </div>
      </section>

      <section aria-label="Why NTS Transport" className="grid gap-4 md:grid-cols-3">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-level1 dark:border-slate-700 dark:bg-slate-900 dark:shadow-none"
          >
            <span className="grid size-11 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-slate-800 dark:text-brand-500">
              <f.icon aria-hidden="true" className="size-6" strokeWidth={1.8} />
            </span>
            <h2 className="mt-4 font-semibold">{f.title}</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{f.text}</p>
          </div>
        ))}
      </section>

      {routes.length > 0 && (
        <section aria-labelledby="popular" className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-500">
              Departing today
            </p>
            <h2 id="popular" className="text-2xl font-semibold tracking-tight">
              Popular routes
            </h2>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {routes.map((r) => (
              <li
                key={r.key}
                className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-level1 dark:border-slate-700 dark:bg-slate-900 dark:shadow-none"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="flex items-center gap-2 font-semibold">
                      <span className="size-2 rounded-full bg-brand-600" aria-hidden="true" />
                      {r.from}
                    </p>
                    <p className="flex items-center gap-2 font-semibold">
                      <span className="size-2 rounded-full bg-slate-400" aria-hidden="true" />
                      {r.to}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {r.companies.slice(0, 2).join(', ')}
                      {r.companies.length > 2 ? ` and ${r.companies.length - 2} more` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">From</p>
                    <p className="tabular text-xl font-bold text-brand-700 dark:text-brand-500">
                      {money(r.fareMinor, r.currency)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                  <span>
                    {r.departures} departure{r.departures === 1 ? '' : 's'} ·{' '}
                    {minutesLabel(r.minutes)} · {r.seats} seat{r.seats === 1 ? '' : 's'} left
                  </span>
                  <Link
                    to={`/trips?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}&date=${today}`}
                    className={linkButton('secondary')}
                  >
                    View trips
                    <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-brand-100 bg-brand-50 p-6 sm:p-8 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl space-y-2">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-500">
              <Building2 aria-hidden="true" className="size-4" strokeWidth={1.8} />
              For transport companies
            </p>
            <h2 className="text-2xl font-semibold tracking-tight">
              Run a transport company? Get it on NTS.
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Companies are set up by the NTS team. Sell seats online, manage routes, vehicles, crew
              and boarding, and take payments by mobile money or at your desk.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/jobs" className={linkButton('primary')}>
              See jobs
              <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
            </Link>
            <Link to="/trips" className={linkButton('secondary')}>
              Find a trip
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
