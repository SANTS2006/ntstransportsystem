import { useQuery } from '@tanstack/react-query';
import { ArrowRight, MessageSquareWarning, Users } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { StatTile, StatusBadge } from '../../components/ui/Card';
import { PageLoader } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
import { companyNav } from './CompanyPages';
import { CompanyPulse } from './CompanyPulse';
import { can, useCompany } from './company-context';

interface Profile {
  name: string;
  status: string;
  timezone: string;
  defaultCurrency: string;
}

const ROLE_BLURB: Record<string, string> = {
  owner: 'You can see and manage everything in the company.',
  admin: 'You manage the company day to day.',
  dispatcher: 'You run today: trips, vehicles and crews.',
  sales_agent: 'You sell and look after bookings.',
  driver: 'You work the trips you are assigned to and check passengers on board.',
  finance_officer: 'You follow sales, payments and reports.',
  hr_manager: 'You look after staff and recruitment.',
  auditor: 'You review what has happened in the company.',
};

/** The first page of every company role: today's figures and a way into everything the role may open. */
export function CompanyDashboard() {
  const { tenantId, access } = useCompany();
  const { user } = useAuth();
  const base = `/tenants/${tenantId}`;
  const profile = useQuery({
    queryKey: ['company', tenantId, 'profile'],
    queryFn: ({ signal }) => api<Profile>(`${base}/profile`, { signal }),
  });
  const role = useQuery({
    queryKey: ['tenants', 'mine'],
    queryFn: ({ signal }) =>
      api<{ tenants: { tenantId: string; role: { name: string } }[] }>('/tenants/mine', { signal }),
  });
  const roleName = role.data?.tenants.find((t) => t.tenantId === tenantId)?.role.name;
  const active = access.tenantStatus === 'ACTIVE';
  const seeStaff = active && can(access, 'membership.read');
  const seeComplaints = active && can(access, 'support.manage');
  const staff = useQuery({
    queryKey: ['company', tenantId, 'members'],
    enabled: seeStaff,
    queryFn: ({ signal }) =>
      api<{ memberships: { status: string }[] }>(`${base}/memberships`, { signal }),
  });
  const complaints = useQuery({
    queryKey: ['company', tenantId, 'complaints', 'list', 'OPEN'],
    enabled: seeComplaints,
    queryFn: ({ signal }) =>
      api<{ complaints: unknown[] }>(`${base}/complaints?limit=50&status=OPEN`, { signal }),
  });
  const tiles = companyNav(access, tenantId).filter((n) => !n.to.endsWith('/dashboard'));
  const groups = [...new Set(tiles.map((t) => t.group ?? 'More'))];
  const first = user?.displayName.split(/\s+/)[0] ?? '';

  return (
    <div className="w-full min-w-0 space-y-6">
      <header className="rounded-3xl bg-gradient-to-br from-brand-600 to-brand-800 p-5 text-white shadow-level2 sm:p-7">
        <p className="text-sm text-white/80">Welcome back{first ? `, ${first}` : ''}</p>
        <h1 className="mt-1 break-words text-2xl font-bold !text-white sm:text-3xl">
          {profile.data?.name ?? 'Your company'}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {roleName && (
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
              {roleName}
            </span>
          )}
          {profile.data && <StatusBadge status={profile.data.status} />}
        </div>
        <p className="mt-3 max-w-2xl text-sm text-white/85">
          {ROLE_BLURB[access.role.key] ?? 'Everything you may open is listed below.'}
        </p>
      </header>

      {profile.isPending && <PageLoader label="Loading" />}
      {profile.error && <ErrorAlert error={profile.error} onRetry={() => void profile.refetch()} />}
      {access.tenantStatus === 'PENDING' && (
        <Alert tone="info">
          Your application is awaiting review by the platform team. Operations unlock once it is
          approved.
        </Alert>
      )}

      {active && profile.data && <CompanyPulse timezone={profile.data.timezone} />}

      {(seeStaff || seeComplaints) && (
        <section aria-label="People and support" className="grid gap-3 sm:grid-cols-2">
          {seeStaff && (
            <StatTile
              label="Staff"
              icon={Users}
              value={
                staff.data
                  ? staff.data.memberships.filter((m) => m.status === 'ACTIVE').length
                  : '…'
              }
              note="Active members of the company"
            />
          )}
          {seeComplaints && (
            <StatTile
              label="Open complaints"
              icon={MessageSquareWarning}
              tone={(complaints.data?.complaints.length ?? 0) > 0 ? 'amber' : 'slate'}
              value={complaints.data ? complaints.data.complaints.length : '…'}
              note="Waiting for a reply"
            />
          )}
        </section>
      )}

      {active &&
        groups.map((g) => (
          <section key={g} aria-label={g} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              {g}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {tiles
                .filter((t) => (t.group ?? 'More') === g)
                .map((t) => (
                  <li key={t.to}>
                    <Link
                      to={t.to}
                      className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-white p-4 text-sm font-semibold shadow-level1 transition hover:-translate-y-0.5 hover:shadow-level2 dark:bg-slate-900"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        {t.icon && (
                          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-slate-800 dark:text-brand-500">
                            <t.icon aria-hidden="true" className="size-5" strokeWidth={1.8} />
                          </span>
                        )}
                        <span className="truncate">{t.label}</span>
                      </span>
                      <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-slate-400" />
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
