import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bus,
  Radio,
  Ticket,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import { ErrorAlert } from '../../components/ui/Alert';
import { Badge, Card, StatTile } from '../../components/ui/Card';
import { PageLoader } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
import { clockTime, minutesLabel, money } from '../../lib/format';
import { appRoot } from '../../lib/app-path';
import { can, useCompany } from './company-context';

interface Board {
  date: string;
  summary: { total: number; byStatus: Record<string, number>; needingAttention: number };
  trips: {
    id: string;
    route: string;
    departureAt: string;
    status: string;
    delayMinutes: number;
    vehicle: { registration: string; seats: number } | null;
    flags: string[];
  }[];
}
interface Summary {
  revenueMinor: number;
  bookings: number;
  seatsSold: number;
  trips: number;
  occupancyPct: number | null;
  boarded: number;
  cancelledAfterPayment: { count: number; amountMinor: number };
  refundsOwed: { count: number; amountMinor: number };
}

const STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'slate' }> = {
  SCHEDULED: { label: 'Scheduled', tone: 'slate' },
  BOARDING: { label: 'Boarding', tone: 'amber' },
  IN_TRANSIT: { label: 'On the road', tone: 'green' },
  COMPLETED: { label: 'Completed', tone: 'slate' },
  CANCELLED: { label: 'Cancelled', tone: 'red' },
};
const FLAG: Record<string, string> = {
  NO_VEHICLE: 'No vehicle assigned',
  NO_DRIVER: 'No driver assigned',
  DELAYED: 'Delayed',
  VEHICLE_DOCUMENT_EXPIRED: 'Vehicle document expired',
};

