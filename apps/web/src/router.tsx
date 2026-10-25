import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { AuthLayout } from './components/layout/AuthLayout';
import { CompanyPublicLayout } from './components/layout/CompanyPublicLayout';
import { AppShell, RequireAuth } from './components/layout/Layouts';
import { rememberedCompany } from './lib/company-page';
import { PageLoader } from './components/ui/Spinner';

// Route-level code splitting: each area downloads only when visited (low-bandwidth friendly).
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage'));
const VerifyEmailPage = lazy(() =>
  import('./pages/auth/TokenPages').then((m) => ({ default: m.VerifyEmailPage })),
);
const VerifyEmailCodePage = lazy(() =>
  import('./pages/auth/TokenPages').then((m) => ({ default: m.VerifyEmailCodePage })),
);
const ForgotPasswordPage = lazy(() =>
  import('./pages/auth/TokenPages').then((m) => ({ default: m.ForgotPasswordPage })),
);
const VerifyPhonePage = lazy(() =>
  import('./pages/auth/PhonePages').then((m) => ({ default: m.VerifyPhonePage })),
);
const ResetPhonePasswordPage = lazy(() =>
  import('./pages/auth/PhonePages').then((m) => ({ default: m.ResetPhonePasswordPage })),
);
const PayMethodPage = lazy(() =>
  import('./pages/passenger/PayMethodPage').then((m) => ({ default: m.PayMethodPage })),
);
const ResetPasswordPage = lazy(() =>
  import('./pages/auth/TokenPages').then((m) => ({ default: m.ResetPasswordPage })),
);
const AcceptInvitationPage = lazy(() =>
  import('./pages/auth/TokenPages').then((m) => ({ default: m.AcceptInvitationPage })),
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
const CompanyStaffPage = lazy(() =>
  import('./pages/company/CompanyPages').then((m) => ({ default: m.StaffPage })),
);
const UsersPage = lazy(() =>
  import('./pages/company/AccessPages').then((m) => ({ default: m.UsersPage })),
);
const RolesPage = lazy(() =>
  import('./pages/company/AccessPages').then((m) => ({ default: m.RolesPage })),
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
const PlatformOverviewPage = lazy(() =>
  import('./pages/platform/PlatformOverviewPage').then((m) => ({
    default: m.PlatformOverviewPage,
  })),
);
const PlatformMaintenancePage = lazy(() =>
  import('./pages/platform/PlatformPages').then((m) => ({ default: m.PlatformMaintenancePage })),
);
const BrandingPage = lazy(() =>
  import('./pages/company/BrandingPage').then((m) => ({ default: m.BrandingPage })),
);
const ProfilePage = lazy(() =>
  import('./pages/app/ProfilePage').then((m) => ({ default: m.ProfilePage })),
);
const ChangePasswordPage = lazy(() => import('./pages/auth/ChangePasswordPage'));
const TermsPage = lazy(() =>
  import('./pages/legal/LegalPages').then((m) => ({ default: m.TermsPage })),
);
const PrivacyPage = lazy(() =>
  import('./pages/legal/LegalPages').then((m) => ({ default: m.PrivacyPage })),
);
const CompanyHome = lazy(() => import('./pages/company-public/CompanyHome'));
const PlatformAuditPage = lazy(() =>
  import('./pages/platform/PlatformAuditPage').then((m) => ({ default: m.PlatformAuditPage })),
);
const ComplaintsPage = lazy(() =>
  import('./pages/company/ComplaintsPage').then((m) => ({ default: m.ComplaintsPage })),
);
const MyComplaintsPage = lazy(() =>
  import('./pages/passenger/ComplaintPages').then((m) => ({ default: m.MyComplaintsPage })),
);
const NewComplaintPage = lazy(() =>
  import('./pages/passenger/ComplaintPages').then((m) => ({ default: m.NewComplaintPage })),
);
const ComplaintThreadPage = lazy(() =>
  import('./pages/passenger/ComplaintPages').then((m) => ({ default: m.ComplaintThreadPage })),
);
const ReportsPage = lazy(() =>
  import('./pages/company/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const RecruitmentPage = lazy(() =>
  import('./pages/company/RecruitmentPage').then((m) => ({ default: m.RecruitmentPage })),
);
const JobBoardPage = lazy(() =>
  import('./pages/recruitment/JobPages').then((m) => ({ default: m.JobBoardPage })),
);
const JobDetailPage = lazy(() =>
  import('./pages/recruitment/JobPages').then((m) => ({ default: m.JobDetailPage })),
);
const MyApplicationsPage = lazy(() =>
  import('./pages/recruitment/JobPages').then((m) => ({ default: m.MyApplicationsPage })),
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

const fallback = <PageLoader label="Loading" />;
const s = (node: ReactNode) => <Suspense fallback={fallback}>{node}</Suspense>;

/** The bare address goes to the last company this browser used, otherwise to the main sign-in. */
function RootRedirect() {
  const slug = rememberedCompany();
  return <Navigate to={slug ? `/${slug}` : '/login'} replace />;
}

export const router = createBrowserRouter([
  // The system itself has no public site: each company has its own at /<web-address-name>.
  { path: '/', element: <RootRedirect /> },
  { path: '/terms', element: s(<TermsPage />) },
  { path: '/privacy', element: s(<PrivacyPage />) },
  {
    path: '/pay/return',
    element: (
      <RequireAuth>
        <main className="mx-auto w-full max-w-2xl p-4">{s(<PayReturnPage />)}</main>
      </RequireAuth>
    ),
  },
  {
    element: <AuthLayout />,
    children: [
      { path: '/login', element: s(<LoginPage />) },
      { path: '/change-password', element: s(<ChangePasswordPage />) },
      { path: '/:slug/login', element: s(<LoginPage />) },
      { path: '/:slug/register', element: s(<RegisterPage />) },
      { path: '/register', element: <Navigate to="/login" replace /> },
      { path: '/verify-email', element: s(<VerifyEmailPage />) },
      { path: '/verify-email-code', element: s(<VerifyEmailCodePage />) },
      { path: '/forgot-password', element: s(<ForgotPasswordPage />) },
      { path: '/reset-password', element: s(<ResetPasswordPage />) },
      { path: '/verify-phone', element: s(<VerifyPhonePage />) },
      { path: '/reset-password-phone', element: s(<ResetPhonePasswordPage />) },
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
      { index: true, element: <Navigate to="bookings" replace /> },
      { path: 'bookings', element: s(<MyBookingsPage />) },
      { path: 'bookings/:id', element: s(<MyTicketsPage />) },
      { path: 'bookings/:id/pay', element: s(<PayMethodPage />) },
      { path: 'applications', element: s(<MyApplicationsPage />) },
      { path: 'complaints', element: s(<MyComplaintsPage />) },
      { path: 'complaints/new', element: s(<NewComplaintPage />) },
      { path: 'complaints/:id', element: s(<ComplaintThreadPage />) },
      { path: 'security', element: s(<SecurityPage />) },
      { path: 'profile', element: s(<ProfilePage />) },
    ],
  },
  {
    path: '/c/:tenantId',
    element: <RequireAuth>{s(<CompanyLayout />)}</RequireAuth>,
    children: [
      { index: true, element: s(<CompanyOverview />) },
      { path: 'branding', element: s(<BrandingPage />) },
      { path: 'profile', element: s(<ProfilePage />) },
      { path: 'security', element: s(<SecurityPage />) },
      { path: 'members', element: s(<CompanyStaffPage />) },
      { path: 'users', element: s(<UsersPage />) },
      { path: 'roles', element: s(<RolesPage />) },
      { path: 'audit', element: s(<ActivityPage />) },
      { path: 'locations', element: s(<LocationsPage />) },
      { path: 'vehicles', element: s(<VehiclesPage />) },
      { path: 'routes', element: s(<RoutesPage />) },
      { path: 'trips', element: s(<TripsPage />) },
      { path: 'bookings', element: s(<BookingsPage />) },
      { path: 'payments', element: s(<PaymentSettingsPage />) },
      { path: 'boarding', element: s(<BoardingPage />) },
      { path: 'complaints', element: s(<ComplaintsPage />) },
      { path: 'reports', element: s(<ReportsPage />) },
      { path: 'recruitment', element: s(<RecruitmentPage />) },
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
    children: [
      { index: true, element: s(<PlatformTenantsPage />) },
      { path: 'overview', element: s(<PlatformOverviewPage />) },
      { path: 'audit', element: s(<PlatformAuditPage />) },
      { path: 'profile', element: s(<ProfilePage />) },
      { path: 'security', element: s(<SecurityPage />) },
      { path: 'maintenance', element: s(<PlatformMaintenancePage />) },
    ],
  },
  {
    path: '/:slug',
    element: <CompanyPublicLayout />,
    children: [
      { index: true, element: s(<CompanyHome />) },
      { path: 'trips', element: s(<TripSearchPage />) },
      { path: 'trips/:tripId', element: s(<TripBookPage />) },
      { path: 'jobs', element: s(<JobBoardPage />) },
      { path: 'jobs/:id', element: s(<JobDetailPage />) },
    ],
  },
  { path: '/dashboard', element: <Navigate to="/app" replace /> },
  { path: '*', element: s(<NotFoundPage />) },
]);
