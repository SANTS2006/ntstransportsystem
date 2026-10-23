import { useMutation } from '@tanstack/react-query';
import {
  Briefcase,
  Building2,
  LogOut,
  Menu,
  MessageSquareWarning,
  PlusCircle,
  ShieldCheck,
  Ticket,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { api } from '../../lib/api';
import { Spinner } from '../ui/Spinner';
import { Alert } from '../ui/Alert';
import { Button, linkButton } from '../ui/Button';
import { Logo } from './Logo';
import { MaintenanceBanner } from './MaintenanceBanner';
import { NotificationBell } from './NotificationBell';
import { TopProgress } from './TopProgress';

const linkClass = 'text-sm font-medium text-slate-700 hover:text-brand-700 dark:text-slate-300';

function Brand() {
  return (
    <Link to="/" aria-label="NTS Transport home" className="flex items-center">
      <Logo size="md" />
    </Link>
  );
}

/** Round initials, the stand-in for a profile picture. */
function Avatar({ name }: { name: string | undefined }) {
  const initials =
    (name ?? '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?';
  return (
    <span
      aria-hidden="true"
      className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white"
    >
      {initials}
    </span>
  );
}

function PublicFooter() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-3">
          <Logo size="md" />
          <p className="max-w-xs text-sm text-slate-600 dark:text-slate-400">
            Book coach seats with licensed transport companies in Sierra Leone and pay with mobile
            money. Companies run routes, fleet, ticketing and boarding in one place.
          </p>
        </div>
        <nav aria-label="Passengers" className="space-y-2 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Passengers</p>
          <ul className="space-y-2">
            <li>
              <Link className={linkClass} to="/trips">
                Find a trip
              </Link>
            </li>
            <li>
              <Link className={linkClass} to="/app/bookings">
                My bookings
              </Link>
            </li>
            <li>
              <Link className={linkClass} to="/jobs">
                Jobs
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="Companies" className="space-y-2 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Companies</p>
          <ul className="space-y-2">
            <li>
              <Link className={linkClass} to="/app/apply">
                Register your company
              </Link>
            </li>
            <li>
              <Link className={linkClass} to="/login">
                Company sign in
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-slate-100 py-4 text-center text-xs text-slate-500 dark:border-slate-800">
        © {new Date().getFullYear()} NTS Transport. Prices are shown in Sierra Leonean leone (SLE).
      </div>
    </footer>
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
  const [open, setOpen] = useState(false);
  const links = [
    { to: '/trips', label: 'Find a trip' },
    { to: '/jobs', label: 'Jobs' },
    { to: '/app/apply', label: 'Register company' },
  ];
  return (
    <div className="flex min-h-dvh flex-col">
      <TopProgress />
      <MaintenanceBanner />
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5">
          <Brand />
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} className={navLink}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {loading ? null : user ? (
              <>
                <NotificationBell />
                <span className="hidden sm:block">
                  <Link className={linkButton('primary')} to="/app">
                    Open dashboard
                  </Link>
                </span>
                <Link to="/app" aria-label="My account" className="sm:hidden">
                  <Avatar name={user.displayName} />
                </Link>
              </>
            ) : (
              <>
                <span className="hidden sm:block">
                  <Link className={linkButton('ghost')} to="/login">
                    Sign in
                  </Link>
                </span>
                <Link className={linkButton('primary')} to="/register">
                  Create account
                </Link>
              </>
            )}
            <button
              type="button"
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="grid size-11 place-items-center rounded-lg hover:bg-slate-100 md:hidden dark:hover:bg-slate-800"
            >
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>
        {open && (
          <nav
            aria-label="Menu"
            className="space-y-1 border-t border-slate-100 px-4 py-3 md:hidden dark:border-slate-800"
          >
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} className={navLink} onClick={() => setOpen(false)}>
                {l.label}
              </NavLink>
            ))}
            {!user && (
              <NavLink to="/login" className={navLink} onClick={() => setOpen(false)}>
                Sign in
              </NavLink>
            )}
          </nav>
        )}
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:py-10">
        <Outlet />
      </main>
      <PublicFooter />
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
    <div className="mx-auto w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-level2 sm:p-8 dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
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
  icon?: LucideIcon;
  /** Section heading in the sidebar ("Operations", "Sales"...). Items without one come first. */
  group?: string;
}