const todayIn = (tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

function Shortcut({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return (
    <Link
      to={to}
      className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium hover:border-brand-600 hover:bg-brand-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
    >
      <span className="flex items-center gap-3">
        <Icon aria-hidden="true" className="size-[18px] text-brand-600" strokeWidth={1.8} />
        {label}
      </span>
      <ArrowRight aria-hidden="true" className="size-4 text-slate-400" strokeWidth={1.8} />
    </Link>
  );
}

/** Today at a glance for a company. Each block appears only for people who may see its data. */
export function CompanyPulse({ timezone }: { timezone: string }) {
  const { tenantId, access } = useCompany();
  const base = `/tenants/${tenantId}`;
  const today = todayIn(timezone);
  const seeBoard = can(access, 'trip.read');
  const seeMoney = can(access, 'finance.report.read');
  const board = useQuery({
    queryKey: ['company', tenantId, 'pulse-board', today],
    enabled: seeBoard,
    queryFn: ({ signal }) => api<Board>(`${base}/dispatch/board?date=${today}`, { signal }),
  });
  const summary = useQuery({
    queryKey: ['company', tenantId, 'pulse-summary', today],
    enabled: seeMoney,
    queryFn: ({ signal }) =>
      api<Summary>(`${base}/reports/summary?from=${today}&to=${today}`, { signal }),
  });
  const s = summary.data;
  const b = board.data;
  const attention: { key: string; text: string; to: string }[] = [];
  if (s && s.refundsOwed.count > 0) {
    attention.push({
      key: 'refunds',
      text: `${s.refundsOwed.count} payment${s.refundsOwed.count === 1 ? '' : 's'} (${money(s.refundsOwed.amountMinor, 'SLE')}) arrived after the seats were released and must be refunded.`,
      to: `${appRoot()}/bookings`,
    });
  }
  if (s && s.cancelledAfterPayment.count > 0) {
    attention.push({
      key: 'cancelled',
      text: `${s.cancelledAfterPayment.count} paid booking${s.cancelledAfterPayment.count === 1 ? ' was' : 's were'} cancelled today: check that customers were refunded.`,
      to: `${appRoot()}/bookings`,
    });
  }
  if (b && b.summary.needingAttention > 0) {
    attention.push({
      key: 'trips',
      text: `${b.summary.needingAttention} trip${b.summary.needingAttention === 1 ? ' needs' : 's need'} attention (missing vehicle or driver, delays, expired documents).`,
      to: `${appRoot()}/dispatch`,
    });
  }

  return (
    <div className="space-y-6">
      {(seeMoney || seeBoard) && (
        <section aria-label="Today" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {seeMoney && (
            <>
              <StatTile
                label="Today's sales"
                icon={Wallet}
                value={s ? money(s.revenueMinor, 'SLE') : '…'}
                note={
                  s ? `${s.bookings} booking${s.bookings === 1 ? '' : 's'} paid today` : undefined
                }
              />
              <StatTile
                label="Seats sold"
                icon={Ticket}
                value={s ? s.seatsSold : '…'}
                note={s ? `${s.boarded} boarded` : undefined}
              />
              <StatTile
                label="Occupancy"
                icon={Users}
                value={s ? (s.occupancyPct === null ? '—' : `${s.occupancyPct}%`) : '…'}
                note={s ? `${s.trips} trip${s.trips === 1 ? '' : 's'} today` : undefined}
              />
            </>
          )}
          {seeBoard && (
            <StatTile
              label="Needs attention"
              icon={AlertTriangle}
              tone={attention.length > 0 ? 'amber' : 'slate'}
              value={attention.length}
              note={attention.length === 0 ? 'Nothing waiting' : 'See the list below'}
            />
          )}
        </section>
      )}
      {(board.error || summary.error) && (
        <ErrorAlert
          error={board.error ?? summary.error}
          onRetry={() => {
            void board.refetch();
            void summary.refetch();
          }}
        />
      )}

      {attention.length > 0 && (
        <Card title="Needs attention">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {attention.map((a) => (
              <li key={a.key} className="flex items-start justify-between gap-3 py-3 text-sm">
                <span className="flex gap-3">
                  <AlertTriangle
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-amber-600"
                    strokeWidth={1.8}
                  />
                  {a.text}
                </span>
                <Link
                  className="shrink-0 font-medium text-brand-700 font-medium dark:text-brand-500"
                  to={a.to}
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        {seeBoard && (
          <Card
            title="Today's runs"
            action={
              <Link
                className="text-sm font-medium text-brand-700 font-medium dark:text-brand-500"
                to={`${appRoot()}/dispatch`}
              >
                Dispatch board
              </Link>
            }
          >
            {board.isPending && <PageLoader label="Loading today's runs" />}
            {b && b.trips.length === 0 && (
              <p className="text-sm text-slate-500">No trips are scheduled for today.</p>
            )}
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {b?.trips.map((t) => {
                const st = STATUS[t.status] ?? { label: t.status, tone: 'slate' as const };
                return (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="tabular w-14 shrink-0 text-lg font-bold">
                        {clockTime(t.departureAt, timezone)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{t.route}</p>
                        <p className="truncate text-xs text-slate-500">
                          {t.vehicle
                            ? `${t.vehicle.registration} · ${t.vehicle.seats} seats`
                            : 'No vehicle assigned'}
                          {t.delayMinutes > 0 ? ` · delayed ${minutesLabel(t.delayMinutes)}` : ''}
                        </p>
                        {t.flags.filter((f) => f !== 'DELAYED').length > 0 && (
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            {t.flags
                              .filter((f) => f !== 'DELAYED')
                              .map((f) => FLAG[f] ?? f)
                              .join(' · ')}
                          </p>
                        )}
                      </div>
                    </div>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <Card title="Shortcuts">
          <div className="space-y-2">
            {can(access, 'booking.read') && (
              <Shortcut
                to={`${appRoot()}/bookings`}
                icon={Ticket}
                label="Bookings and counter sales"
              />
            )}
            {can(access, 'trip.read') && (
              <Shortcut to={`${appRoot()}/dispatch`} icon={Radio} label="Dispatch board" />
            )}
            {can(access, 'ticket.validate') && (
              <Shortcut to={`${appRoot()}/boarding`} icon={Bus} label="Boarding" />
            )}
            {can(access, 'finance.report.read') && (
              <Shortcut to={`${appRoot()}/reports`} icon={BarChart3} label="Reports" />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
