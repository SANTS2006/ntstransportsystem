import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Navigate, Outlet, useParams } from 'react-router';
import { z } from 'zod';
import { useAuth } from '../../auth/AuthProvider';
import { DashboardShell, type NavItem } from '../../components/layout/Layouts';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, StatusBadge } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { email } from '../../lib/schemas';
import { AccessContext, can, useCompany, type CompanyAccess } from './company-context';

interface Profile {
  id: string;
  name: string;
  status: string;
  timezone: string;
  defaultCurrency: string;
}
/** Loads the caller's role in this company. Navigation is hidden by permission; the API enforces it. */
export function CompanyLayout() {
  const { tenantId = '' } = useParams();
  const q = useQuery({
    queryKey: ['company', tenantId, 'access'],
    queryFn: ({ signal }) => api<CompanyAccess>(`/tenants/${tenantId}/me`, { signal }),
  });
  if (q.isPending)
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner size="lg" label="Loading company" />
      </div>
    );
  if (q.error || !q.data) {
    // Non-members and unknown companies look identical (404) by design.
    return (
      <div className="mx-auto max-w-md p-8">
        <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const a = q.data;
  const nav: NavItem[] = [{ to: `/c/${tenantId}`, label: 'Overview', end: true }];
  if (a.tenantStatus === 'ACTIVE') {
    if (can(a, 'route.read')) {
      nav.push({ to: `/c/${tenantId}/routes`, label: 'Routes' });
      nav.push({ to: `/c/${tenantId}/locations`, label: 'Locations' });
    }
    if (can(a, 'trip.read')) nav.push({ to: `/c/${tenantId}/trips`, label: 'Trips' });
    if (can(a, 'booking.read')) nav.push({ to: `/c/${tenantId}/bookings`, label: 'Bookings' });
    if (can(a, 'payment.manage')) nav.push({ to: `/c/${tenantId}/payments`, label: 'Payments' });
    if (can(a, 'trip.read')) nav.push({ to: `/c/${tenantId}/dispatch`, label: 'Dispatch' });
    if (can(a, 'route.read')) nav.push({ to: `/c/${tenantId}/calendar`, label: 'Calendar' });
    if (can(a, 'fleet.read')) nav.push({ to: `/c/${tenantId}/vehicles`, label: 'Vehicles' });
    if (can(a, 'fleet.read'))
      nav.push({ to: `/c/${tenantId}/seat-layouts`, label: 'Seat layouts' });
    if (can(a, 'fleet.read')) nav.push({ to: `/c/${tenantId}/maintenance`, label: 'Maintenance' });
    if (can(a, 'hr.read')) nav.push({ to: `/c/${tenantId}/staff`, label: 'Staff' });
    if (can(a, 'membership.read')) nav.push({ to: `/c/${tenantId}/members`, label: 'Team' });
    if (can(a, 'role.read')) nav.push({ to: `/c/${tenantId}/roles`, label: 'Roles' });
    if (can(a, 'audit.read')) nav.push({ to: `/c/${tenantId}/audit`, label: 'Activity' });
  }
  nav.push({ to: '/app', label: '← My companies' });
  return (
    <AccessContext.Provider value={{ tenantId, access: a }}>
      <DashboardShell nav={nav} heading="Company workspace">
        <Outlet />
      </DashboardShell>
    </AccessContext.Provider>
  );
}

export function CompanyOverview() {
  const { tenantId, access } = useCompany();
  const q = useQuery({
    queryKey: ['company', tenantId, 'profile'],
    queryFn: ({ signal }) => api<Profile>(`/tenants/${tenantId}/profile`, { signal }),
  });
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {q.isPending && <Spinner label="Loading" />}
      {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{q.data.name}</h1>
            <StatusBadge status={q.data.status} />
          </div>
          {access.tenantStatus === 'PENDING' && (
            <Alert tone="info">
              Your application is awaiting review by the platform team. Operations unlock once it is
              approved.
            </Alert>
          )}
          {access.tenantStatus === 'ACTIVE' && can(access, 'tenant.profile.update') && (
            <ProfileForm profile={q.data} />
          )}
          {access.tenantStatus === 'ACTIVE' && !can(access, 'tenant.profile.update') && (
            <Card title="Details">
              <dl className="text-sm">
                <dt className="text-slate-500">Timezone</dt>
                <dd>{q.data.timezone}</dd>
                <dt className="mt-2 text-slate-500">Currency</dt>
                <dd>{q.data.defaultCurrency}</dd>
              </dl>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  timezone: z.string().trim().min(1),
  defaultCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, '3-letter code'),
});
type ProfileValues = z.infer<typeof profileSchema>;

function ProfileForm({ profile }: { profile: Profile }) {
  const { tenantId } = useCompany();
  const toast = useToast();
  const qc = useQueryClient();
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: profile.name,
      timezone: profile.timezone,
      defaultCurrency: profile.defaultCurrency,
    },
  });
  const save = useMutation({
    mutationFn: (v: ProfileValues) =>
      api(`/tenants/${tenantId}/profile`, { method: 'PATCH', body: v }),
    onSuccess: async () => {
      toast('Company details saved', 'success');
      await qc.invalidateQueries({ queryKey: ['company', tenantId] });
    },
  });
  const { errors } = form.formState;
  return (
    <Card title="Company details">
      {save.error && <ErrorAlert error={save.error} />}
      <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4">
        <Field label="Name" error={errors.name?.message} {...form.register('name')} />
        <Field label="Timezone" error={errors.timezone?.message} {...form.register('timezone')} />
        <Field
          label="Currency"
          maxLength={3}
          error={errors.defaultCurrency?.message}
          {...form.register('defaultCurrency')}
        />
        <Button type="submit" loading={save.isPending} loadingText="Saving…">
          Save changes
        </Button>
      </form>
    </Card>
  );
}

