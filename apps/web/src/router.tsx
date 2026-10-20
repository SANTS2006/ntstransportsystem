import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell, PublicLayout, RequireAuth } from './components/layout/Layouts';
import { Spinner } from './components/ui/Spinner';

// Route-level code splitting: each area downloads only when visited (low-bandwidth friendly).
const HomePage = lazy(() => import('./pages/HomePage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage'));
const VerifyEmailPage = lazy(() =>
  import('./pages/auth/TokenPages').then((m) => ({ default: m.VerifyEmailPage })),
);
const ForgotPasswordPage = lazy(() =>
  import('./pages/auth/TokenPages').then((m) => ({ default: m.ForgotPasswordPage })),
);
const ResetPasswordPage = lazy(() =>
  import('./pages/auth/TokenPages').then((m) => ({ default: m.ResetPasswordPage })),
);
const AcceptInvitationPage = lazy(() =>
  import('./pages/auth/TokenPages').then((m) => ({ default: m.AcceptInvitationPage })),
);
const MyCompaniesPage = lazy(() =>
  import('./pages/app/AppPages').then((m) => ({ default: m.MyCompaniesPage })),
);
const ApplyCompanyPage = lazy(() =>
  import('./pages/app/AppPages').then((m) => ({ default: m.ApplyCompanyPage })),
);
const SecurityPage = lazy(() =>
  import('./pages/app/AppPages').then((m) => ({ default: m.SecurityPage })),
);
const CompanyLayout = lazy(() =>
  import('./pages/company/CompanyPages').then((m) => ({ default: m.CompanyLayout })),
);
const CompanyOverview = lazy(() =>
  import('./pages/company/CompanyPages').then((m) => ({ default: m.CompanyOverview })),
);
const TeamPage = lazy(() =>
  import('./pages/company/CompanyPages').then((m) => ({ default: m.TeamPage })),
);
const RolesPage = lazy(() =>
  import('./pages/company/CompanyPages').then((m) => ({ default: m.RolesPage })),
);
const ActivityPage = lazy(() =>
  import('./pages/company/CompanyPages').then((m) => ({ default: m.ActivityPage })),
);
const LocationsPage = lazy(() =>
  import('./pages/company/CatalogPages').then((m) => ({ default: m.LocationsPage })),
);
const VehiclesPage = lazy(() =>
  import('./pages/company/CatalogPages').then((m) => ({ default: m.VehiclesPage })),
);
const RoutesPage = lazy(() =>
  import('./pages/company/CatalogPages').then((m) => ({ default: m.RoutesPage })),
);
const TripsPage = lazy(() =>
  import('./pages/company/TripPages').then((m) => ({ default: m.TripsPage })),
);
const StaffPage = lazy(() =>
  import('./pages/company/CrewPages').then((m) => ({ default: m.StaffPage })),
);
const MaintenancePage = lazy(() =>
  import('./pages/company/CrewPages').then((m) => ({ default: m.MaintenancePage })),
);
const PlatformLayout = lazy(() =>
  import('./pages/platform/PlatformPages').then((m) => ({ default: m.PlatformLayout })),
);
const PlatformTenantsPage = lazy(() =>
  import('./pages/platform/PlatformPages').then((m) => ({ default: m.PlatformTenantsPage })),
);

const fallback = (
  <div className="grid min-h-[40vh] place-items-center">
    <Spinner size="lg" label="Loading" />
  </div>
);
const s = (node: ReactNode) => <Suspense fallback={fallback}>{node}</Suspense>;

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: s(<HomePage />) },
      { path: '/login', element: s(<LoginPage />) },
      { path: '/register', element: s(<RegisterPage />) },
      { path: '/verify-email', element: s(<VerifyEmailPage />) },
      { path: '/forgot-password', element: s(<ForgotPasswordPage />) },
      { path: '/reset-password', element: s(<ResetPasswordPage />) },
      {
        path: '/accept-invitation',
        element: <RequireAuth>{s(<AcceptInvitationPage />)}</RequireAuth>,
      },
    ],
  },
  {
    path: '/app',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: s(<MyCompaniesPage />) },
      { path: 'apply', element: s(<ApplyCompanyPage />) },
      { path: 'security', element: s(<SecurityPage />) },
    ],
  },
  {
    path: '/c/:tenantId',
    element: <RequireAuth>{s(<CompanyLayout />)}</RequireAuth>,
    children: [
      { index: true, element: s(<CompanyOverview />) },
      { path: 'members', element: s(<TeamPage />) },
      { path: 'roles', element: s(<RolesPage />) },
      { path: 'audit', element: s(<ActivityPage />) },
      { path: 'locations', element: s(<LocationsPage />) },
      { path: 'vehicles', element: s(<VehiclesPage />) },
      { path: 'routes', element: s(<RoutesPage />) },
      { path: 'trips', element: s(<TripsPage />) },
      { path: 'maintenance', element: s(<MaintenancePage />) },
      { path: 'staff', element: s(<StaffPage />) },
    ],
  },
  {
    path: '/platform',
    element: <RequireAuth>{s(<PlatformLayout />)}</RequireAuth>,
    children: [{ index: true, element: s(<PlatformTenantsPage />) }],
  },
  { path: '/dashboard', element: <Navigate to="/app" replace /> },
  { path: '*', element: s(<NotFoundPage />) },
]);
