import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, StatusBadge } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';

const MAX_SEATS = 8;
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
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
interface TripCard extends TripSummary {
  seatsLeft: number;
}
interface TripDetail extends TripSummary {
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
  passengers: { seatLabel: string; fullName: string }[];
}

const STATUS_LABEL: Record<MyBooking['status'], string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

/** Sends the browser to the provider's checkout. Only https destinations are ever followed. */
function goToCheckout(url: string) {
  if (!url.startsWith('https://')) throw new Error('The payment page address was not valid.');
  window.location.assign(url);
}

// ---- Search ----------------------------------------------------------------------------------

export function TripSearchPage() {
  const [params, setParams] = useSearchParams();
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');
  const [date, setDate] = useState(params.get('date') ?? tomorrow());
  const active = params.get('date');
  const results = useQuery({
    queryKey: ['public-trips', params.get('from'), params.get('to'), active],
    enabled: active !== null,
    queryFn: ({ signal }) =>
      api<{ trips: TripCard[] }>(
        `/public/trips?date=${active}${params.get('from') ? `&from=${encodeURIComponent(params.get('from') as string)}` : ''}${params.get('to') ? `&to=${encodeURIComponent(params.get('to') as string)}` : ''}`,
        { signal },
      ),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold text-brand-700 dark:text-brand-500">Find a trip</h1>
      <form
        className="grid gap-3 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          setParams({
            ...(from.trim() ? { from: from.trim() } : {}),
            ...(to.trim() ? { to: to.trim() } : {}),
            date,
          });
        }}
      >
        <Field label="From (city)" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Field label="To (city)" value={to} onChange={(e) => setTo(e.target.value)} />
        <Field label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Button type="submit" className="sm:mt-6" disabled={!date}>
          Search
        </Button>
      </form>

      {results.isFetching && <Spinner label="Searching" />}
      {results.error && <ErrorAlert error={results.error} onRetry={() => void results.refetch()} />}
      {results.data && results.data.trips.length === 0 && (
        <Alert tone="info">No trips found for that day. Try another date or a nearby city.</Alert>
      )}
      <ul className="space-y-3">
        {results.data?.trips.map((t) => (
          <li
            key={t.tripId}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">
                  {t.origin.city} → {t.destination.city}
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {t.company} · departs {when(t.departureAt, t.timezone)}
                  {t.delayMinutes ? ` (delayed ${t.delayMinutes} min)` : ''}
                </p>
                <p className="text-sm">
                  {money(t.fareMinor, t.currency)} per seat ·{' '}
                  {t.seatsLeft > 0 ? `${t.seatsLeft} seat(s) left` : 'Sold out'}
                </p>
              </div>
              {t.seatsLeft > 0 ? (
                <Link
                  to={`/trips/${t.tenantId}/${t.tripId}`}
                  className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-4 font-medium text-white hover:bg-brand-600"
                >
                  Choose seats
                </Link>
              ) : (
                <span className="text-sm text-slate-500">Unavailable</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Choose seats and book -------------------------------------------------------------------

export function TripBookPage() {
  const { tenantId, tripId } = useParams();
  const { user } = useAuth();
  const [picked, setPicked] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [contact, setContact] = useState({ name: user?.displayName ?? '', phone: '' });
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef(crypto.randomUUID());

  const q = useQuery({
    queryKey: ['public-trip', tenantId, tripId],
    queryFn: ({ signal }) => api<TripDetail>(`/public/trips/${tenantId}/${tripId}`, { signal }),
    retry: false,
  });

  const book = useMutation({
    mutationFn: async () => {
      const booking = await api<MyBooking>('/passenger/bookings', {
        method: 'POST',
        headers: { 'idempotency-key': attempt.current },
        body: {
          tenantId,
          tripId,
          contact: { name: contact.name.trim(), phone: contact.phone.trim() },
          passengers: picked.map((s) => ({
            seatLabel: s,
            fullName: (names[s] ?? '').trim() || contact.name.trim(),
          })),
        },
      });
      const pay = await api<{ redirectUrl: string }>(`/passenger/bookings/${booking.id}/pay`, {
        method: 'POST',
        body: {},
      });
      return pay.redirectUrl;
    },
    onSuccess: (url) => {
      try {
        goToCheckout(url);
      } catch (e) {
        setError(errMsg(e));
      }
    },
    onError: async (e) => {
      // After a timeout the booking may exist; the same key makes a retry return it, not a copy.
      setError(errMsg(e));
      await q.refetch();
      setPicked((cur) =>
        cur.filter((s) => q.data?.seats.find((x) => x.label === s)?.status !== 'TAKEN'),
      );
    },
  });

  if (q.isPending) return <Spinner label="Loading trip" />;
  if (q.error || !q.data) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <Alert tone="error">This trip is no longer available for online booking.</Alert>
        <Link className="text-brand-700 underline" to="/trips">
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
  const total = picked.length * t.fareMinor;
  const valid =
    picked.length > 0 && contact.name.trim().length >= 2 && contact.phone.trim().length >= 6;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {t.origin.city} → {t.destination.city}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {t.company} · departs {when(t.departureAt, t.timezone)} · {money(t.fareMinor, t.currency)}{' '}
          per seat
        </p>
      </div>

      <Card title="Choose your seats">
        <fieldset className="mt-3">
          <legend className="sr-only">Seats</legend>
          <div className="flex flex-wrap gap-2">
            {t.seats.map((s) => {
              const on = picked.includes(s.label);
              return (
                <button
                  key={s.label}
                  type="button"
                  disabled={s.status === 'TAKEN'}
                  aria-pressed={on}
                  aria-label={`Seat ${s.label}${s.accessible ? ' (accessible)' : ''}${s.status === 'TAKEN' ? ', taken' : ''}`}
                  onClick={() => toggle(s.label)}
                  className={`min-h-11 min-w-11 rounded-lg border px-2 text-sm font-medium disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:line-through dark:disabled:bg-slate-800 ${
                    on
                      ? 'border-brand-700 bg-brand-700 text-white'
                      : 'border-slate-300 dark:border-slate-600'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <p className="mt-3 text-sm" aria-live="polite">
          {picked.length === 0
            ? `Choose up to ${MAX_SEATS} seats.`
            : `${picked.length} seat(s): ${picked.join(', ')} · ${money(total, t.currency)}`}
        </p>
      </Card>

      {picked.length > 0 &&
        (user ? (
          <Card title="Who is travelling?">
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field
                label="Contact name"
                value={contact.name}
                onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))}
              />
              <Field
                label="Contact phone"
                type="tel"
                value={contact.phone}
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
            {error && <Alert tone="error">{error}</Alert>}
            <p className="mt-3 text-xs text-slate-500">
              Seats are held for a short time while you pay. You will be taken to the secure payment
              page.
            </p>
            <Button
              className="mt-3"
              disabled={!valid}
              loading={book.isPending}
              loadingText="Holding your seats…"
              onClick={() => {
                setError(null);
                book.mutate();
              }}
            >
              Pay {money(total, t.currency)}
            </Button>
          </Card>
        ) : (
          <Alert tone="info">
            <Link
              className="font-medium underline"
              to={`/login?next=${encodeURIComponent(`/trips/${tenantId}/${tripId}`)}`}
            >
              Sign in
            </Link>{' '}
            or{' '}
            <Link className="font-medium underline" to="/register">
              create an account
            </Link>{' '}
            to book these seats.
          </Alert>
        ))}
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
  if (q.isPending) return <Spinner label="Checking your payment" />;
  if (q.error) return <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />;
  const b = q.data;
  return (
    <div className="mx-auto max-w-xl space-y-4">
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
      <Link className="text-brand-700 underline" to="/app/bookings">
        My bookings
      </Link>
    </div>
  );
}

// ---- My bookings -----------------------------------------------------------------------------

function BookingCard({ b, children }: { b: MyBooking; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            {b.origin.city} → {b.destination.city}
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {b.company} · {when(b.departureAt, b.timezone)}
            {b.delayMinutes ? ` (delayed ${b.delayMinutes} min)` : ''}
            {b.tripStatus === 'CANCELLED' ? ' · trip cancelled' : ''}
          </p>
          <p className="text-sm">
            Ref <strong>{b.reference}</strong> · seats{' '}
            {b.passengers.map((p) => p.seatLabel).join(', ') || '—'} ·{' '}
            {money(b.totalMinor, b.currency)}
          </p>
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
      {children}
    </div>
  );
}

export function MyBookingsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ['passenger-bookings'],
    queryFn: ({ signal }) => api<{ bookings: MyBooking[] }>('/passenger/bookings', { signal }),
  });
  const pay = useMutation({
    mutationFn: (id: string) =>
      api<{ redirectUrl: string }>(`/passenger/bookings/${id}/pay`, { method: 'POST', body: {} }),
    onSuccess: (r) => {
      try {
        goToCheckout(r.redirectUrl);
      } catch (e) {
        toast(errMsg(e), 'error');
      }
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });
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
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">My bookings</h1>
        <Button variant="secondary" onClick={() => nav('/trips')}>
          Find a trip
        </Button>
      </div>
      {q.isPending && <Spinner label="Loading your bookings" />}
      {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      {q.data?.bookings.length === 0 && (
        <Alert tone="info">
          You have no bookings yet.{' '}
          <Link className="underline" to="/trips">
            Search for a trip
          </Link>
          .
        </Alert>
      )}
      {q.data?.bookings.map((b) => (
        <BookingCard key={b.id} b={b}>
          {b.status === 'PENDING_PAYMENT' && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                loading={pay.isPending && pay.variables === b.id}
                loadingText="Opening payment…"
                onClick={() => pay.mutate(b.id)}
              >
                Pay now
              </Button>
              <Button
                variant="ghost"
                loading={cancel.isPending && cancel.variables === b.id}
                onClick={() => {
                  if (window.confirm('Cancel this booking and release the seats?'))
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
  );
}
