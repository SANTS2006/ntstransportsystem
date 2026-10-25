import { zodResolver } from '@hookform/resolvers/zod';
import { DataTable } from '../../components/ui/DataTable';
import { ListTools } from '../../components/ui/ListTools';
import { StaffRolesDialog, type RoleRow } from './AccessPages';
import { useConfirm } from '../../components/ui/Confirm';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Armchair,
  Building2,
  ArrowLeft,
  BarChart3,
  Bus,
  CalendarDays,
  History,
  KeyRound,
  LayoutDashboard,
  MapPin,
  Plus,
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
import { Navigate, Outlet } from 'react-router';
import { z } from 'zod';
import { useAuth } from '../../auth/AuthProvider';
import { DashboardShell, type NavItem } from '../../components/layout/Layouts';
import { appRoot } from '../../lib/app-path';
import { Avatar } from '../../components/layout/Layouts';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Badge, Card, StatusBadge } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { PageLoader, Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { ApiError, api } from '../../lib/api';
import { AccessContext, can, useCompany, type CompanyAccess } from './company-context';
import { AddStaffButton, StaffDetailsDialog, type Member } from './StaffDetails';
import type { Branding } from './BrandingPage';

interface Profile {
  id: string;
  name: string;
  status: string;
  timezone: string;
  defaultCurrency: string;
}
/** The sidebar of a company workspace: only what the signed-in role may open. */
export function companyNav(a: CompanyAccess): NavItem[] {
  const nav: NavItem[] = [
    { to: `${appRoot()}/dashboard`, label: 'Dashboard', icon: LayoutDashboard },
  ];
  if (a.tenantStatus === 'ACTIVE') {
    const add = (ok: boolean, group: string, path: string, label: string, icon: LucideIcon) => {
      if (ok) nav.push({ to: `${appRoot()}/${path}`, label, icon, group });
    };
    // Grouped the way the sidebar shows them: what happens today, the network, sales, people, insight.
    add(can(a, 'trip.read'), 'Operations', 'dispatch', 'Dispatch', Radio);
    add(can(a, 'route.read'), 'Operations', 'calendar', 'Calendar', CalendarDays);
    add(can(a, 'trip.read'), 'Operations', 'trip-manager', 'Trips', Route);
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
    add(can(a, 'recruitment.manage'), 'People', 'recruitment', 'Recruitment', UserPlus);
    add(can(a, 'finance.report.read'), 'Insight', 'reports', 'Reports', BarChart3);
    add(can(a, 'support.manage'), 'Insight', 'complaints', 'Complaints', MessageSquareWarning);
    add(can(a, 'audit.read'), 'Insight', 'audit', 'Activity', History);
    add(can(a, 'tenant.profile.update'), 'Company', 'company', 'Company details', Building2);
    add(can(a, 'tenant.profile.update'), 'Company', 'branding', 'Branding', Palette);
    add(can(a, 'fleet.read'), 'Fleet care', 'maintenance', 'Maintenance', Wrench);
  }
  return nav;
}

/** Loads the caller's role in this company. Navigation is hidden by permission; the API enforces it. */
export function CompanyLayout({ tenantId }: { tenantId: string }) {
  const profile = useQuery({
    queryKey: ['company', tenantId, 'profile'],
    queryFn: ({ signal }) => api<Profile>(`/tenants/${tenantId}/profile`, { signal }),
    retry: false,
  });
  const mine = useQuery({
    queryKey: ['tenants', 'mine'],
    queryFn: ({ signal }) =>
      api<{
        tenants: { tenantId: string; slug: string; name: string; membershipStatus: string }[];
      }>('/tenants/mine', { signal }),
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
    return <Navigate to={`${appRoot()}/dashboard`} replace />;
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
  const nav = companyNav(a);
  for (const t of mine.data?.tenants ?? []) {
    if (t.membershipStatus === 'ACTIVE' && t.tenantId !== tenantId) {
      nav.push({
        to: `/${t.slug}/dashboard`,
        label: `Switch to ${t.name}`,
        icon: ArrowLeft,
        group: 'Account',
      });
    }
  }
  return (
    <AccessContext.Provider value={{ tenantId, access: a }}>
      <DashboardShell
        nav={nav}
        heading="Company workspace"
        account={appRoot()}
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
  const refresh = () => qc.invalidateQueries({ queryKey: ['company', tenantId] });
  const [rolesFor, setRolesFor] = useState<Member | null>(null);
  const [detailsFor, setDetailsFor] = useState<Member | null>(null);
  const ask = useConfirm();
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/tenants/${tenantId}/memberships/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast('Member removed', 'success');
      await refresh();
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Could not remove member', 'error'),
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
      {can(access, 'hr.manage') && <AddStaffButton onAdded={refresh} />}
      <StaffDetailsDialog
        member={detailsFor}
        onClose={() => setDetailsFor(null)}
        onChanged={async () => {
          await refresh();
        }}
      />
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
          name="Staff"
          rows={(members.data?.memberships ?? []).filter((x) => x.status === 'ACTIVE')}
          rowKey={(x) => x.id}
          empty="No staff yet. Add a staff member to begin."
          columns={[
            {
              key: 'person',
              header: 'Person',
              kind: 'title',
              cell: (x) => (
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar
                    name={x.displayName}
                    version={x.avatarVersion}
                    src={`/api/v1/tenants/${tenantId}/people/${x.userId}/avatar`}
                  />
                  <button
                    type="button"
                    onClick={() => setDetailsFor(x)}
                    className="min-w-0 text-left"
                    aria-label={`Details for ${x.displayName}`}
                  >
                    <p className="truncate font-semibold text-brand-700 dark:text-brand-500">
                      {x.displayName}
                    </p>
                    <p className="truncate text-xs text-slate-600 dark:text-slate-400">{x.email}</p>
                    {x.phone && (
                      <p className="truncate text-xs text-slate-600 dark:text-slate-400">
                        {x.phone}
                      </p>
                    )}
                  </button>
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
            {
              key: 'actions',
              header: 'Actions',
              kind: 'actions' as const,
              cell: (x: Member) => (
                <>
                  <Button variant="secondary" onClick={() => setDetailsFor(x)}>
                    Details
                  </Button>
                  {can(access, 'membership.invite') && (
                    <Button variant="secondary" onClick={() => setRolesFor(x)}>
                      <Plus aria-hidden="true" className="size-4" strokeWidth={1.8} />
                      Add role
                    </Button>
                  )}
                  {x.userId === user?.id ? null : (
                    <>
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
                  )}
                </>
              ),
            },
          ]}
        />
      </Card>
    </div>
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
        <ListTools title="Activity">
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
            {q.data?.events.length === 0 && (
              <li className="py-2 text-slate-500">No activity yet.</li>
            )}
          </ul>
        </ListTools>
      </Card>
    </div>
  );
}

export const CompanyIndexRedirect = () => <Navigate to={appRoot()} replace />;
