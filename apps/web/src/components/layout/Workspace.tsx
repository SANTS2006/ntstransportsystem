import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { Navigate, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { api } from '../../lib/api';
import { setAppCompany } from '../../lib/app-path';
import NotFoundPage from '../../pages/NotFoundPage';
import { CompanyLayout } from '../../pages/company/CompanyPages';
import { PageLoader } from '../ui/Spinner';
import { LegacyRedirect, PassengerShell } from './Layouts';

/** Whether the person is acting as company staff or as a passenger of the company right now. */
type Mode = 'staff' | 'passenger';
const ModeContext = createContext<Mode>('passenger');
export const useWorkspaceMode = () => useContext(ModeContext);

/** Shows one page for staff and another for passengers at the same address (e.g. bookings). */
export function ByMode({ staff, passenger }: { staff: ReactNode; passenger: ReactNode }) {
  return <>{useWorkspaceMode() === 'staff' ? staff : passenger}</>;
}

/**
 * Everything a company's people see lives under the company's web address: /<company>/dashboard,
 * /<company>/bookings ... The same address serves every role: staff get the company workspace,
 * and passengers (customers, or staff who switched to the passenger role) get the passenger pages,
 * both wearing the company's name, logo and colours.
 */
export function Workspace() {
  // "/app/..." is an old address, not a company called "app".
  return useParams().slug === 'app' ? <LegacyRedirect /> : <CompanyWorkspace />;
}

function CompanyWorkspace() {
  const { slug = '' } = useParams();
  const { user } = useAuth();
  setAppCompany(slug);
  const isPlatform = (user?.platformRoles.length ?? 0) > 0;
  const mine = useQuery({
    queryKey: ['tenants', 'mine'],
    enabled: Boolean(user) && !isPlatform,
    queryFn: ({ signal }) =>
      api<{
        tenants: {
          tenantId: string;
          slug: string;
          name: string;
          membershipStatus: string;
          passengerMode: boolean;
        }[];
      }>('/tenants/mine', { signal }),
  });
  if (isPlatform) return <Navigate to="/platform/dashboard" replace />;
  if (mine.isPending) return <PageLoader label="Opening your workspace" full />;
  const membership = (mine.data?.tenants ?? []).find(
    (t) => t.slug === slug && t.membershipStatus === 'ACTIVE',
  );
  const home = user?.homeCompany ?? null;
  if (!membership) {
    // A customer of this company: passenger pages only. Anyone else belongs on their own company.
    if (home && home.slug === slug) {
      return (
        <ModeContext.Provider value="passenger">
          <PassengerShell slug={slug} name={home.name} />
        </ModeContext.Provider>
      );
    }
    if (home) return <Navigate to={`/${home.slug}/dashboard`} replace />;
    const first = (mine.data?.tenants ?? []).find((t) => t.membershipStatus === 'ACTIVE');
    return first ? <Navigate to={`/${first.slug}/dashboard`} replace /> : <NotFoundPage />;
  }
  if (membership.passengerMode) {
    return (
      <ModeContext.Provider value="passenger">
        <PassengerShell slug={slug} name={membership.name} />
      </ModeContext.Provider>
    );
  }
  return (
    <ModeContext.Provider value="staff">
      <CompanyLayout tenantId={membership.tenantId} />
    </ModeContext.Provider>
  );
}
