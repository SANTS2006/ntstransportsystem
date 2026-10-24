import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Briefcase, Bus } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { SearchBar } from '../../components/travel/SearchBar';
import { TripResultCard, type TripCardData } from '../../components/travel/TripResultCard';
import { linkButton } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
import { useCompanyPublic } from '../../lib/company-public';
import { addDays, isoDay } from '../../lib/format';

interface Job {
  id: string;
  title: string;
  jobRole: string;
  location: string | null;
  closesOn: string | null;
}

/** A company's own front page: search its trips, see what leaves today, and its open jobs. */
export default function CompanyHome() {
  const company = useCompanyPublic();
  const navigate = useNavigate();
  const today = isoDay(new Date());
  const id = company?.id;
  const trips = useQuery({
    queryKey: ['company-home-trips', id, today],
    enabled: Boolean(id),
    staleTime: 60_000,
    retry: false,
    queryFn: ({ signal }) =>
      api<{ trips: TripCardData[] }>(`/public/trips?date=${today}&tenantId=${id}`, { signal }),
  });
  const jobs = useQuery({
    queryKey: ['company-home-jobs', id],
    enabled: Boolean(id),
    staleTime: 60_000,
    retry: false,
    queryFn: ({ signal }) => api<{ jobs: Job[] }>(`/public/jobs?tenantId=${id}`, { signal }),
  });
  if (!company) return null;
  const base = `/${company.slug}`;
  const todays = [...(trips.data?.trips ?? [])].sort(
    (a, b) => Date.parse(a.departureAt) - Date.parse(b.departureAt),
  );
  return (
    <div className="space-y-12">
      <section className="space-y-6 text-center">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Book your seat with {company.name}
          </h1>
          <p className="w-full text-slate-700 dark:text-slate-300">
            Find a departure, choose your seat and pay securely with mobile money.
          </p>
        </div>
        <div className="w-full text-left">
          <SearchBar
            initial={{ from: '', to: '', date: addDays(today, 1) }}
            onSearch={(v) => {
              const p = new URLSearchParams({ date: v.date });
              if (v.from) p.set('from', v.from);
              if (v.to) p.set('to', v.to);
              void navigate(`${base}/trips?${p.toString()}`);
            }}
          />
        </div>
      </section>

      <section aria-labelledby="today" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-500">
              <Bus aria-hidden="true" className="size-4" strokeWidth={1.8} />
              Departing today
            </p>
            <h2 id="today" className="text-2xl font-semibold tracking-tight">
              Trips by {company.name}
            </h2>
          </div>
          <Link to={`${base}/trips?date=${addDays(today, 1)}`} className={linkButton('secondary')}>
            See tomorrow
            <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
          </Link>
        </div>
        {trips.isPending && <PageLoader label="Loading trips" />}
        {trips.data && todays.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300">
            No departures left today. Search another day above.
          </p>
        )}
        <ul className="space-y-3">
          {todays.slice(0, 5).map((t) => (
            <TripResultCard key={t.tripId} t={t} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="jobs" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-500">
              <Briefcase aria-hidden="true" className="size-4" strokeWidth={1.8} />
              Work with us
            </p>
            <h2 id="jobs" className="text-2xl font-semibold tracking-tight">
              Open jobs
            </h2>
          </div>
          <Link to={`${base}/jobs`} className={linkButton('secondary')}>
            All jobs
            <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
          </Link>
        </div>
        {jobs.data && jobs.data.jobs.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300">
            There are no open jobs right now.
          </p>
        )}
        <ul className="grid gap-3 sm:grid-cols-2">
          {jobs.data?.jobs.slice(0, 4).map((j) => (
            <li key={j.id}>
              <Link
                to={`${base}/jobs/${j.id}`}
                className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-level1 hover:border-brand-600 dark:border-slate-700 dark:bg-slate-900"
              >
                <span className="block font-semibold">{j.title}</span>
                <span className="text-sm text-slate-700 dark:text-slate-300">
                  {j.location ?? 'Location to be confirmed'}
                  {j.closesOn ? ` · apply by ${j.closesOn}` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
