import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Briefcase, MessageSquareWarning, Search, Ticket } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorAlert } from '../../components/ui/Alert';
import { Card, StatTile } from '../../components/ui/Card';
import { PageLoader } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
import { companyPath } from '../../lib/company-page';
import { appRoot } from '../../lib/app-path';

interface Booking {
  id: string;
  status: string;
  company: string;
  origin: { city?: string; name?: string };
  destination: { city?: string; name?: string };
  departureAt: string;
  timezone: string;
}

const place = (p: Booking['origin']) => p.city ?? p.name ?? '';

/** The first page of a passenger: the next trip, the numbers that matter and the way to everything else. */
export function PassengerDashboard() {
  const { user } = useAuth();
  const bookings = useQuery({
    queryKey: ['passenger-bookings'],
    queryFn: ({ signal }) => api<{ bookings: Booking[] }>('/passenger/bookings', { signal }),
  });
  const complaints = useQuery({
    queryKey: ['passenger-complaints'],
    queryFn: ({ signal }) =>
      api<{ complaints: { status: string }[] }>('/passenger/complaints', { signal }),
  });
  const now = Date.now();
  const list = bookings.data?.bookings ?? [];
  const upcoming = list
    .filter((b) => b.status === 'CONFIRMED' && new Date(b.departureAt).getTime() >= now)
    .sort((a, b) => a.departureAt.localeCompare(b.departureAt));
  const waiting = list.filter((b) => b.status === 'PENDING_PAYMENT').length;
  const open = (complaints.data?.complaints ?? []).filter(
    (c) => c.status !== 'CLOSED' && c.status !== 'RESOLVED',
  ).length;
  const next = upcoming[0];
  const first = user?.displayName.split(/\s+/)[0] ?? '';
  const tile =
    'flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-white p-4 text-sm font-semibold shadow-level1 transition hover:-translate-y-0.5 hover:shadow-level2 dark:bg-slate-900';

  return (
    <div className="w-full min-w-0 space-y-6">
      <header className="rounded-3xl bg-gradient-to-br from-brand-600 to-brand-800 p-5 text-white shadow-level2 sm:p-7">
        <p className="text-sm text-white/80">Welcome{first ? `, ${first}` : ''}</p>
        <h1 className="mt-1 text-2xl font-bold !text-white sm:text-3xl">Your trips</h1>
        <p className="mt-2 max-w-xl text-sm text-white/85">
          Book a seat, follow your tickets and talk to the company, all in one place.
        </p>
        <Link
          to={companyPath(user, '/trips')}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-brand-700 shadow-level1"
        >
          <Search aria-hidden="true" className="size-4" strokeWidth={1.8} />
          Find a trip
        </Link>
      </header>

      {bookings.error && (
        <ErrorAlert error={bookings.error} onRetry={() => void bookings.refetch()} />
      )}
      <section aria-label="Summary" className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Upcoming trips"
          icon={Ticket}
          value={bookings.data ? upcoming.length : '…'}
          note={waiting > 0 ? `${waiting} waiting for payment` : 'Paid and confirmed'}
        />
        <StatTile
          label="Open complaints"
          icon={MessageSquareWarning}
          tone={open > 0 ? 'amber' : 'slate'}
          value={complaints.data ? open : '…'}
        />
        <StatTile
          label="All bookings"
          icon={Ticket}
          tone="slate"
          value={bookings.data ? list.length : '…'}
        />
      </section>

      <Card title="Your next trip">
        {bookings.isPending && <PageLoader label="Loading your trips" />}
        {bookings.data && !next && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            You have no upcoming trip.{' '}
            <Link className="font-semibold text-brand-700" to={companyPath(user, '/trips')}>
              Find one
            </Link>
          </p>
        )}
        {next && (
          <Link
            to={`${appRoot()}/bookings/${next.id}`}
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <p className="break-words font-semibold">
                {place(next.origin)} to {place(next.destination)}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {next.company} ·{' '}
                {new Date(next.departureAt).toLocaleString(undefined, {
                  timeZone: next.timezone,
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
            </div>
            <span className="text-sm font-semibold text-brand-700">Open ticket</span>
          </Link>
        )}
      </Card>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[
          { to: `${appRoot()}/bookings`, label: 'My bookings', icon: Ticket },
          { to: `${appRoot()}/complaints`, label: 'My complaints', icon: MessageSquareWarning },
          { to: `${appRoot()}/applications`, label: 'My job applications', icon: Briefcase },
        ].map((t) => (
          <li key={t.to}>
            <Link to={t.to} className={tile}>
              <span className="flex min-w-0 items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-slate-800 dark:text-brand-500">
                  <t.icon aria-hidden="true" className="size-5" strokeWidth={1.8} />
                </span>
                <span className="truncate">{t.label}</span>
              </span>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-slate-400" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
