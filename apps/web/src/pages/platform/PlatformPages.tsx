import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Outlet } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { DashboardShell } from '../../components/layout/Layouts';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, StatusBadge } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { ApiError, api } from '../../lib/api';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
  createdAt: string;
}
type Action = 'approve' | 'reject' | 'suspend' | 'reactivate' | 'deactivate';
const NEEDS_REASON: Action[] = ['reject', 'suspend', 'deactivate'];

const ACTIONS_BY_STATUS: Record<string, Action[]> = {
  PENDING: ['approve', 'reject'],
  ACTIVE: ['suspend', 'deactivate'],
  SUSPENDED: ['reactivate', 'deactivate'],
};
const STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'DEACTIVATED'];

/** Visible only to people with a platform role; the API independently requires role + MFA. */
export function PlatformLayout() {
  const { user } = useAuth();
  if (!user || user.platformRoles.length === 0) {
    return (
      <div className="mx-auto max-w-md p-8">
        <Alert tone="error">Page not found.</Alert>
        <Link className="mt-4 inline-block text-sm underline" to="/app">
          Back to dashboard
        </Link>
      </div>
    );
  }
  return (
    <DashboardShell
      heading="Platform administration"
      nav={[
        { to: '/platform', label: 'Companies', end: true },
        { to: '/app', label: '← Exit admin' },
      ]}
    >
      <Outlet />
    </DashboardShell>
  );
}

export function PlatformTenantsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState('PENDING');
  const [pending, setPending] = useState<{ tenant: TenantRow; action: Action } | null>(null);
  const [reason, setReason] = useState('');

  const q = useQuery({
    queryKey: ['platform', 'tenants', status],
    queryFn: ({ signal }) =>
      api<{ tenants: TenantRow[] }>(`/platform/tenants?status=${status}&limit=50`, { signal }),
    retry: false,
  });
  const run = useMutation({
    mutationFn: (v: { id: string; action: Action; reason?: string }) =>
      api(`/platform/tenants/${v.id}/${v.action}`, {
        method: 'POST',
        body: v.reason ? { reason: v.reason } : {},
      }),
    onSuccess: async (_d, v) => {
      toast(`Company ${v.action}d`, 'success');
      setPending(null);
      setReason('');
      await qc.invalidateQueries({ queryKey: ['platform', 'tenants'] });
    },
  });

  const mfaMissing =
    q.error instanceof ApiError && q.error.status === 403 && /multi-factor/i.test(q.error.message);
  const close = () => {
    setPending(null);
    setReason('');
    run.reset();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold">Companies</h1>
      <div role="tablist" aria-label="Filter by status" className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className={`min-h-11 rounded-lg px-3 text-sm font-medium ${status === s ? 'bg-brand-700 text-white' : 'bg-white ring-1 ring-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:ring-slate-600'}`}
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      {mfaMissing && (
        <Alert tone="warning">
          Platform access requires two-step verification.{' '}
          <Link className="underline" to="/app/security">
            Turn it on in Security
          </Link>
          , then reload.
        </Alert>
      )}
      {q.isPending && <Spinner label="Loading companies" />}
      {q.error && !mfaMissing && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      <Card>
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {q.data?.tenants.length === 0 && (
            <li className="py-3 text-sm text-slate-500">No companies with this status.</li>
          )}
          {q.data?.tenants.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{t.name}</p>
                <p className="text-xs text-slate-500">
                  {t.slug} · applied {new Date(t.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={t.status} />
                {(ACTIONS_BY_STATUS[t.status] ?? []).map((a) => (
                  <Button
                    key={a}
                    variant={a === 'approve' || a === 'reactivate' ? 'primary' : 'secondary'}
                    onClick={() => {
                      setReason('');
                      setPending({ tenant: t, action: a });
                    }}
                  >
                    {a.charAt(0).toUpperCase() + a.slice(1)}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Dialog
        open={pending !== null}
        title={
          pending
            ? `${pending.action.charAt(0).toUpperCase() + pending.action.slice(1)} ${pending.tenant.name}?`
            : ''
        }
        onClose={close}
      >
        {pending && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run.mutate({
                id: pending.tenant.id,
                action: pending.action,
                ...(reason.trim() ? { reason: reason.trim() } : {}),
              });
            }}
            className="space-y-4"
          >
            {run.error && <ErrorAlert error={run.error} />}
            {NEEDS_REASON.includes(pending.action) ? (
              <div>
                <label htmlFor="reason" className="mb-1 block text-sm font-medium">
                  Reason (recorded in the audit log)
                </label>
                <textarea
                  id="reason"
                  required
                  minLength={3}
                  maxLength={300}
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                />
              </div>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                This action is recorded in the audit log.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={
                  pending.action === 'approve' || pending.action === 'reactivate'
                    ? 'primary'
                    : 'danger'
                }
                loading={run.isPending}
                loadingText="Working…"
              >
                Confirm {pending.action}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
