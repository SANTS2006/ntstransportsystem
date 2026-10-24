import { ExternalLink, Pencil } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/Card';

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
  defaultCurrency: string;
  createdAt: string;
  primaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  admins: { name: string; email: string | null }[];
}
export type Action = 'approve' | 'reject' | 'suspend' | 'reactivate' | 'deactivate';

export const ACTIONS_BY_STATUS: Record<string, Action[]> = {
  PENDING: ['approve', 'reject'],
  ACTIVE: ['suspend', 'deactivate'],
  SUSPENDED: ['reactivate', 'deactivate'],
};

const label = (a: Action) => a.charAt(0).toUpperCase() + a.slice(1);

function Logo({ t }: { t: TenantRow }) {
  return t.logoUrl ? (
    <img
      src={t.logoUrl}
      alt=""
      className="size-11 shrink-0 rounded-lg border border-slate-200 bg-white object-contain p-0.5 dark:border-slate-700"
    />
  ) : (
    <span
      aria-hidden="true"
      className="grid size-11 shrink-0 place-items-center rounded-lg text-base font-bold text-white"
      style={{ background: t.primaryColor ?? '#0075df' }}
    >
      {t.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** The two web pages a company has: where its staff and customers sign in and sign up. */
function PageLinks({ slug }: { slug: string }) {
  const link =
    'inline-flex items-center gap-1 font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-500';
  return (
    <div className="flex flex-col gap-1 text-sm">
      <a className={link} href={`/${slug}/login`} target="_blank" rel="noreferrer">
        Sign-in page
        <ExternalLink aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
      </a>
      <a className={link} href={`/${slug}/register`} target="_blank" rel="noreferrer">
        Sign-up page
        <ExternalLink aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
      </a>
    </div>
  );
}

function Admins({ t }: { t: TenantRow }) {
  if (t.admins.length === 0) return <span className="text-slate-500">None yet</span>;
  return (
    <div className="space-y-0.5">
      {t.admins.map((a) => (
        <p key={a.email ?? a.name} className="min-w-0">
          <span className="block truncate font-medium">{a.name}</span>
          <span className="block truncate text-xs text-slate-500">{a.email}</span>
        </p>
      ))}
    </div>
  );
}

function Actions({
  t,
  onEdit,
  onAction,
}: {
  t: TenantRow;
  onEdit: (t: TenantRow) => void;
  onAction: (t: TenantRow, a: Action) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" className="!min-h-9 !px-3 !text-sm" onClick={() => onEdit(t)}>
        <Pencil aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
        Edit
      </Button>
      {(ACTIONS_BY_STATUS[t.status] ?? []).map((a) => (
        <Button
          key={a}
          variant={a === 'approve' || a === 'reactivate' ? 'primary' : 'dangerQuiet'}
          className="!min-h-9 !px-3 !text-sm"
          onClick={() => onAction(t, a)}
        >
          {label(a)}
        </Button>
      ))}
    </div>
  );
}

/** Companies as a table on wide screens and as cards on narrow ones. */
export function CompaniesTable({
  rows,
  onEdit,
  onAction,
}: {
  rows: TenantRow[];
  onEdit: (t: TenantRow) => void;
  onAction: (t: TenantRow, a: Action) => void;
}) {
  const date = (iso: string) => new Date(iso).toLocaleDateString();
  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-level1 md:block dark:border-slate-700 dark:bg-slate-900">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <tr>
              <th scope="col" className="px-4 py-3">
                Company
              </th>
              <th scope="col" className="px-4 py-3">
                Administrator
              </th>
              <th scope="col" className="px-4 py-3">
                Status
              </th>
              <th scope="col" className="px-4 py-3">
                Company pages
              </th>
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((t) => (
              <tr key={t.id} className="align-top hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Logo t={t} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{t.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        /{t.slug} · since {date(t.createdAt)}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="max-w-56 px-4 py-3">
                  <Admins t={t} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={t.status} />
                  <p className="mt-1 text-xs text-slate-500">
                    {t.defaultCurrency} · {t.timezone}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <PageLinks slug={t.slug} />
                </td>
                <td className="px-4 py-3">
                  <Actions t={t} onEdit={onEdit} onAction={onAction} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden">
        {rows.map((t) => (
          <li
            key={t.id}
            className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-level1 dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Logo t={t} />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{t.name}</p>
                  <p className="truncate text-xs text-slate-500">/{t.slug}</p>
                </div>
              </div>
              <StatusBadge status={t.status} />
            </div>
            <div className="text-sm">
              <p className="text-xs text-slate-500">Administrator</p>
              <Admins t={t} />
            </div>
            <PageLinks slug={t.slug} />
            <Actions t={t} onEdit={onEdit} onAction={onAction} />
          </li>
        ))}
      </ul>
    </>
  );
}
