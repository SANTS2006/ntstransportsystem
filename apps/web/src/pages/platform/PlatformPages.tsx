import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  DatabaseBackup,
  LayoutDashboard,
  Mail,
  Plus,
  Power,
  ScrollText,
} from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { DashboardShell } from '../../components/layout/Layouts';
import { appRoot } from '../../lib/app-path';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Badge, Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { PageLoader } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { ApiError, api } from '../../lib/api';
import { CompaniesTable, type Action, type TenantRow } from './CompaniesTable';
import { EditCompanyDialog } from './EditCompanyDialog';
import { RegisterCompanyDialog } from './RegisterCompanyDialog';

const NEEDS_REASON: Action[] = ['reject', 'suspend', 'deactivate'];

const STATUSES = ['ACTIVE', 'PENDING', 'SUSPENDED', 'REJECTED', 'DEACTIVATED', 'ALL'];

/** Visible only to people with a platform role; the API independently requires role + MFA. */
export function PlatformLayout() {
  const { user } = useAuth();
  if (!user || user.platformRoles.length === 0) {
    return (
      <div className="mx-auto max-w-md p-8">
        <Alert tone="error">Page not found.</Alert>
        <Link className="mt-4 inline-block text-sm font-medium" to={appRoot()}>
          Back to dashboard
        </Link>
      </div>
    );
  }
  return (
    <DashboardShell
      heading="Platform administration"
      theme="platform"
      account="/platform"
      nav={[
        { to: '/platform/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Platform' },
        { to: '/platform/companies', label: 'Companies', icon: Building2, group: 'Platform' },
        { to: '/platform/email', label: 'Email', icon: Mail, group: 'Platform' },
        { to: '/platform/audit', label: 'Audit log', icon: ScrollText, group: 'Platform' },
        ...(user.platformRoles.includes('SUPER_ADMIN')
          ? [{ to: '/platform/backup', label: 'Backup', icon: DatabaseBackup, group: 'Platform' }]
          : []),
        { to: '/platform/maintenance', label: 'Maintenance', icon: Power, group: 'Platform' },
      ]}
    >
      <Outlet />
    </DashboardShell>
  );
}

export function PlatformTenantsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState('ACTIVE');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<TenantRow | null>(null);
  const [pending, setPending] = useState<{ tenant: TenantRow; action: Action } | null>(null);
  const [reason, setReason] = useState('');
  const [registering, setRegistering] = useState(false);

  const q = useQuery({
    queryKey: ['platform', 'tenants', status, search],
    queryFn: ({ signal }) =>
      api<{ tenants: TenantRow[] }>(
        `/platform/tenants?limit=100${status === 'ALL' ? '' : `&status=${status}`}${
          search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ''
        }`,
        { signal },
      ),
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
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Only platform staff can register a company. Its administrator is emailed the sign-in
            link and a temporary password.
          </p>
        </div>
        <Button variant="accent" onClick={() => setRegistering(true)}>
          <Plus aria-hidden="true" className="size-4" strokeWidth={1.8} />
          Register a company
        </Button>
      </div>
      <div className="max-w-md">
        <input
          type="search"
          aria-label="Search companies"
          placeholder="Search by name or web address"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base placeholder:text-slate-500 dark:border-slate-600 dark:bg-slate-900"
        />
      </div>
      <div role="tablist" aria-label="Filter by status" className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className={`min-h-11 rounded-lg px-3 text-sm font-medium ${status === s ? 'bg-brand-600 text-white' : 'bg-white shadow-[var(--shadow-field)] hover:bg-slate-50 dark:bg-slate-900'}`}
          >
            {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      {mfaMissing && (
        <Alert tone="warning">
          Platform access requires two-step verification.{' '}
          <Link className="font-medium" to="/platform/security">
            Turn it on in Security
          </Link>
          , then reload.
        </Alert>
      )}
      {q.isPending && <PageLoader label="Loading companies" />}
      {q.error && !mfaMissing && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && q.data.tenants.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
          No companies match.
        </p>
      )}
      {q.data && q.data.tenants.length > 0 && (
        <CompaniesTable
          rows={q.data.tenants}
          onEdit={setEditing}
          onAction={(tenant, action) => {
            setReason('');
            setPending({ tenant, action });
          }}
        />
      )}
      <EditCompanyDialog
        company={editing}
        onClose={() => setEditing(null)}
        onSaved={async (message) => {
          toast(message, 'success');
          setEditing(null);
          await qc.invalidateQueries({ queryKey: ['platform', 'tenants'] });
        }}
      />

      <RegisterCompanyDialog
        open={registering}
        onClose={() => setRegistering(false)}
        onDone={async (message) => {
          toast(message, 'success');
          setRegistering(false);
          setStatus('ACTIVE');
          await qc.invalidateQueries({ queryKey: ['platform', 'tenants'] });
        }}
      />

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
    <div className="w-full space-y-5">
      <h1 className="text-2xl font-semibold">Maintenance mode</h1>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        While on, passengers and companies get a maintenance message instead of the service.
        Sign-in, platform administration and payment webhooks keep working, so you can switch it off
        again and no payment notification is lost.
      </p>
      {status.isPending && <PageLoader label="Loading" />}
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
