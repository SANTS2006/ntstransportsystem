import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';
import { api } from '../../lib/api';

interface Ticket {
  id: string;
  seat: string;
  passengerName: string;
  code: string;
  status: 'ISSUED' | 'BOARDED' | 'VOID';
  token: string;
}
interface BookingSummary {
  reference: string;
  status: string;
  company: string;
  timezone: string;
  origin: { city: string };
  destination: { city: string };
  departureAt: string;
  tripStatus: string;
}

/** Renders the signed token as an SVG QR code in the browser; the token never leaves the page. */
function Qr({ value, label }: { value: string; label: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((s) => {
      if (live) setSvg(s);
    });
    return () => {
      live = false;
    };
  }, [value]);
  if (!svg) return <div className="size-44 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />;
  return (
    <div
      role="img"
      aria-label={label}
      // Always shown on white with a quiet zone, whatever the theme, so scanners can read it.
      className="size-44 rounded bg-white p-1 [&>svg]:size-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

const when = (iso: string, tz: string) =>
  new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(iso));

export function MyTicketsPage() {
  const { id } = useParams();
  const booking = useQuery({
    queryKey: ['passenger-booking', id],
    queryFn: ({ signal }) => api<BookingSummary>(`/passenger/bookings/${id}`, { signal }),
  });
  const tickets = useQuery({
    queryKey: ['passenger-tickets', id],
    queryFn: ({ signal }) =>
      api<{ tickets: Ticket[] }>(`/passenger/bookings/${id}/tickets`, { signal }),
  });
  if (booking.isPending || tickets.isPending) return <Spinner label="Loading your tickets" />;
  if (booking.error)
    return <ErrorAlert error={booking.error} onRetry={() => void booking.refetch()} />;
  if (tickets.error)
    return <ErrorAlert error={tickets.error} onRetry={() => void tickets.refetch()} />;
  const b = booking.data;
  const list = tickets.data.tickets;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link className="text-sm text-brand-700 underline dark:text-brand-500" to="/app/bookings">
        My bookings
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">
          {b.origin.city} → {b.destination.city}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {b.company} · {when(b.departureAt, b.timezone)} · Ref {b.reference}
        </p>
      </div>
      {list.length === 0 ? (
        <Alert tone="info">
          Tickets appear here once the booking is paid and confirmed (current status:{' '}
          {b.status.toLowerCase().replace('_', ' ')}).
        </Alert>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 text-sm">
            <a
              className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-4 font-medium text-white hover:bg-brand-600"
              href={`/api/v1/passenger/bookings/${id}/tickets.pdf`}
            >
              Download tickets (PDF)
            </a>
            <a
              className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
              href={`/api/v1/passenger/bookings/${id}/receipt.pdf`}
            >
              Receipt (PDF)
            </a>
          </div>
          <ul className="space-y-4">
            {list.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
              >
                <Qr value={t.token} label={`QR code for seat ${t.seat}`} />
                <div className="space-y-1">
                  <p className="text-lg font-semibold">Seat {t.seat}</p>
                  <p>{t.passengerName}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Code <span className="font-mono">{t.code}</span>
                  </p>
                  <p className="text-sm">
                    {t.status === 'BOARDED'
                      ? 'Boarded'
                      : t.status === 'VOID' || b.tripStatus === 'CANCELLED'
                        ? 'Cancelled'
                        : b.tripStatus === 'COMPLETED'
                          ? 'Trip finished: not used'
                          : 'Ready to use'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">
            Show the QR code to the driver when boarding. If it will not scan, read out the code.
            Each ticket works once.
          </p>
        </>
      )}
    </div>
  );
}
