import { useMutation } from '@tanstack/react-query';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { api } from '../../lib/api';
import { Spinner } from '../ui/Spinner';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { TopProgress } from './TopProgress';
import type { ReactNode } from 'react';

function Brand() {
  return (
    <Link
      to="/"
      className="flex items-center gap-2 text-lg font-semibold text-brand-700 dark:text-brand-500"
    >
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-lg bg-brand-700 text-sm font-bold text-white"
      >
        N
      </span>
      NTS Transport
    </Link>
  );
}

const navLink = ({ isActive }: { isActive: boolean }) =>
  `block rounded-lg px-3 py-2 text-sm font-medium ${
    isActive
      ? 'bg-brand-50 text-brand-700 dark:bg-slate-800 dark:text-brand-500'
      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
  }`;

export function PublicLayout() {
  const { user, loading } = useAuth();
  return (
    <div className="min-h-dvh">
      <TopProgress />
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Brand />
          <nav className="flex items-center gap-2 text-sm">
            {loading ? null : user ? (
              <Link
                className="rounded-lg bg-brand-700 px-4 py-2 font-medium text-white hover:bg-brand-600"
                to="/app"
              >
                Open dashboard
              </Link>
            ) : (
              <>
                <Link
                  className="rounded-lg px-3 py-2 font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                  to="/login"
                >
                  Sign in
                </Link>
                <Link
                  className="rounded-lg bg-brand-700 px-4 py-2 font-medium text-white hover:bg-brand-600"
                  to="/register"
                >
                  Create account
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-10">
        <Outlet />
      </main>
    </div>
  );
}

/** Centered card layout for sign-in style pages. */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>}
      <div className="mt-6 space-y-4">{children}</div>
    </div>
  );
}

/** Gate for signed-in areas. The server still authorizes every request; this only routes users. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, error, refresh } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner size="lg" label="Checking your session" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-md p-8">
        <Alert tone="error">We could not check your session. Please check your connection.</Alert>
        <Button className="mt-4" onClick={() => void refresh()}>
          Retry
        </Button>
      </div>
    );
  }
  if (!user) {
    const dest = location.pathname + location.search;
    // /app is the default landing page, so a `next` for it would be redundant noise.
    return (
      <Navigate
        to={dest === '/app' ? '/login' : `/login?next=${encodeURIComponent(dest)}`}
        replace
      />
    );
  }
  return <>{children}</>;
}

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

export function DashboardShell({
  nav,
  heading,
  children,
}: {
  nav: NavItem[];
  heading?: string;
  children?: ReactNode;
}) {
  const { user, clear } = useAuth();
  const navigate = useNavigate();
  const signOut = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      clear();
      void navigate('/login', { replace: true });
    },
  });
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <TopProgress />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2"
      >
        Skip to content
      </a>
      <aside className="border-b border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:border-b-0 lg:border-r">
        <Brand />
        {heading && (
          <p className="mt-4 truncate text-xs font-semibold uppercase tracking-wide text-slate-500">
            {heading}
          </p>
        )}
        <nav aria-label="Main" className="mt-2 flex gap-1 overflow-x-auto lg:flex-col">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end ?? false} className={navLink}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 hidden border-t border-slate-200 pt-4 text-xs dark:border-slate-700 lg:block">
          <p className="truncate font-medium">{user?.displayName}</p>
          <p className="truncate text-slate-500">{user?.email}</p>
          <Button
            variant="ghost"
            className="mt-2 w-full"
            loading={signOut.isPending}
            loadingText="Signing out…"
            onClick={() => signOut.mutate()}
          >
            Sign out
          </Button>
        </div>
      </aside>
      <main id="main" className="min-w-0 p-4 sm:p-6 lg:p-8">
        {children ?? <Outlet />}
        <div className="mt-8 lg:hidden">
          <Button
            variant="secondary"
            loading={signOut.isPending}
            loadingText="Signing out…"
            onClick={() => signOut.mutate()}
          >
            Sign out
          </Button>
        </div>
      </main>
    </div>
  );
}

const APP_NAV: NavItem[] = [
  { to: '/app', label: 'My companies', end: true },
  { to: '/app/apply', label: 'Register a company' },
  { to: '/app/security', label: 'Security' },
];

/** Account area shell. Platform staff additionally get a link to the admin area. */
export function AppShell() {
  const { user } = useAuth();
  const nav =
    user && user.platformRoles.length > 0
      ? [...APP_NAV, { to: '/platform', label: 'Platform admin' }]
      : APP_NAV;
  return <DashboardShell nav={nav} heading="Your account" />;
}
