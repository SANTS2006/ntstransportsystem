import { formatPhone } from '@nts/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { PageLoader } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
import { appRoot } from '../../lib/app-path';

export type PayMethod = 'ORANGE_MONEY' | 'AFRIMONEY' | 'QMONEY' | 'ONLINE';

export interface PayOption {
  method: PayMethod;
  label: string;
  kind: 'ONLINE' | 'MANUAL';
  manual?: { number: string; accountName: string | null };
}
interface BookingInfo {
  id: string;
  reference: string;
  status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';
  company: string;
  totalMinor: number;
  currency: string;
  holdExpiresAt: string | null;
  claim: { method: string; reference: string; createdAt: string } | null;
}

const money = (minor: number, currency: string) =>
  `${currency} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clock = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(iso));

/** Only https addresses are ever followed to a payment page. */
function goToCheckout(url: string) {
  if (!url.startsWith('https://')) throw new Error('The payment page address was not valid.');
  window.location.assign(url);
}

/** A transaction number as QMoney shows it: letters and digits, a few separators. */
export const looksLikeTransactionNumber = (v: string) =>
  /^[A-Za-z0-9][A-Za-z0-9 ._-]{3,39}$/.test(v.trim());

/** Step two of booking: choose how to pay. */
export function PayMethodPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [chosen, setChosen] = useState<PayMethod | null>(null);
  const [reference, setReference] = useState('');
  const [payProblem, setPayProblem] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['pay-options', id],
    queryFn: ({ signal }) =>
      api<{ booking: BookingInfo; options: PayOption[] }>(
        `/passenger/bookings/${id}/payment-options`,
        { signal },
      ),
    retry: false,
  });
  const pay = useMutation({
    mutationFn: (method: PayMethod) =>
      api<{ redirectUrl: string }>(`/passenger/bookings/${id}/pay`, {
        method: 'POST',
        body: { method },
      }),
    onSuccess: (r) => {
      try {
        goToCheckout(r.redirectUrl);
      } catch (e) {
        setPayProblem(e instanceof Error ? e.message : 'Could not open the payment page.');
      }
    },
    onMutate: () => setPayProblem(null),
  });
  const claim = useMutation({
    mutationFn: () =>
      api(`/passenger/bookings/${id}/manual-payment`, {
        method: 'POST',
        body: { method: 'QMONEY', reference: reference.trim() },
      }),
    onSuccess: async () => {
      setReference('');
      await qc.invalidateQueries({ queryKey: ['pay-options', id] });
    },
  });

  if (q.isPending) return <PageLoader label="Loading payment options" />;
  if (q.error || !q.data) {
    return (
      <div className="w-full space-y-4">
        <Alert tone="error">We could not find that booking.</Alert>
        <Link className="text-brand-700 font-medium" to={`${appRoot()}/bookings`}>
          My bookings
        </Link>
      </div>
    );
  }
  const { booking, options } = q.data;
  const selected = options.find((o) => o.method === chosen) ?? null;

  if (booking.status !== 'PENDING_PAYMENT') {
    return (
      <div className="w-full space-y-4">
        <Alert tone={booking.status === 'CONFIRMED' ? 'success' : 'info'}>
          {booking.status === 'CONFIRMED'
            ? 'This booking is paid and confirmed.'
            : 'This booking is no longer waiting for payment.'}
        </Alert>
        <Link
          className="text-brand-700 font-medium"
          to={
            booking.status === 'CONFIRMED'
              ? `${appRoot()}/bookings/${booking.id}`
              : `${appRoot()}/bookings`
          }
        >
          {booking.status === 'CONFIRMED' ? 'View my tickets' : 'My bookings'}
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">How would you like to pay?</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {booking.company} · booking <strong>{booking.reference}</strong>
          {booking.holdExpiresAt && <> · seats held until {clock(booking.holdExpiresAt)}</>}
        </p>
      </div>
      <p className="rounded-lg bg-slate-100 p-3 text-center dark:bg-slate-800">
        <span className="block text-xs text-slate-500">Total to pay</span>
        <span className="text-2xl font-semibold">
          {money(booking.totalMinor, booking.currency)}
        </span>
      </p>

      {options.length === 0 && (
        <Alert tone="error">
          This company has not set up a way to pay yet. Please contact them, or choose another trip.
        </Alert>
      )}

      {booking.claim && (
        <Alert tone="info">
          You told us you paid by QMoney (transaction {booking.claim.reference}). The company will
          confirm it once they see the payment. Your seats stay held
          {booking.holdExpiresAt ? ` until ${clock(booking.holdExpiresAt)}` : ' meanwhile'}.
        </Alert>
      )}

      <fieldset className="space-y-2">
        <legend className="sr-only">Payment method</legend>
        {options.map((o) => (
          <label
            key={`${o.method}:${o.kind}`}
            className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 ${
              chosen === o.method
                ? 'border-brand-600 bg-brand-50 dark:bg-slate-800'
                : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            <input
              type="radio"
              name="method"
              value={o.method}
              checked={chosen === o.method}
              onChange={() => setChosen(o.method)}
              className="size-4 accent-teal-700"
            />
            <span className="min-w-0">
              <span className="block font-medium">{o.label}</span>
              <span className="block text-xs text-slate-500">
                {o.kind === 'MANUAL'
                  ? "Pay the company's QMoney number, then tell us the transaction number"
                  : o.method === 'ONLINE'
                    ? 'You choose your mobile money on the next page'
                    : 'You will be taken to a secure page to approve the payment'}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {selected?.kind === 'ONLINE' && (
        <>
          {pay.error && <ErrorAlert error={pay.error} />}
          {payProblem && <Alert tone="error">{payProblem}</Alert>}
          <Button
            className="w-full"
            loading={pay.isPending}
            loadingText="Opening payment…"
            onClick={() => pay.mutate(selected.method)}
          >
            {selected.method === 'ONLINE' ? 'Continue to payment' : `Pay with ${selected.label}`}
          </Button>
        </>
      )}

      {selected?.kind === 'MANUAL' && selected.manual && (
        <Card title="Pay with QMoney">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              In your QMoney app or on your phone, send{' '}
              <strong>{money(booking.totalMinor, booking.currency)}</strong> to{' '}
              <strong>{formatPhone(selected.manual.number)}</strong>
              {selected.manual.accountName && <> ({selected.manual.accountName})</>}.
            </li>
            <li>
              Use <strong>{booking.reference}</strong> as the reference or note, if QMoney asks for
              one.
            </li>
            <li>When QMoney confirms, type the transaction number it gives you below.</li>
          </ol>
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (looksLikeTransactionNumber(reference) && !claim.isPending) claim.mutate();
            }}
          >
            <Field
              label="QMoney transaction number"
              value={reference}
              maxLength={40}
              autoComplete="off"
              hint="Your ticket is issued once the company has seen the payment."
              onChange={(e) => setReference(e.target.value)}
            />
            {claim.error && <ErrorAlert error={claim.error} />}
            <Button
              type="submit"
              className="w-full"
              disabled={!looksLikeTransactionNumber(reference)}
              loading={claim.isPending}
              loadingText="Sending…"
            >
              I have paid
            </Button>
          </form>
        </Card>
      )}

      <Link
        className="inline-block text-sm text-brand-700 font-medium"
        to={`${appRoot()}/bookings`}
      >
        Pay later from My bookings
      </Link>
    </div>
  );
}
