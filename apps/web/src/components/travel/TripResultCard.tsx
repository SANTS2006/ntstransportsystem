import { AlertTriangle, ArrowRight, Bus, Clock } from 'lucide-react';
import { useCompanyPublic } from '../../lib/company-public';
import { Link } from 'react-router';
import { clockTime, duration, initials, money, moneyParts } from '../../lib/format';
import { Badge } from '../ui/Card';
import { linkButton } from '../ui/Button';

export interface TripCardData {
  tripId: string;
  tenantId: string;
  company: string;
  timezone: string;
  route: string;
  origin: { name: string; city: string };
  destination: { name: string; city: string };
  departureAt: string;
  arrivalAt: string;
  delayMinutes: number;
  fareMinor: number;
  currency: string;
  seatsLeft: number;
}

/** How many seats left counts as "running out". */
export const FEW_SEATS = 5;

/** One departure: who runs it, when, where from and to, how many seats are left, and the price. */
export function TripResultCard({ t }: { t: TripCardData }) {
  const company = useCompanyPublic();
  const price = moneyParts(t.fareMinor, t.currency);
  const soldOut = t.seatsLeft <= 0;
  const few = !soldOut && t.seatsLeft <= FEW_SEATS;
  return (
    <li
      className={`rounded-xl border bg-white p-4 shadow-level1 sm:p-5 dark:bg-slate-900 dark:shadow-none ${
        few
          ? 'border-t-2 border-slate-200 border-t-accent-500 dark:border-slate-700'
          : 'border-slate-200 dark:border-slate-700'
      }`}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-sm font-bold text-brand-700 dark:bg-slate-800 dark:text-brand-500"
            >
              {initials(t.company)}
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold">{t.company}</p>
              <p className="truncate text-xs text-slate-500">{t.route}</p>
            </div>
            {t.delayMinutes > 0 && (
              <Badge tone="amber" icon={Clock}>
                Delayed {t.delayMinutes} min
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
            <div>
              <p className="tabular text-2xl font-bold leading-none">
                {clockTime(t.departureAt, t.timezone)}
              </p>
              <p className="mt-1 text-sm font-medium">{t.origin.city}</p>
              <p className="text-xs text-slate-500">{t.origin.name}</p>
            </div>
            <div className="flex flex-col items-center gap-1 text-xs text-slate-500">
              <span>{duration(t.departureAt, t.arrivalAt)}</span>
              <span className="flex w-full items-center gap-1" aria-hidden="true">
                <span className="size-2 rounded-full bg-brand-600" />
                <span className="h-px flex-1 bg-slate-300 dark:bg-slate-600" />
                <Bus className="size-4 text-slate-400" strokeWidth={1.8} />
                <span className="h-px flex-1 bg-slate-300 dark:bg-slate-600" />
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
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4 md:w-52 md:flex-col md:items-end md:border-l md:border-t-0 md:pl-5 md:pt-0 dark:border-slate-800">
          <div className="text-left md:text-right">
            <p className="text-xs text-slate-500">Per seat</p>
            <p className="tabular text-2xl font-bold tracking-tight text-brand-700 dark:text-brand-500">
              <span className="text-sm font-semibold">{price.currency}</span> {price.whole}
              <span className="text-sm">.{price.cents}</span>
            </p>
            <p className="sr-only">{money(t.fareMinor, t.currency)} per seat</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {soldOut ? (
              <Badge tone="slate">Sold out</Badge>
            ) : few ? (
              <Badge tone="amber" icon={AlertTriangle}>
                Only {t.seatsLeft} left
              </Badge>
            ) : (
              <Badge tone="green" icon={null}>
                {t.seatsLeft} seats left
              </Badge>
            )}
            {!soldOut && (
              <Link
                to={company ? `/${company.slug}/trips/${t.tripId}` : '/'}
                className={linkButton('primary')}
              >
                Choose seats
                <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
              </Link>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
