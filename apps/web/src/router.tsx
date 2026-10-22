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
const DispatchPage = lazy(() =>
  import('./pages/company/DispatchPages').then((m) => ({ default: m.DispatchPage })),
);
const CalendarPage = lazy(() =>
  import('./pages/company/DispatchPages').then((m) => ({ default: m.CalendarPage })),
);
const SeatLayoutsPage = lazy(() =>
  import('./pages/company/DispatchPages').then((m) => ({ default: m.SeatLayoutsPage })),
);
const BookingsPage = lazy(() =>
  import('./pages/company/BookingPages').then((m) => ({ default: m.BookingsPage })),
);
const PaymentSettingsPage = lazy(() =>
  import('./pages/company/PaymentSettingsPage').then((m) => ({ default: m.PaymentSettingsPage })),
);
const TripSearchPage = lazy(() =>
  import('./pages/passenger/PassengerPages').then((m) => ({ default: m.TripSearchPage })),
);
const TripBookPage = lazy(() =>
  import('./pages/passenger/PassengerPages').then((m) => ({ default: m.TripBookPage })),
);
const PayReturnPage = lazy(() =>
  import('./pages/passenger/PassengerPages').then((m) => ({ default: m.PayReturnPage })),
);
const MyBookingsPage = lazy(() =>
  import('./pages/passenger/PassengerPages').then((m) => ({ default: m.MyBookingsPage })),
);
const BoardingPage = lazy(() =>
  import('./pages/company/BoardingPage').then((m) => ({ default: m.BoardingPage })),
);
const MyTicketsPage = lazy(() =>
  import('./pages/passenger/TicketPages').then((m) => ({ default: m.MyTicketsPage })),
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
      { path: '/trips', element: s(<TripSearchPage />) },
      { path: '/trips/:tenantId/:tripId', element: s(<TripBookPage />) },
      { path: '/pay/return', element: <RequireAuth>{s(<PayReturnPage />)}</RequireAuth> },
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
      { path: 'bookings', element: s(<MyBookingsPage />) },
      { path: 'bookings/:id', element: s(<MyTicketsPage />) },
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
      { path: 'bookings', element: s(<BookingsPage />) },
      { path: 'payments', element: s(<PaymentSettingsPage />) },
      { path: 'boarding', element: s(<BoardingPage />) },
      { path: 'dispatch', element: s(<DispatchPage />) },
      { path: 'calendar', element: s(<CalendarPage />) },
      { path: 'seat-layouts', element: s(<SeatLayoutsPage />) },
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