function groupNav(nav: NavItem[]): { name: string | null; items: NavItem[] }[] {
  const out: { name: string | null; items: NavItem[] }[] = [];
  for (const n of nav) {
    const name = n.group ?? null;
    const last = out[out.length - 1];
    if (last && last.name === name) last.items.push(n);
    else out.push({ name, items: [n] });
  }
  return out;
}

const sideLink = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-brand-600 text-white'
      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
  }`;

/**
 * Signed-in layout: a sidebar of grouped links (a drawer on phones), a top bar with notifications
 * and the account, and the page. The `platform` theme recolours it with the logo's navy and orange.
 */
export function DashboardShell({
  nav,
  heading,
  theme,
  children,
}: {
  nav: NavItem[];
  heading?: string;
  theme?: 'platform';
  children?: ReactNode;
}) {
  const { user, clear } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const signOut = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      clear();
      void navigate('/login', { replace: true });
    },
  });
  const sidebar = (
    <>
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <Brand />
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="grid size-10 place-items-center rounded-lg hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800"
        >
          <X className="size-5" />
        </button>
      </div>
      {heading && (
        <p
          className={`mx-4 mt-4 truncate rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
            theme === 'platform'
              ? 'bg-accent-50 text-accent-700 dark:bg-slate-800 dark:text-accent-500'
              : 'bg-brand-50 text-brand-700 dark:bg-slate-800 dark:text-brand-500'
          }`}
        >
          {heading}
        </p>
      )}
      <nav aria-label="Main" className="mt-3 flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {groupNav(nav).map((g, i) => (
          <div key={g.name ?? `g${i}`}>
            {g.name && (
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {g.name}
              </p>
            )}
            <ul className="space-y-0.5">
              {g.items.map((n) => (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    end={n.end ?? false}
                    className={sideLink}
                    onClick={() => setOpen(false)}
                  >
                    {n.icon && (
                      <n.icon
                        aria-hidden="true"
                        className="size-[18px] shrink-0"
                        strokeWidth={1.8}
                      />
                    )}
                    {n.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-slate-200 p-4 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <Avatar name={user?.displayName} />
          <div className="min-w-0 text-xs">
            <p className="truncate font-medium">{user?.displayName}</p>
            <p className="truncate text-slate-500">{user?.email ?? user?.phone}</p>
          </div>
        </div>
        <Button
          variant="secondary"
          className="mt-3 w-full"
          loading={signOut.isPending}
          loadingText="Signing out…"
          onClick={() => signOut.mutate()}
        >
          <LogOut aria-hidden="true" className="size-4" strokeWidth={1.8} />
          Sign out
        </Button>
      </div>
    </>
  );
  return (
    <div className={`min-h-dvh lg:flex ${theme === 'platform' ? 'theme-platform' : ''}`}>
      <TopProgress />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2"
      >
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-dvh dark:border-slate-800 dark:bg-slate-900">
        {sidebar}
      </aside>
      {/* Phone drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-slate-900/45"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-level3 dark:bg-slate-900">
            {sidebar}
          </aside>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
            className="grid size-11 place-items-center rounded-lg hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800"
          >
            <Menu className="size-5" />
          </button>
          <span className="hidden text-sm font-medium text-slate-500 lg:block">{heading}</span>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <Avatar name={user?.displayName} />
          </div>
        </header>
        <MaintenanceBanner />
        <main id="main" className="min-w-0 p-4 sm:p-6 lg:p-8">
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  );
}

const APP_NAV: NavItem[] = [
  { to: '/app/bookings', label: 'My bookings', icon: Ticket, group: 'Travel' },
  { to: '/app/complaints', label: 'My complaints', icon: MessageSquareWarning, group: 'Travel' },
  { to: '/app/applications', label: 'My job applications', icon: Briefcase, group: 'Travel' },
  { to: '/app', label: 'My companies', end: true, icon: Building2, group: 'Companies' },
  { to: '/app/apply', label: 'Register a company', icon: PlusCircle, group: 'Companies' },
  { to: '/app/security', label: 'Security', icon: ShieldCheck, group: 'Account' },
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