// ---- Team ------------------------------------------------------------------------------------

interface Member {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  status: string;
  role: { id: string; key: string; name: string };
}
interface RoleRow {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
  members: number;
  permissions: string[];
}

export function TeamPage() {
  const { tenantId, access } = useCompany();
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const members = useQuery({
    queryKey: ['company', tenantId, 'members'],
    queryFn: ({ signal }) =>
      api<{ memberships: Member[] }>(`/tenants/${tenantId}/memberships`, { signal }),
  });
  const roles = useQuery({
    queryKey: ['company', tenantId, 'roles'],
    enabled: can(access, 'role.read'),
    queryFn: ({ signal }) => api<{ roles: RoleRow[] }>(`/tenants/${tenantId}/roles`, { signal }),
  });
  const invitations = useQuery({
    queryKey: ['company', tenantId, 'invitations'],
    queryFn: ({ signal }) =>
      api<{ invitations: { id: string; email: string; role: { name: string } }[] }>(
        `/tenants/${tenantId}/invitations`,
        { signal },
      ),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['company', tenantId] });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/tenants/${tenantId}/memberships/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast('Member removed', 'success');
      await refresh();
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Could not remove member', 'error'),
  });
  const changeRole = useMutation({
    mutationFn: (v: { id: string; roleKey: string }) =>
      api(`/tenants/${tenantId}/memberships/${v.id}`, {
        method: 'PATCH',
        body: { roleKey: v.roleKey },
      }),
    onSuccess: async () => {
      toast('Role updated', 'success');
      await refresh();
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Could not change role', 'error'),
  });
  const cancelInvite = useMutation({
    mutationFn: (id: string) => api(`/tenants/${tenantId}/invitations/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">Team</h1>
      {can(access, 'membership.invite') && (
        <InviteForm roles={roles.data?.roles ?? []} onInvited={refresh} />
      )}
      <Card title="Members">
        {members.isPending && <Spinner label="Loading team" />}
        {members.error && (
          <ErrorAlert error={members.error} onRetry={() => void members.refetch()} />
        )}
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {members.data?.memberships
            .filter((m) => m.status === 'ACTIVE')
            .map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{m.displayName}</p>
                  <p className="truncate text-xs text-slate-500">{m.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {can(access, 'membership.invite') && roles.data && m.userId !== user?.id ? (
                    <select
                      aria-label={`Role for ${m.displayName}`}
                      className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                      value={m.role.key}
                      disabled={changeRole.isPending}
                      onChange={(e) => changeRole.mutate({ id: m.id, roleKey: e.target.value })}
                    >
                      {roles.data.roles.map((r) => (
                        <option key={r.id} value={r.key}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-slate-600 dark:text-slate-400">
                      {m.role.name}
                    </span>
                  )}
                  {can(access, 'membership.revoke') && m.userId !== user?.id && (
                    <Button
                      variant="danger"
                      loading={revoke.isPending && revoke.variables === m.id}
                      loadingText="Removing…"
                      onClick={() => {
                        if (window.confirm(`Remove ${m.displayName} from this company?`))
                          revoke.mutate(m.id);
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </li>
            ))}
        </ul>
      </Card>
      {invitations.data && invitations.data.invitations.length > 0 && (
        <Card title="Pending invitations">
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {invitations.data.invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span className="truncate">
                  {i.email} <span className="text-xs text-slate-500">({i.role.name})</span>
                </span>
                {can(access, 'membership.invite') && (
                  <Button
                    variant="ghost"
                    loading={cancelInvite.isPending && cancelInvite.variables === i.id}
                    onClick={() => cancelInvite.mutate(i.id)}
                  >
                    Cancel
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

const inviteSchema = z.object({ email, roleKey: z.string().min(1, 'Choose a role') });
type InviteValues = z.infer<typeof inviteSchema>;

function InviteForm({ roles, onInvited }: { roles: RoleRow[]; onInvited: () => Promise<void> }) {
  const { tenantId } = useCompany();
  const toast = useToast();
  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', roleKey: roles.find((r) => r.key === 'driver')?.key ?? '' },
  });
  const invite = useMutation({
    mutationFn: (v: InviteValues) =>
      api(`/tenants/${tenantId}/invitations`, { method: 'POST', body: v }),
    onSuccess: async () => {
      toast('Invitation sent', 'success');
      form.reset({ email: '', roleKey: form.getValues('roleKey') });
      await onInvited();
    },
  });
  const { errors } = form.formState;
  return (
    <Card title="Invite someone">
      {invite.error && <ErrorAlert error={invite.error} />}
      <form
        noValidate
        onSubmit={form.handleSubmit((v) => invite.mutate(v))}
        className="flex flex-wrap items-start gap-3"
      >
        <div className="min-w-56 flex-1">
          <Field
            label="Email"
            type="email"
            error={errors.email?.message}
            {...form.register('email')}
          />
        </div>
        <div>
          <label htmlFor="invite-role" className="mb-1 block text-sm font-medium">
            Role
          </label>
          <select
            id="invite-role"
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            {...form.register('roleKey')}
          >
            <option value="">Choose…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.key}>
                {r.name}
              </option>
            ))}
          </select>
          {errors.roleKey && (
            <p role="alert" className="mt-1 text-xs text-red-700">
              {errors.roleKey.message}
            </p>
          )}
        </div>
        <Button type="submit" className="mt-6" loading={invite.isPending} loadingText="Sending…">
          Send invitation
        </Button>
      </form>
    </Card>
  );
}

// ---- Roles -----------------------------------------------------------------------------------

export function RolesPage() {
  const { tenantId } = useCompany();
  const q = useQuery({
    queryKey: ['company', tenantId, 'roles'],
    queryFn: ({ signal }) =>
      api<{ roles: RoleRow[]; catalog: string[] }>(`/tenants/${tenantId}/roles`, { signal }),
  });
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">Roles & permissions</h1>
      {q.isPending && <Spinner label="Loading roles" />}
      {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      {q.data?.roles.map((r) => (
        <Card
          key={r.id}
          title={r.name}
          action={
            r.isSystem ? (
              <span className="text-xs text-slate-500">System role (locked)</span>
            ) : (
              <span className="text-xs text-slate-500">{r.members} member(s)</span>
            )
          }
        >
          <ul className="flex flex-wrap gap-2">
            {r.permissions.map((p) => (
              <li
                key={p}
                className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs dark:bg-slate-800"
              >
                {p}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

// ---- Activity --------------------------------------------------------------------------------

export function ActivityPage() {
  const { tenantId } = useCompany();
  const q = useQuery({
    queryKey: ['company', tenantId, 'audit'],
    queryFn: ({ signal }) =>
      api<{ events: { id: string; action: string; outcome: string; createdAt: string }[] }>(
        `/tenants/${tenantId}/audit?limit=50`,
        { signal },
      ),
  });
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">Activity</h1>
      {q.isPending && <Spinner label="Loading activity" />}
      {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      <Card>
        <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
          {q.data?.events.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2">
              <span className="font-mono text-xs">{e.action}</span>
              <span className="flex items-center gap-3 text-xs text-slate-500">
                <span
                  className={
                    e.outcome === 'SUCCESS' ? '' : 'font-medium text-red-700 dark:text-red-400'
                  }
                >
                  {e.outcome}
                </span>
                {new Date(e.createdAt).toLocaleString()}
              </span>
            </li>
          ))}
          {q.data?.events.length === 0 && <li className="py-2 text-slate-500">No activity yet.</li>}
        </ul>
      </Card>
    </div>
  );
}

export const CompanyIndexRedirect = () => <Navigate to="/app" replace />;
