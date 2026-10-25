import { AlertTriangle, CheckCircle2, Clock, MinusCircle, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Level 1 surface: white card, hairline border, quiet shadow (flat and bordered in dark mode). */
export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-level1 sm:p-6 dark:border-slate-700 dark:bg-slate-900 dark:shadow-none ${className}`}
    >
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold tracking-tight">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** Statuses are never colour alone: each tone has its own icon as well as its words. */
const badgeTones = {
  green: {
    cls: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
    icon: CheckCircle2,
  },
  amber: {
    cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    icon: Clock,
  },
  red: { cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300', icon: AlertTriangle },
  slate: {
    cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    icon: MinusCircle,
  },
} as const;

export function Badge({
  tone = 'slate',
  children,
  icon,
}: {
  tone?: keyof typeof badgeTones;
  children: ReactNode;
  /** Replace the tone's default icon, or pass `null` for none. */
  icon?: LucideIcon | null;
}) {
  const t = badgeTones[tone];
  const Icon = icon === undefined ? t.icon : icon;
  return (
    <span
      data-badge
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium leading-none ${t.cls}`}
    >
      {Icon && <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.8} />}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, keyof typeof badgeTones> = {
  ACTIVE: 'green',
  PENDING: 'amber',
  INVITED: 'amber',
  SUSPENDED: 'red',
  REJECTED: 'red',
  DEACTIVATED: 'slate',
  REVOKED: 'slate',
};
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'slate'}>
      {label ?? status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  );
}

/** A headline figure on a dashboard: small label, big number, one line of context. */
export function StatTile({
  label,
  value,
  note,
  icon: Icon,
  tone = 'brand',
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  icon?: LucideIcon;
  tone?: 'brand' | 'amber' | 'red' | 'slate';
}) {
  const iconTone = {
    brand: 'bg-brand-50 text-brand-600 dark:bg-slate-800 dark:text-brand-500',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-level1 dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        {Icon && (
          <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${iconTone}`}>
            <Icon aria-hidden="true" className="size-5" strokeWidth={1.8} />
          </span>
        )}
      </div>
      <p className="tabular mt-2 text-2xl font-bold tracking-tight">{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  );
}
