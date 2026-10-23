import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, LayoutDashboard, Power } from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { DashboardShell } from '../../components/layout/Layouts';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Badge, Card, StatusBadge } from '../../components/ui/Card';
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
      theme="platform"
      nav={[
        { to: '/platform/overview', label: 'Overview', icon: LayoutDashboard, group: 'Platform' },
        { to: '/platform', label: 'Companies', end: true, icon: Building2, group: 'Platform' },
        { to: '/platform/maintenance', label: 'Maintenance', icon: Power, group: 'Platform' },
        { to: '/app', label: 'Exit admin', icon: ArrowLeft, group: 'Account' },
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
            className={`min-h-11 rounded-lg px-3 text-sm font-medium ${status === s ? 'bg-brand-600 text-white' : 'bg-white ring-1 ring-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:ring-slate-600'}`}
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

// ---- Maintenance mode ------------------------------------------------------------------------

interface MaintenanceStatus {
  enabled: boolean;
  message: string | null;
  since: string | null;
}

export function PlatformMaintenancePage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [message, setMessage] = useState('');
  const status = useQuery({
    queryKey: ['platform', 'maintenance'],
    queryFn: ({ signal }) => api<MaintenanceStatus>('/platform/maintenance', { signal }),
  });
  const save = useMutation({
    mutationFn: (v: { enabled: boolean; message?: string }) =>
      api<MaintenanceStatus>('/platform/maintenance', { method: 'PUT', body: v }),
    onSuccess: async (r) => {
      toast(r.enabled ? 'Maintenance mode is ON' : 'Maintenance mode is OFF', 'success');
      await qc.invalidateQueries({ queryKey: ['platform', 'maintenance'] });
      await qc.invalidateQueries({ queryKey: ['maintenance-status'] });
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Could not save', 'error'),
  });
  const [confirmOn, setConfirmOn] = useState(false);
  const on = status.data?.enabled === true;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold">Maintenance mode</h1>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        While on, passengers and companies get a maintenance message instead of the service.
        Sign-in, platform administration and payment webhooks keep working, so you can switch it off
        again and no payment notification is lost.
      </p>
      {status.isPending && <Spinner label="Loading" />}
      {status.error && <ErrorAlert error={status.error} onRetry={() => void status.refetch()} />}
      {status.data && (
        <Card
          title={on ? 'Maintenance is ON' : 'Maintenance is off'}
          className={on ? 'border-accent-500 bg-accent-50 dark:bg-slate-900' : ''}
          action={
            <Badge tone={on ? 'amber' : 'green'} icon={Power}>
              {on ? 'Service paused' : 'Service live'}
            </Badge>
          }
        >
          {on && (
            <Alert tone="info">
              Since {status.data.since ? new Date(status.data.since).toLocaleString() : 'unknown'}:{' '}
              {status.data.message}
            </Alert>
          )}
          <div className="mt-3 space-y-3">
            <label htmlFor="mt-msg" className="block text-sm font-medium">
              Message shown to everyone
            </label>
            <textarea
              id="mt-msg"
              rows={3}
              maxLength={300}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                on
                  ? (status.data.message ?? '')
                  : 'We are upgrading the system and will be back at 14:00 UTC.'
              }
              className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="accent"
                disabled={message.trim().length < 3}
                loading={save.isPending}
                onClick={() => setConfirmOn(true)}
              >
                {on ? 'Update message' : 'Turn maintenance on'}
              </Button>
              {on && (
                <Button
                  variant="secondary"
                  loading={save.isPending}
                  onClick={() => save.mutate({ enabled: false })}
                >
                  Turn maintenance off
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}
      <Dialog open={confirmOn} title="Turn maintenance on?" onClose={() => setConfirmOn(false)}>
        <p className="text-sm">
          Every passenger and company user will be blocked until you switch it off. Continue?
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmOn(false)}>
            Cancel
          </Button>
          <Button
            variant="accent"
            onClick={() => {
              setConfirmOn(false);
              save.mutate({ enabled: true, message: message.trim() });
              setMessage('');
            }}
          >
            Turn on
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
