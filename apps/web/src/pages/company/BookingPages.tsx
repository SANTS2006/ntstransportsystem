import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, StatusBadge } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { can, useCompany } from './company-context';
import { DeskPaymentDialog, DeskRefundDialog, type DeskPaymentBooking } from './DeskPaymentDialog';

const MAX_SEATS = 8;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const money = (minor: number, currency: string) =>
  `${currency} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

interface TripRow {
  id: string;
  route: string;
  departureAt: string;
  status: string;
  vehicleId: string | null;
}
interface SeatMap {
  sellable: boolean;
  seats: { label: string; accessible: boolean; status: 'AVAILABLE' | 'TAKEN' }[];
}
interface BookingRow {
  id: string;
  reference: string;
  tripId: string;
  status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';
  contactName: string;
  contactPhone: string;
  totalMinor: number;
  currency: string;
  holdExpiresAt: string | null;
  passengers: { seatLabel: string; fullName: string }[];
  desk: { method: string | null; amountMinor: number; refundedAt: string | null } | null;
  claim?: { method: string; reference: string; createdAt: string } | null;
}

const STATUS_LABEL: Record<BookingRow['status'], string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

export function BookingsPage() {
  const { tenantId, access } = useCompany();
  const toast = useToast();
  const qc = useQueryClient();
  const manage = can(access, 'booking.manage');
  const collect = can(access, 'payment.collect');
  const [desk, setDesk] = useState<DeskPaymentBooking | null>(null);
  const [refund, setRefund] = useState<DeskPaymentBooking | null>(null);
  const refundRights = can(access, 'payment.manage');
  const refresh = () => qc.invalidateQueries({ queryKey: ['company', tenantId] });

  const profile = useQuery({
    queryKey: ['company', tenantId, 'profile'],
    queryFn: ({ signal }) => api<{ timezone: string }>(`/tenants/${tenantId}/profile`, { signal }),
  });
  const tz = profile.data?.timezone ?? 'UTC';
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));

  const trips = useQuery({
    queryKey: ['company', tenantId, 'sellable-trips'],
    enabled: can(access, 'trip.read'),
    queryFn: ({ signal }) =>
      api<{ trips: TripRow[] }>(
        `/tenants/${tenantId}/trips?from=${today()}&to=${plusDays(30)}&limit=100`,
        { signal },
      ),
  });
  const sellable = (trips.data?.trips ?? []).filter(
    (t) =>
      ['SCHEDULED', 'BOARDING'].includes(t.status) &&
      t.vehicleId &&
      new Date(t.departureAt) > new Date(),
  );

  const [tripId, setTripId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [contact, setContact] = useState({ name: '', phone: '', email: '' });
  const [formError, setFormError] = useState<string | null>(null);
  // One key per attempt: a retry after a timeout returns the same booking instead of a second one.
  const attemptKey = useRef<string>(crypto.randomUUID());

  const seatMap = useQuery({
    queryKey: ['company', tenantId, 'seat-map', tripId],
    enabled: tripId !== '' && can(access, 'booking.read'),
    queryFn: ({ signal }) => api<SeatMap>(`/tenants/${tenantId}/trips/${tripId}/seats`, { signal }),
  });

  const create = useMutation({
    mutationFn: () =>
      api<BookingRow>(`/tenants/${tenantId}/bookings`, {
        method: 'POST',
        headers: { 'idempotency-key': attemptKey.current },
        body: {
          tripId,
          contact: {
            name: contact.name.trim(),
            phone: contact.phone.trim(),
            ...(contact.email.trim() ? { email: contact.email.trim() } : {}),
          },
          passengers: picked.map((s) => ({
            seatLabel: s,
            fullName: (names[s] ?? '').trim() || contact.name.trim(),
          })),
        },
      }),
    onSuccess: async (b) => {
      toast(`Booking ${b.reference} created. Seats are held until it is paid.`, 'success');
      attemptKey.current = crypto.randomUUID();
      setPicked([]);
      setNames({});
      await refresh();
    },
    onError: async (e) => {
      setFormError(errMsg(e));
      await seatMap.refetch(); // a 409 usually means a seat was just taken
      setPicked([]);
      attemptKey.current = crypto.randomUUID();
    },
  });

  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: ['company', tenantId, 'bookings', statusFilter, q],
    enabled: can(access, 'booking.read'),
    queryFn: ({ signal }) =>
      api<{ bookings: BookingRow[] }>(
        `/tenants/${tenantId}/bookings?limit=50${statusFilter ? `&status=${statusFilter}` : ''}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`,
        { signal },
      ),
  });
  const cancel = useMutation({
    mutationFn: (id: string) =>
      api<{ refundRequired: boolean }>(`/tenants/${tenantId}/bookings/${id}/cancel`, {
        method: 'POST',
        body: { reason: 'Cancelled by staff' },
      }),
    onSuccess: async (r) => {
      toast(
        r.refundRequired
          ? 'Booking cancelled. A refund is due to the customer.'
          : 'Booking cancelled',
        r.refundRequired ? 'info' : 'success',
      );
      await refresh();
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });

  const toggle = (label: string) => {
    setFormError(null);
    setPicked((cur) =>
      cur.includes(label)
        ? cur.filter((x) => x !== label)
        : cur.length >= MAX_SEATS
          ? cur
          : [...cur, label],
    );
  };
  const valid =
    picked.length > 0 && contact.name.trim().length >= 2 && contact.phone.trim().length >= 6;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold">Bookings</h1>
      <p className="text-xs text-slate-500">Times shown in {tz}.</p>

      {manage && (
        <Card title="New booking">
          <div className="mt-3 space-y-4">
            <div>
              <label htmlFor="bk-trip" className="mb-1 block text-sm font-medium">
                Trip
              </label>
              <select
                id="bk-trip"
                className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                value={tripId}
                onChange={(e) => {
                  setTripId(e.target.value);
                  setPicked([]);
                  setFormError(null);
                }}
              >
                <option value="">Choose a trip…</option>
                {sellable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.route} · {fmt(t.departureAt)}
                  </option>
                ))}
              </select>
              {trips.data && sellable.length === 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  No upcoming trips with a vehicle assigned. Assign vehicles on the Trips page.
                </p>
              )}
            </div>

            {tripId && seatMap.isPending && <Spinner label="Loading seats" />}
            {seatMap.error && (
              <ErrorAlert error={seatMap.error} onRetry={() => void seatMap.refetch()} />
            )}
            {seatMap.data && (
              <fieldset>
                <legend className="mb-1 text-sm font-medium">
                  Seats (choose up to {MAX_SEATS}) — {picked.length} selected
                </legend>
                <div className="flex flex-wrap gap-2">
                  {seatMap.data.seats.map((s) => {
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
                            ? 'border-blue-700 bg-blue-700 text-white'
                            : s.accessible
                              ? 'border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-200'
                              : 'border-slate-300 dark:border-slate-600'
                        }`}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}

            {picked.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
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
                <Field
                  label="Contact email (optional)"
                  type="email"
                  value={contact.email}
                  onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))}
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
            )}
            {formError && <Alert tone="error">{formError}</Alert>}
            <Button
              disabled={!valid}
              loading={create.isPending}
              loadingText="Holding seats…"
              onClick={() => {
                setFormError(null);
                create.mutate();
              }}
            >
              Hold seats and create booking
            </Button>
          </div>
        </Card>
      )}

      <Card title="Bookings">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field label="Reference or phone" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div>
            <label htmlFor="bk-status" className="mb-1 block text-sm font-medium">
              Status
            </label>
            <select
              id="bk-status"
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
        {list.isPending && <Spinner label="Loading bookings" />}
        {list.error && <ErrorAlert error={list.error} onRetry={() => void list.refetch()} />}
        <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
          {list.data?.bookings.length === 0 && (
            <li className="py-2 text-slate-500">No bookings.</li>
          )}
          {list.data?.bookings.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">
                  {b.reference} · {b.contactName}
                </p>
                <p className="text-xs text-slate-500">
                  Seats {b.passengers.map((p) => p.seatLabel).join(', ')} ·{' '}
                  {money(b.totalMinor, b.currency)} · {b.contactPhone}
                  {b.status === 'PENDING_PAYMENT' && b.holdExpiresAt
                    ? ` · held until ${fmt(b.holdExpiresAt)}`
                    : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
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
                {b.status === 'CONFIRMED' && (
                  <>
                    <a
                      className="text-sm text-brand-700 underline dark:text-brand-500"
                      href={`/api/v1/tenants/${tenantId}/bookings/${b.id}/tickets.pdf`}
                    >
                      Tickets
                    </a>
                    <a
                      className="text-sm text-brand-700 underline dark:text-brand-500"
                      href={`/api/v1/tenants/${tenantId}/bookings/${b.id}/receipt.pdf`}
                    >
                      Receipt
                    </a>
                  </>
                )}
                {b.status === 'CANCELLED' && b.desk && (
                  <>
                    {b.desk.refundedAt ? (
                      <span className="text-xs text-slate-500">Refunded</span>
                    ) : (
                      <>
                        <StatusBadge status="PENDING" label="Refund due" />
                        {refundRights && (
                          <Button
                            variant="secondary"
                            onClick={() =>
                              setRefund({
                                id: b.id,
                                reference: b.reference,
                                totalMinor: b.desk?.amountMinor ?? b.totalMinor,
                                currency: b.currency,
                              })
                            }
                          >
                            Record refund
                          </Button>
                        )}
                      </>
                    )}
                  </>
                )}
                {b.status === 'PENDING_PAYMENT' && b.claim && (
                  <StatusBadge status="PENDING" label={`QMoney paid? ${b.claim.reference}`} />
                )}
                {collect && b.status === 'PENDING_PAYMENT' && (
                  <Button
                    onClick={() =>
                      setDesk({
                        id: b.id,
                        reference: b.reference,
                        totalMinor: b.totalMinor,
                        currency: b.currency,
                        claim: b.claim ?? null,
                      })
                    }
                  >
                    Take payment
                  </Button>
                )}
                {manage && (b.status === 'PENDING_PAYMENT' || b.status === 'CONFIRMED') && (
                  <Button
                    variant="dangerQuiet"
                    loading={cancel.isPending && cancel.variables === b.id}
                    onClick={() => {
                      if (window.confirm(`Cancel booking ${b.reference}?`)) cancel.mutate(b.id);
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <DeskRefundDialog
        tenantId={tenantId}
        booking={refund}
        onClose={() => setRefund(null)}
        onDone={() => {
          setRefund(null);
          toast('Refund recorded.', 'success');
          void refresh();
        }}
      />
      <DeskPaymentDialog
        key={desk?.id ?? 'none'}
        tenantId={tenantId}
        booking={desk}
        onClose={() => setDesk(null)}
        onPaid={() => {
          setDesk(null);
          toast('Payment recorded. The booking is confirmed and the tickets are ready.', 'success');
          void refresh();
        }}
      />
    </div>
  );
}
