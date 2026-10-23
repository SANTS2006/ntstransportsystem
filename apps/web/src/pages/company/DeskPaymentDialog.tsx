import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field } from '../../components/ui/Field';
import { api } from '../../lib/api';

export const DESK_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'MOBILE_MONEY', label: 'Mobile money (shown at the counter)' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
] as const;
type Method = (typeof DESK_METHODS)[number]['value'];

export interface DeskPaymentBooking {
  id: string;
  reference: string;
  totalMinor: number;
  currency: string;
}

const money = (minor: number, currency: string) =>
  `${currency} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Confirms that the customer has paid at the counter. The amount is shown, never typed: the server
 * always takes it from the booking.
 */
export function DeskPaymentDialog({
  tenantId,
  booking,
  onClose,
  onPaid,
}: {
  tenantId: string;
  booking: DeskPaymentBooking | null;
  onClose: () => void;
  onPaid: () => void;
}) {
  const [method, setMethod] = useState<Method>('CASH');
  const [reference, setReference] = useState('');
  const pay = useMutation({
    mutationFn: (b: DeskPaymentBooking) =>
      api(`/tenants/${tenantId}/bookings/${b.id}/desk-payment`, {
        method: 'POST',
        body: { method, ...(reference.trim() ? { reference: reference.trim() } : {}) },
      }),
    onSuccess: () => {
      setReference('');
      setMethod('CASH');
      onPaid();
    },
  });
  const close = () => {
    pay.reset();
    onClose();
  };
  return (
    <Dialog open={booking !== null} title="Take payment at the desk" onClose={close}>
      {booking && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            pay.mutate(booking);
          }}
        >
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Booking <strong>{booking.reference}</strong>. Only confirm once you have the money in
            hand: the booking is confirmed and the tickets are issued straight away.
          </p>
          <p className="rounded-lg bg-slate-100 p-3 text-center dark:bg-slate-800">
            <span className="block text-xs text-slate-500">Amount to collect</span>
            <span className="text-2xl font-semibold">
              {money(booking.totalMinor, booking.currency)}
            </span>
          </p>
          <div className="space-y-1">
            <label htmlFor="desk-method" className="block text-sm font-medium">
              How was it paid?
            </label>
            <select
              id="desk-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as Method)}
              className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900"
            >
              {DESK_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <Field
            label="Receipt or transaction number (optional)"
            value={reference}
            maxLength={80}
            onChange={(e) => setReference(e.target.value)}
          />
          {pay.error && <ErrorAlert error={pay.error} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              Not yet
            </Button>
            <Button type="submit" loading={pay.isPending} loadingText="Confirming…">
              Payment received
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** Records that the money for a cancelled, desk-paid booking was handed back (does not move money). */
export function DeskRefundDialog({
  tenantId,
  booking,
  onClose,
  onDone,
}: {
  tenantId: string;
  booking: DeskPaymentBooking | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reference, setReference] = useState('');
  const refund = useMutation({
    mutationFn: (b: DeskPaymentBooking) =>
      api(`/tenants/${tenantId}/bookings/${b.id}/desk-refund`, {
        method: 'POST',
        body: reference.trim() ? { reference: reference.trim() } : {},
      }),
    onSuccess: () => {
      setReference('');
      onDone();
    },
  });
  const close = () => {
    refund.reset();
    onClose();
  };
  return (
    <Dialog open={booking !== null} title="Record a refund" onClose={close}>
      {booking && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            refund.mutate(booking);
          }}
        >
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Booking <strong>{booking.reference}</strong> was paid at the desk and then cancelled.
            Hand the whole amount back to the customer first; this only records that you did. It
            cannot be undone.
          </p>
          <p className="rounded-lg bg-slate-100 p-3 text-center dark:bg-slate-800">
            <span className="block text-xs text-slate-500">Amount handed back</span>
            <span className="text-2xl font-semibold">
              {money(booking.totalMinor, booking.currency)}
            </span>
          </p>
          <Field
            label="Receipt or transaction number (optional)"
            value={reference}
            maxLength={80}
            onChange={(e) => setReference(e.target.value)}
          />
          {refund.error && <ErrorAlert error={refund.error} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              Not yet
            </Button>
            <Button type="submit" loading={refund.isPending} loadingText="Recording…">
              Money handed back
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
