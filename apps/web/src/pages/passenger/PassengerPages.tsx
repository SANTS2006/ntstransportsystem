import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { companyPath } from '../../lib/company-page';
import { useCompanyPublic } from '../../lib/company-public';
import { useCompanyLinks } from '../../lib/company-links';
import { useConfirm } from '../../components/ui/Confirm';
import { Accessibility, Bus, Clock, Lock } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Badge, Card, StatusBadge } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { PageLoader } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { clockTime, duration, initials, shortDate } from '../../lib/format';
import { RateTrip } from './ComplaintPages';
import { appRoot } from '../../lib/app-path';
import { ListTools } from '../../components/ui/ListTools';

const MAX_SEATS = 8;
const money = (minor: number, currency: string) =>
  `${currency} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
const when = (iso: string, tz: string) =>
  new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

interface Place {
  name: string;
  city: string;
}
interface TripSummary {
  tripId: string;
  tenantId: string;
  company: string;
  timezone: string;
  route: string;
  origin: Place;
  destination: Place;
  departureAt: string;
  arrivalAt: string;
  delayMinutes: number;
  fareMinor: number;
  currency: string;
}
interface TripDetail extends TripSummary {
  /** Origin, every stop and the destination, in order. */
  stops?: { locationId: string; name: string; city: string }[];
  /** The price between pairs of stops (empty when the company prices the whole route only). */
  stopFares?: {
    fromLocationId: string;
    toLocationId: string;
    amountMinor: number;
    currency: string;
  }[];
  sellable: boolean;
  seats: { label: string; accessible: boolean; status: 'AVAILABLE' | 'TAKEN' }[];
}
interface MyBooking {
  id: string;
  tenantId: string;
  reference: string;
  status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';
  company: string;
  timezone: string;
  origin: Place;
  destination: Place;
  departureAt: string;
  delayMinutes: number;
  tripStatus: string;
  totalMinor: number;
  currency: string;
  holdExpiresAt: string | null;
  paymentStatus: string | null;
  claim?: { method: string; reference: string; createdAt: string } | null;
  passengers: { seatLabel: string; fullName: string }[];
}

const STATUS_LABEL: Record<MyBooking['status'], string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

export { TripSearchPage } from './TripSearchPage';

// ---- Choose seats and book -------------------------------------------------------------------

export function TripBookPage() {
  const { tenantId: tenantParam, tripId } = useParams();
  const company = useCompanyPublic();
  const tenantId = company?.id ?? tenantParam;
  const navigate = useNavigate();
  const { user } = useAuth();
  const [picked, setPicked] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [contact, setContact] = useState({ name: user?.displayName ?? '', phone: '' });
  const [error, setError] = useState<string | null>(null);
  const [boardAt, setBoardAt] = useState<string | null>(null);
  const [alightAt, setAlightAt] = useState<string | null>(null);
  const attempt = useRef(crypto.randomUUID());
  const links = useCompanyLinks(tenantId);

  const q = useQuery({
    queryKey: ['public-trip', tenantId, tripId],
    queryFn: ({ signal }) => api<TripDetail>(`/public/trips/${tenantId}/${tripId}`, { signal }),
    retry: false,
  });

  /** Which stops the passenger rides between, and what a seat costs for that part of the route. */
  const stopPick = (() => {
    const d = q.data;
    const stops = d?.stops ?? [];
    const fares = d?.stopFares ?? [];
    const priced = stops.length > 2 && fares.length > 0;
    const first = stops[0]?.locationId;
    const last = stops[stops.length - 1]?.locationId;
    const from = boardAt ?? first;
    const to = alightAt ?? last;
    const pair = priced
      ? fares.find((f) => f.fromLocationId === from && f.toLocationId === to)
      : undefined;
    const whole = from === first && to === last;
    const unit = pair ? pair.amountMinor : whole && d ? d.fareMinor : null;
    return { stops, priced, from, to, pair, unit };
  })();

  const book = useMutation({
    mutationFn: async () => {
      const booking = await api<MyBooking>('/passenger/bookings', {
        method: 'POST',
        headers: { 'idempotency-key': attempt.current },
        body: {
          tenantId,
          tripId,
          contact: { name: contact.name.trim(), phone: contact.phone.trim() },
          ...(stopPick.pair
            ? {
                boardingLocationId: stopPick.pair.fromLocationId,
                alightingLocationId: stopPick.pair.toLocationId,
              }
            : {}),
          passengers: picked.map((s) => ({
            seatLabel: s,
            fullName: (names[s] ?? '').trim() || contact.name.trim(),
          })),
        },
      });
      return booking.id;
    },
    // Seats are held; the next page is where they choose how to pay.
    onSuccess: (bookingId) => void navigate(`${appRoot()}/bookings/${bookingId}/pay`),
    onError: async (e) => {
      // After a timeout the booking may exist; the same key makes a retry return it, not a copy.
      setError(errMsg(e));
      await q.refetch();
      setPicked((cur) =>
        cur.filter((s) => q.data?.seats.find((x) => x.label === s)?.status !== 'TAKEN'),
      );
    },
  });

  if (q.isPending) return <PageLoader label="Loading trip" />;
  if (q.error || !q.data) {
    return (
      <div className="w-full space-y-4">
        <Alert tone="error">This trip is no longer available for online booking.</Alert>
        <Link
          className="text-brand-700 font-medium"
          to={company ? `/${company.slug}/trips` : '/trips'}
        >
          Back to search
        </Link>
      </div>
    );
  }
  const t = q.data;
  const toggle = (label: string) => {
    setError(null);
    setPicked((cur) =>
      cur.includes(label)
        ? cur.filter((x) => x !== label)
        : cur.length >= MAX_SEATS
          ? cur
          : [...cur, label],
    );
  };
  const unitFare = stopPick.unit;
  const total = picked.length * (unitFare ?? 0);
  const valid =
    unitFare !== null &&
    picked.length > 0 &&
    contact.name.trim().length >= 2 &&
    contact.phone.trim().length >= 6;

  return (
    <div className="w-full space-y-5">
      {/* The trip */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-level1 sm:p-6 dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-slate-500">{t.company}</p>
            <h1 className="text-2xl font-semibold tracking-tight">{t.route}</h1>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">
              {stopPick.priced ? 'Whole route, per seat' : 'Fare per seat'}
            </p>
            <p className="tabular text-xl font-bold text-brand-700 dark:text-brand-500">
              {money(t.fareMinor, t.currency)}
            </p>
          </div>
        </div>
        {stopPick.priced && (
          <div className="mt-4 grid gap-3 rounded-xl bg-brand-50 p-3 sm:grid-cols-2 dark:bg-slate-800">
            <div>
              <label htmlFor="board-at" className="mb-1 block text-xs font-medium">
                Get on at
              </label>
              <select
                id="board-at"
                value={stopPick.from}
                onChange={(e) => {
                  const idx = stopPick.stops.findIndex((x) => x.locationId === e.target.value);
                  const toIdx = stopPick.stops.findIndex((x) => x.locationId === stopPick.to);
                  setBoardAt(e.target.value);
                  if (toIdx <= idx)
                    setAlightAt(stopPick.stops[stopPick.stops.length - 1]!.locationId);
                }}
                className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900"
              >
                {stopPick.stops.slice(0, -1).map((x) => (
                  <option key={x.locationId} value={x.locationId}>
                    {x.name}, {x.city}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="alight-at" className="mb-1 block text-xs font-medium">
                Get off at
              </label>
              <select
                id="alight-at"
                value={stopPick.to}
                onChange={(e) => setAlightAt(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900"
              >
                {stopPick.stops
                  .slice(stopPick.stops.findIndex((x) => x.locationId === stopPick.from) + 1)
                  .map((x) => (
                    <option key={x.locationId} value={x.locationId}>
                      {x.name}, {x.city}
                    </option>
                  ))}
              </select>
            </div>
            <p className="text-sm font-medium sm:col-span-2">
              {unitFare !== null
                ? `This part of the trip: ${money(unitFare, t.currency)} per seat`
                : 'There is no price for this part of the trip. Choose different stops.'}
            </p>
          </div>
        )}
        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div>
            <p className="tabular text-2xl font-bold leading-none">
              {clockTime(t.departureAt, t.timezone)}
            </p>
            <p className="mt-1 text-sm font-medium">{t.origin.city}</p>
            <p className="text-xs text-slate-500">
              {t.origin.name} · {shortDate(t.departureAt, t.timezone)}
            </p>
          </div>
          <div className="flex flex-col items-center gap-1 text-xs text-slate-500">
            <span>{duration(t.departureAt, t.arrivalAt)}</span>
            <span className="flex items-center gap-1" aria-hidden="true">
              <span className="size-2 rounded-full bg-brand-600" />
              <span className="h-px w-10 bg-slate-300 sm:w-24 dark:bg-slate-600" />
              <Bus className="size-4" strokeWidth={1.8} />
              <span className="h-px w-10 bg-slate-300 sm:w-24 dark:bg-slate-600" />
              <span className="size-2 rounded-full bg-slate-400" />
            </span>
          </div>
          <div className="text-right">
            <p className="tabular text-2xl font-bold leading-none">
              {clockTime(t.arrivalAt, t.timezone)}
            </p>
            <p className="mt-1 text-sm font-medium">{t.destination.city}</p>
            <p className="text-xs text-slate-500">{t.destination.name}</p>
          </div>
        </div>
        {t.delayMinutes > 0 && (
          <p className="mt-3">
            <Badge tone="amber" icon={Clock}>
              Delayed about {t.delayMinutes} min
            </Badge>
          </p>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        {/* Seats */}
        <Card title="Choose your seats" className="self-start">
          <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
            <li className="flex items-center gap-1.5">
              <span className="size-4 rounded border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900" />
              Available
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-4 rounded border border-brand-600 bg-brand-600" />
              Selected
            </li>
            <li className="flex items-center gap-1.5">
              <span className="grid size-4 place-items-center rounded bg-slate-200 dark:bg-slate-700">
                <Lock className="size-2.5 text-slate-500" strokeWidth={2} />
              </span>
              Taken
            </li>
            <li className="flex items-center gap-1.5">
              <Accessibility className="size-4" strokeWidth={1.8} />
              Accessible
            </li>
          </ul>
          <fieldset>
            <legend className="sr-only">Seats</legend>
            <div className="grid grid-cols-4 gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-5 dark:bg-slate-800/50">
              {t.seats.map((s) => {
                const on = picked.includes(s.label);
                const taken = s.status === 'TAKEN';
                return (
                  <button
                    key={s.label}
                    type="button"
                    disabled={taken}
                    aria-pressed={on}
                    aria-label={`Seat ${s.label}${s.accessible ? ' (accessible)' : ''}${taken ? ', taken' : ''}`}
                    onClick={() => toggle(s.label)}
                    className={`tabular relative grid min-h-12 place-items-center rounded-lg border text-sm font-semibold transition-colors disabled:cursor-not-allowed ${
                      on
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : taken
                          ? 'border-transparent bg-slate-200 text-slate-400 dark:bg-slate-700'
                          : 'border-slate-300 bg-white hover:border-brand-600 dark:border-slate-600 dark:bg-slate-900'
                    }`}
                  >
                    {taken ? <Lock className="size-4" strokeWidth={1.8} /> : s.label}
                    {s.accessible && !taken && (
                      <Accessibility
                        aria-hidden="true"
                        className="absolute right-1 top-1 size-3"
                        strokeWidth={1.8}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-400" aria-live="polite">
            {picked.length === 0
              ? `Choose up to ${MAX_SEATS} seats.`
              : `${picked.length} seat(s) chosen: ${picked.join(', ')}`}
          </p>
        </Card>

        {/* Who is travelling, and the total */}
        <div className="space-y-5">
          {picked.length === 0 ? (
            <Card>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Pick a seat to see the price and add the passengers.
              </p>
            </Card>
          ) : user ? (
            <>
              <Card title="Passengers">
                <div className="space-y-3">
                  <Field
                    label="Contact name"
                    value={contact.name}
                    onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))}
                  />
                  <Field
                    label="Contact phone"
                    type="tel"
                    value={contact.phone}
                    hint="We use it for notices about this trip."
                    onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))}
                  />
                  {picked.map((s) => (
                    <Field
                      key={s}
                      label={`Passenger name, seat ${s}`}
                      value={names[s] ?? ''}
                      placeholder={contact.name || 'Same as contact'}
                      onChange={(e) => setNames((n) => ({ ...n, [s]: e.target.value }))}
                    />
                  ))}
                </div>
              </Card>
              <Card title="Fare summary">
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-600 dark:text-slate-400">
                      {picked.length} × {money(unitFare ?? 0, t.currency)}
                    </dt>
                    <dd className="tabular">{money(total, t.currency)}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex items-end justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <span className="text-sm font-medium">Total to pay</span>
                  <span className="tabular text-2xl font-bold tracking-tight text-brand-700 dark:text-brand-500">
                    {money(total, t.currency)}
                  </span>
                </div>
                {error && (
                  <div className="mt-3">
                    <Alert tone="error">{error}</Alert>
                  </div>
                )}
                <Button
                  className="mt-4 w-full"
                  disabled={!valid}
                  loading={book.isPending}
                  loadingText="Holding your seats…"
                  onClick={() => {
                    setError(null);
                    book.mutate();
                  }}
                >
                  <Lock aria-hidden="true" className="size-4" strokeWidth={1.8} />
                  Continue to payment
                </Button>
                <p className="mt-2 text-center text-xs text-slate-500">
                  Your seats are held for a short time while you choose how to pay.
                </p>
              </Card>
            </>
          ) : (
            <Alert tone="info">
              <Link
                className="font-medium font-medium"
                to={links.signIn(
                  company ? `/${company.slug}/trips/${tripId}` : `/trips/${tenantId}/${tripId}`,
                )}
              >
                Sign in
              </Link>{' '}
              or{' '}
              <Link className="font-medium font-medium" to={links.signUp}>
                create an account
              </Link>{' '}
              to book these seats.
            </Alert>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Return from payment ---------------------------------------------------------------------

export function PayReturnPage() {
  const [params] = useSearchParams();
  const bookingId = params.get('booking');
  const result = params.get('result');
  const [stopped, setStopped] = useState(false);
  const started = useRef(Date.now());
  const q = useQuery({
    queryKey: ['passenger-status', bookingId],
    enabled: !!bookingId,
    queryFn: ({ signal }) => api<MyBooking>(`/passenger/bookings/${bookingId}/status`, { signal }),
    refetchInterval: (query) =>
      query.state.data?.status === 'PENDING_PAYMENT' && !stopped && result !== 'cancelled'
        ? 4000
        : false,
  });
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - started.current > 120_000) setStopped(true);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  if (!bookingId) return <Alert tone="error">This page needs a booking reference.</Alert>;
  if (q.isPending) return <PageLoader label="Checking your payment" />;
  if (q.error) return <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />;
  const b = q.data;
  return (
    <div className="w-full space-y-4">
      {b.status === 'CONFIRMED' && (
        <Alert tone="success">
          Payment received. Your booking <strong>{b.reference}</strong> is confirmed.
        </Alert>
      )}
      {b.status === 'PENDING_PAYMENT' && result === 'cancelled' && (
        <Alert tone="info">
          Payment was cancelled. Your seats are held for a few more minutes: you can try again from
          My bookings.
        </Alert>
      )}
      {b.status === 'PENDING_PAYMENT' && result !== 'cancelled' && !stopped && (
        <Alert tone="info">
          Waiting for your payment to be confirmed. This usually takes a few seconds.
        </Alert>
      )}
      {b.status === 'PENDING_PAYMENT' && result !== 'cancelled' && stopped && (
        <Alert tone="info">
          We have not received confirmation yet. If you were charged, do not pay again: check My
          bookings in a few minutes or contact {b.company} with reference {b.reference}.
        </Alert>
      )}
      {(b.status === 'EXPIRED' || b.status === 'CANCELLED') && (
        <Alert tone="error">
          This booking is {b.status.toLowerCase()}. If you were charged, contact {b.company} with
          reference <strong>{b.reference}</strong>.
        </Alert>
      )}
      <BookingCard b={b} />
      {b.status === 'CONFIRMED' && (
        <Link
          className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 font-medium text-white hover:bg-brand-700"
          to={`${appRoot()}/bookings/${b.id}`}
        >
          View my tickets
        </Link>
      )}
      <Link className="block text-brand-700 font-medium" to={`${appRoot()}/bookings`}>
        My bookings
      </Link>
    </div>
  );
}

// ---- My bookings -----------------------------------------------------------------------------

function BookingCard({ b, children }: { b: MyBooking; children?: ReactNode }) {
  return (
    <div
      data-list-item
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-level1 sm:p-5 dark:border-slate-700 dark:bg-slate-900 dark:shadow-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-sm font-bold text-brand-700 dark:bg-slate-800 dark:text-brand-500"
          >
            {initials(b.company)}
          </span>
          <div className="min-w-0">
            <p className="font-semibold">
              {b.origin.city} → {b.destination.city}
            </p>
            <p className="truncate text-xs text-slate-500">{b.company}</p>
          </div>
        </div>
        <StatusBadge
          status={
            b.status === 'CONFIRMED'
              ? 'ACTIVE'
              : b.status === 'PENDING_PAYMENT'
                ? 'PENDING'
                : 'REJECTED'
          }
          label={STATUS_LABEL[b.status]}
        />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-4 dark:border-slate-800">
        <div>
          <dt className="text-xs text-slate-500">Departs</dt>
          <dd className="font-medium">
            {when(b.departureAt, b.timezone)}
            {b.delayMinutes ? ` (delayed ${b.delayMinutes} min)` : ''}
          </dd>
          {b.tripStatus === 'CANCELLED' && (
            <dd className="text-xs text-red-700 dark:text-red-400">Trip cancelled</dd>
          )}
        </div>
        <div>
          <dt className="text-xs text-slate-500">Seats</dt>
          <dd className="font-medium">{b.passengers.map((p) => p.seatLabel).join(', ') || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Reference</dt>
          <dd className="font-mono font-medium">{b.reference}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Total</dt>
          <dd className="tabular font-bold text-brand-700 dark:text-brand-500">
            {money(b.totalMinor, b.currency)}
          </dd>
        </div>
      </dl>
      {b.status === 'PENDING_PAYMENT' && b.claim && (
        <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
          Waiting for the company to confirm your QMoney payment (transaction {b.claim.reference}).
        </p>
      )}
      {children}
    </div>
  );
}

export function MyBookingsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ['passenger-bookings'],
    queryFn: ({ signal }) => api<{ bookings: MyBooking[] }>('/passenger/bookings', { signal }),
  });
  const ask = useConfirm();
  const cancel = useMutation({
    mutationFn: (id: string) =>
      api(`/passenger/bookings/${id}/cancel`, { method: 'POST', body: {} }),
    onSuccess: async () => {
      toast('Booking cancelled', 'success');
      await qc.invalidateQueries({ queryKey: ['passenger-bookings'] });
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">My bookings</h1>
        <Button variant="secondary" onClick={() => nav(companyPath(user, '/trips'))}>
          Find a trip
        </Button>
      </div>
      {q.isPending && <PageLoader label="Loading your bookings" />}
      {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      {q.data?.bookings.length === 0 && (
        <Alert tone="info">
          You have no bookings yet.{' '}
          <Link className="font-medium" to={companyPath(user, '/trips')}>
            Search for a trip
          </Link>
          .
        </Alert>
      )}
      {q.data && q.data.bookings.length > 0 && (
        <ListTools title="My bookings">
          <div className="space-y-4">
            {q.data.bookings.map((b) => (
              <BookingCard key={b.id} b={b}>
                {b.status === 'CONFIRMED' && (
                  <div className="mt-3">
                    <Link
                      className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
                      to={`${appRoot()}/bookings/${b.id}`}
                    >
                      View tickets
                    </Link>
                    <Link
                      className="ml-3 inline-flex min-h-11 items-center text-sm text-brand-700 font-medium dark:text-brand-500"
                      to={`${appRoot()}/complaints/new?booking=${b.id}`}
                    >
                      Report a problem
                    </Link>
                    {b.tripStatus === 'COMPLETED' && <RateTrip bookingId={b.id} />}
                  </div>
                )}
                {b.status === 'PENDING_PAYMENT' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button onClick={() => void nav(`${appRoot()}/bookings/${b.id}/pay`)}>
                      Pay now
                    </Button>
                    <Button
                      variant="ghost"
                      loading={cancel.isPending && cancel.variables === b.id}
                      onClick={async () => {
                        if (
                          await ask({
                            title: 'Cancel this booking?',
                            message: 'Your seats are released.',
                            confirmLabel: 'Cancel booking',
                            danger: true,
                          })
                        )
                          cancel.mutate(b.id);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </BookingCard>
            ))}
          </div>
        </ListTools>
      )}
    </div>
  );
}
