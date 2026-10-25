import { zodResolver } from '@hookform/resolvers/zod';
import { DataTable } from '../../components/ui/DataTable';
import { StaffRolesDialog, type RoleRow } from './AccessPages';
import { ModalCard } from '../../components/ui/ModalCard';
import { useConfirm } from '../../components/ui/Confirm';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Armchair,
  ArrowLeft,
  BarChart3,
  Bus,
  CalendarDays,
  History,
  IdCard,
  KeyRound,
  LayoutDashboard,
  MapPin,
  MessageSquareWarning,
  Palette,
  Radio,
  Route,
  ScanLine,
  Ticket,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  Waypoints,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, Outlet, useParams } from 'react-router';
import { z } from 'zod';
import { useAuth } from '../../auth/AuthProvider';
import { DashboardShell, type NavItem } from '../../components/layout/Layouts';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Badge, Card, StatusBadge } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { PageLoader, Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { ApiError, api } from '../../lib/api';
import { email } from '../../lib/schemas';
import { AccessContext, can, useCompany, type CompanyAccess } from './company-context';
import { CompanyPulse } from './CompanyPulse';
import type { Branding } from './BrandingPage';

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
  const profile = useQuery({
    queryKey: ['company', tenantId, 'profile'],
    queryFn: ({ signal }) => api<Profile>(`/tenants/${tenantId}/profile`, { signal }),
    retry: false,
  });
  const mine = useQuery({
    queryKey: ['tenants', 'mine'],
    queryFn: ({ signal }) =>
      api<{ tenants: { tenantId: string; membershipStatus: string }[] }>('/tenants/mine', {
        signal,
      }),
    retry: false,
  });
  const brand = useQuery({
    queryKey: ['company', tenantId, 'branding'],
    queryFn: ({ signal }) => api<Branding>(`/tenants/${tenantId}/branding`, { signal }),
    retry: false,
  });
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
  // Acting as a passenger: this area is closed until they switch back to a company role.
  if (q.error instanceof ApiError && q.error.code === 'ROLE_NOT_ACTIVE') {
    return <Navigate to="/app" replace />;
  }
  if (q.error || !q.data) {
    // Non-members and unknown companies look identical (404) by design.
    return (
      <div className="mx-auto max-w-md p-8">
        <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const a = q.data;
  const name = profile.data?.name ?? '';
  const nav: NavItem[] = [
    { to: `/c/${tenantId}`, label: 'Overview', end: true, icon: LayoutDashboard },
  ];
  if (a.tenantStatus === 'ACTIVE') {
    const add = (ok: boolean, group: string, path: string, label: string, icon: LucideIcon) => {
      if (ok) nav.push({ to: `/c/${tenantId}/${path}`, label, icon, group });
    };
    // Grouped the way the sidebar shows them: what happens today, the network, sales, people, insight.
    add(can(a, 'trip.read'), 'Operations', 'dispatch', 'Dispatch', Radio);
    add(can(a, 'route.read'), 'Operations', 'calendar', 'Calendar', CalendarDays);
    add(can(a, 'trip.read'), 'Operations', 'trips', 'Trips', Route);
    add(can(a, 'ticket.validate'), 'Operations', 'boarding', 'Boarding', ScanLine);
    add(can(a, 'route.read'), 'Network', 'routes', 'Routes', Waypoints);
    add(can(a, 'route.read'), 'Network', 'locations', 'Locations', MapPin);
    add(can(a, 'fleet.read'), 'Network', 'vehicles', 'Vehicles', Bus);
    add(can(a, 'fleet.read'), 'Network', 'seat-layouts', 'Seat layouts', Armchair);
    add(can(a, 'booking.read'), 'Sales', 'bookings', 'Bookings', Ticket);
    add(can(a, 'payment.manage'), 'Sales', 'payments', 'Payments', Wallet);
    add(can(a, 'membership.read'), 'People', 'members', 'Staff', Users);
    add(can(a, 'membership.read'), 'People', 'users', 'Users', UserRound);
    add(can(a, 'role.read'), 'People', 'roles', 'Roles', KeyRound);
    add(can(a, 'hr.read'), 'People', 'staff', 'Employees', IdCard);
    add(can(a, 'recruitment.manage'), 'People', 'recruitment', 'Recruitment', UserPlus);
    add(can(a, 'finance.report.read'), 'Insight', 'reports', 'Reports', BarChart3);
    add(can(a, 'support.manage'), 'Insight', 'complaints', 'Complaints', MessageSquareWarning);
    add(can(a, 'audit.read'), 'Insight', 'audit', 'Activity', History);
    add(can(a, 'tenant.profile.update'), 'Company', 'branding', 'Branding', Palette);
    add(can(a, 'fleet.read'), 'Fleet care', 'maintenance', 'Maintenance', Wrench);
  }
  if ((mine.data?.tenants?.filter((t) => t.membershipStatus === 'ACTIVE').length ?? 0) > 1) {
    nav.push({ to: '/app', label: 'Switch company', icon: ArrowLeft, group: 'Account' });
  }
  return (
    <AccessContext.Provider value={{ tenantId, access: a }}>
      <DashboardShell
        nav={nav}
        heading="Company workspace"
        account={`/c/${tenantId}`}
        company={{
          name: name || 'Company workspace',
          logoUrl: brand.data?.logoUrl ?? null,
          primary: brand.data?.primaryColor ?? null,
          accent: brand.data?.accentColor ?? null,
        }}
      >
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
    <div className="w-full space-y-6">
      {q.isPending && <PageLoader label="Loading" />}
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
          {access.tenantStatus === 'ACTIVE' && <CompanyPulse timezone={q.data.timezone} />}
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
  roles: { id: string; key: string; name: string }[];
  passengerMode: boolean;
}
export function StaffPage() {
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
  const [rolesFor, setRolesFor] = useState<Member | null>(null);
  const ask = useConfirm();
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/tenants/${tenantId}/memberships/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast('Member removed', 'success');
      await refresh();
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Could not remove member', 'error'),
  });
  const cancelInvite = useMutation({
    mutationFn: (id: string) => api(`/tenants/${tenantId}/invitations/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl">Staff</h1>
        <p className="text-sm text-slate-700 dark:text-slate-300">
          The people who work for your company. A staff member can hold several roles and switch
          between them, and between those roles and the passenger role.
        </p>
      </div>
      {can(access, 'membership.invite') && (
        <InviteForm roles={roles.data?.roles ?? []} onInvited={refresh} />
      )}
      <StaffRolesDialog
        member={rolesFor}
        allRoles={roles.data?.roles ?? []}
        onClose={() => setRolesFor(null)}
        onChanged={async () => {
          await refresh();
          setRolesFor((cur) => cur);
        }}
      />
      <Card title="Staff members">
        {members.isPending && <PageLoader label="Loading team" />}
        {members.error && (
          <ErrorAlert error={members.error} onRetry={() => void members.refetch()} />
        )}
        <DataTable
          rows={(members.data?.memberships ?? []).filter((x) => x.status === 'ACTIVE')}
          rowKey={(x) => x.id}
          empty="No staff yet. Invite someone to add them."
          columns={[
            {
              key: 'person',
              header: 'Person',
              kind: 'title',
              cell: (x) => (
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white"
                  >
                    {x.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{x.displayName}</p>
                    <p className="truncate text-xs text-slate-600 dark:text-slate-400">{x.email}</p>
                  </div>
                </div>
              ),
            },
            {
              key: 'roles',
              header: 'Roles',
              cell: (x) => (
                <div className="flex flex-wrap gap-1.5">
                  {x.roles.map((r) => (
                    <Badge
                      key={r.id}
                      tone={r.id === x.role.id && !x.passengerMode ? 'green' : 'slate'}
                      icon={null}
                    >
                      {r.name}
                    </Badge>
                  ))}
                  {x.passengerMode && (
                    <Badge tone="amber" icon={null}>
                      Acting as passenger
                    </Badge>
                  )}
                </div>
              ),
            },
            ...(can(access, 'membership.revoke') || can(access, 'membership.invite')
              ? [
                  {
                    key: 'actions',
                    header: 'Actions',
                    kind: 'actions' as const,
                    cell: (x: Member) =>
                      x.userId === user?.id ? null : (
                        <>
                          {can(access, 'membership.invite') && (
                            <Button variant="secondary" onClick={() => setRolesFor(x)}>
                              Roles
                            </Button>
                          )}
                          {can(access, 'membership.revoke') && (
                            <Button
                              variant="danger"
                              loading={revoke.isPending && revoke.variables === x.id}
                              loadingText="Removing…"
                              onClick={async () => {
                                if (
                                  await ask({
                                    title: `Remove ${x.displayName}?`,
                                    message: 'They lose access to this company straight away.',
                                    confirmLabel: 'Remove',
                                    danger: true,
                                  })
                                )
                                  revoke.mutate(x.id);
                              }}
                            >
                              Remove
                            </Button>
                          )}
                        </>
                      ),
                  },
                ]
              : []),
          ]}
        />
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
                    onClick={async () => {
                      if (
                        await ask({
                          title: 'Cancel this invitation?',
                          message: `${i.email} will not be able to use it.`,
                          confirmLabel: 'Cancel invitation',
                          danger: true,
                        })
                      )
                        cancelInvite.mutate(i.id);
                    }}
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
  const [adding640, setAdding640] = useState(false);
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
      setAdding640(false);
      form.reset({ email: '', roleKey: form.getValues('roleKey') });
      await onInvited();
    },
  });
  const { errors } = form.formState;
  return (
    <ModalCard title="Invite someone" open={adding640} onOpenChange={setAdding640}>
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
    </ModalCard>
  );
}

// ---- Roles -----------------------------------------------------------------------------------

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
    <div className="w-full space-y-4">
      <h1 className="text-2xl font-semibold">Activity</h1>
      {q.isPending && <PageLoader label="Loading activity" />}
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
