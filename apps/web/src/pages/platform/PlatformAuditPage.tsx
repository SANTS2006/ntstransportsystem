import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ScrollText } from 'lucide-react';
import { ListTools } from '../../components/ui/ListTools';
import { useState } from 'react';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { PageLoader } from '../../components/ui/Spinner';
import { ApiError, api } from '../../lib/api';

const PAGE = 25;

interface AuditEvent {
  id: string;
  at: string;
  action: string;
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
  actor: { id: string; name: string; contact: string | null } | null;
  tenant: { id: string; name: string | null } | null;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  summary: Record<string, string | number | boolean | null> | null;
}

const TONE = { SUCCESS: 'green', FAILURE: 'red', DENIED: 'amber' } as const;

/** "platform.tenant_created" reads as "Platform: tenant created". */
const actionLabel = (a: string) => {
  const [head, ...rest] = a.split('.');
  const text = rest.join(' ').replace(/_/g, ' ');
  return rest.length ? `${head ?? ''}: ${text}` : a.replace(/_/g, ' ');
};

/** Everything audited across the platform, for security-audit staff and super admins. */
export function PlatformAuditPage() {
  const [action, setAction] = useState('');
  const [outcome, setOutcome] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) });
  if (action.trim()) params.set('action', action.trim());
  if (outcome) params.set('outcome', outcome);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const q = useQuery({
    queryKey: ['platform', 'audit', params.toString()],
    queryFn: ({ signal }) =>
      api<{ total: number; events: AuditEvent[] }>(`/platform/audit?${params}`, { signal }),
    retry: false,
  });
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(0);
    };
  const forbidden = q.error instanceof ApiError && q.error.status === 403;
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="w-full space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-600">
          Platform administration
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Every recorded action across all companies, newest first. Entries cannot be changed or
          removed.
        </p>
      </div>

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-level1 sm:grid-cols-2 lg:grid-cols-4 dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
        <Field
          label="Action contains"
          placeholder="e.g. login, tenant_"
          value={action}
          onChange={(e) => reset(setAction)(e.target.value)}
        />
        <div className="space-y-1">
          <label htmlFor="audit-outcome" className="block text-sm font-medium">
            Outcome
          </label>
          <select
            id="audit-outcome"
            value={outcome}
            onChange={(e) => reset(setOutcome)(e.target.value)}
            className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-[15px] dark:border-slate-600 dark:bg-slate-900"
          >
            <option value="">Any</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILURE">Failure</option>
            <option value="DENIED">Denied</option>
          </select>
        </div>
        <Field
          label="From"
          type="date"
          value={from}
          onChange={(e) => reset(setFrom)(e.target.value)}
        />
        <Field label="To" type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} />
      </div>

      {forbidden && (
        <Alert tone="warning">
          Only super admins and security-audit staff can read the audit log, and two-step
          verification must be on for your account.
        </Alert>
      )}
      {q.isPending && <PageLoader label="Loading audit log" />}
      {q.error && !forbidden && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && q.data.events.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          No events match these filters.
        </p>
      )}
      <ListTools title="Audit log">
        <ul className="space-y-3">
          {q.data?.events.map((e) => (
            <li
              key={e.id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-level1 dark:border-slate-700 dark:bg-slate-900 dark:shadow-none"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-slate-800 dark:text-brand-500"
                  >
                    <ScrollText className="size-5" strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold capitalize">{actionLabel(e.action)}</p>
                    <p className="text-xs text-slate-500">{new Date(e.at).toLocaleString()}</p>
                  </div>
                </div>
                <Badge tone={TONE[e.outcome]}>{e.outcome.toLowerCase()}</Badge>
              </div>
              <dl className="mt-3 grid gap-x-6 gap-y-2 border-t border-slate-100 pt-3 text-sm sm:grid-cols-3 dark:border-slate-800">
                <div>
                  <dt className="text-xs text-slate-500">Who</dt>
                  <dd className="truncate">
                    {e.actor
                      ? `${e.actor.name}${e.actor.contact ? ` (${e.actor.contact})` : ''}`
                      : 'System / not signed in'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Company</dt>
                  <dd className="truncate">
                    {e.tenant ? (e.tenant.name ?? e.tenant.id) : 'Platform'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Target</dt>
                  <dd className="truncate font-mono text-xs">
                    {e.targetType ? `${e.targetType} ${e.targetId ?? ''}` : '—'}
                  </dd>
                </div>
              </dl>
              {e.summary && Object.keys(e.summary).length > 0 && (
                <p className="mt-2 break-words text-xs text-slate-600 dark:text-slate-400">
                  {Object.entries(e.summary)
                    .map(([k, v]) => `${k}: ${String(v)}`)
                    .join(' · ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      </ListTools>

      {q.data && total > PAGE && (
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft aria-hidden="true" className="size-4" strokeWidth={1.8} />
            Newer
          </Button>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Page {page + 1} of {pages} · {total} events
          </p>
          <Button
            variant="secondary"
            disabled={page + 1 >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Older
            <ChevronRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
          </Button>
        </div>
      )}
    </div>
  );
}
