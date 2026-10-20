import type { ReactNode } from 'react';

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
      className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 ${className}`}
    >
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const badgeTones = {
  green: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100',
  amber: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
  red: 'bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100',
  slate: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
} as const;

export function Badge({
  tone = 'slate',
  children,
}: {
  tone?: keyof typeof badgeTones;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeTones[tone]}`}
    >
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
export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'slate'}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  );
}
