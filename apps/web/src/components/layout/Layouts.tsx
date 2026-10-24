import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Briefcase,
  Building2,
  LogOut,
  Menu,
  UserRound,
  MessageSquareWarning,
  ShieldCheck,
  Ticket,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { api } from '../../lib/api';
import { signInPath } from '../../lib/company-page';
import { brandStyle } from '../../lib/theme';
import { BlockingOverlay, PageLoader, Spinner } from '../ui/Spinner';
import { Alert } from '../ui/Alert';
import { Button, linkButton } from '../ui/Button';
import { Logo } from './Logo';
import { MaintenanceBanner } from './MaintenanceBanner';
import { ThemeToggle } from '../ui/ThemeToggle';
import { NotificationBell } from './NotificationBell';
import { TopProgress } from './TopProgress';

const linkClass = 'text-sm font-medium text-slate-700 hover:text-brand-700 dark:text-slate-300';

/** A company's name and logo, shown in its workspace instead of the system's. */
export interface CompanyBrand {
  name: string;
  logoUrl: string | null;
  primary: string | null;
  accent: string | null;
}

function Brand({
  company,
  onDark = false,
  home,
}: {
  company?: CompanyBrand | undefined;
  onDark?: boolean;
  home?: string | undefined;
}) {
  const name = company?.name ?? 'NTS Transport';
  return (
    <Link
      to={home ?? (company ? '.' : '/')}
      aria-label={`${name} home`}
      className="flex min-w-0 items-center gap-2.5"
    >
      {company ? (
        company.logoUrl ? (
          <img
            src={company.logoUrl}
            alt=""
            className="h-10 w-auto max-w-24 shrink-0 rounded-md bg-white object-contain p-0.5"
          />
        ) : (
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-md bg-white text-base font-bold text-brand-700"
          >
            {name.slice(0, 1).toUpperCase()}
          </span>
        )
      ) : (
        <Logo size="md" />
      )}
      <span
        className={`${company ? 'block' : 'hidden md:block'} min-w-0 truncate text-base font-bold tracking-tight ${
          onDark ? 'text-white' : 'text-brand-800 dark:text-slate-100'
        }`}
      >
        {name}
      </span>
    </Link>
  );
}

/** The person's picture, or round initials when they have none. */
export function Avatar({
  name,
  version,
  accent = false,
  size = 'md',
}: {
  name: string | undefined;
  version?: number | null | undefined;
  accent?: boolean;
  size?: 'md' | 'lg';
}) {
  const [broken, setBroken] = useState(false);
  const initials =
    (name ?? '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?';
  const box = size === 'lg' ? 'size-20 text-2xl' : 'size-9 text-sm';
  if (version && !broken) {
    return (
      <img
        src={`/api/v1/auth/me/avatar?v=${version}`}
        alt=""
        aria-hidden="true"
        onError={() => setBroken(true)}
        className={`${box} shrink-0 rounded-full object-cover`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`grid ${box} shrink-0 place-items-center rounded-full font-semibold ${
        accent ? 'bg-accent-500 text-brand-900' : 'bg-brand-600 text-white'
      }`}
    >
      {initials}
    </span>
  );
}

function CompanyFooter({ company, base }: { company: CompanyBrand; base: string }) {
  const link = 'text-sm font-medium text-slate-700 hover:text-brand-700 dark:text-slate-300';
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto flex w-[90%] flex-wrap items-center justify-between gap-4 py-8">
        <div>
          <p className="font-semibold">{company.name}</p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Book seats and find jobs with {company.name}. Powered by NTS Transport.
          </p>
        </div>
        <nav aria-label="Company" className="flex flex-wrap gap-x-6 gap-y-2">
          <Link className={link} to={`${base}/trips`}>
            Find a trip
          </Link>
          <Link className={link} to={`${base}/jobs`}>
            Jobs
          </Link>
          <Link className={link} to={`${base}/login`}>
            Sign in
          </Link>
          <Link className={link} to={`${base}/register`}>
            Create account
          </Link>
        </nav>
      </div>
      <div className="border-t border-slate-100 py-4 text-center text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
        © {new Date().getFullYear()} {company.name}
      </div>
    </footer>
  );
}

function PublicFooter() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto grid w-[90%] gap-8 py-10 sm:grid-cols-[1.4fr_1fr_1fr]">
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
              <Link className={linkClass} to={signInPath(null)}>
                Sign in
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

export function PublicLayout({
  company,
  base = '',
}: {
  /** Set on a company's own public site: its name and logo replace the system's. */
  company?: CompanyBrand;
  /** The company's web address, e.g. /acme-coaches; empty on the system-wide pages. */
  base?: string;
}) {
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const links = [
    { to: `${base}/trips`, label: 'Find a trip' },
    { to: `${base}/jobs`, label: 'Jobs' },
  ];
  return (
    <div className="flex min-h-dvh flex-col">
      <TopProgress />
      <MaintenanceBanner />
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex w-[90%] items-center justify-between gap-3 py-2.5">
          <Brand company={company} home={base || undefined} />
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} className={navLink}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {loading ? null : user ? (
              <>
                <NotificationBell />
                <span className="hidden sm:block">
                  <Link className={linkButton('primary')} to="/app">
                    Open dashboard
                  </Link>
                </span>
                <Link to="/app" aria-label="My account" className="sm:hidden">
                  <Avatar name={user.displayName} version={user.avatarVersion} />
                </Link>
              </>
            ) : (
              <>
                <Link
                  className={linkButton(base ? 'secondary' : 'primary')}
                  to={base ? `${base}/login` : signInPath(null)}
                >
                  Sign in
                </Link>
                {base && (
                  <span className="hidden sm:block">
                    <Link className={linkButton('primary')} to={`${base}/register`}>
                      Create account
                    </Link>
                  </span>
                )}
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
              <NavLink
                to={base ? `${base}/login` : signInPath(null)}
                className={navLink}
                onClick={() => setOpen(false)}
              >
                Sign in
              </NavLink>
            )}
            {!user && base && (
              <NavLink to={`${base}/register`} className={navLink} onClick={() => setOpen(false)}>
                Create account
              </NavLink>
            )}
          </nav>
        )}
      </header>
      <main id="main" className="mx-auto w-[90%] flex-1 py-8 sm:py-10">
        <Outlet />
      </main>
      {company ? <CompanyFooter company={company} base={base} /> : <PublicFooter />}
    </div>
  );
}

/** The white form card on the right of the sign-in layout. */
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
    <div className="w-full max-w-[480px] rounded-3xl bg-white p-5 shadow-level3 sm:p-8 dark:bg-slate-900 dark:ring-1 dark:ring-slate-700">
      <h1 className="text-2xl font-bold tracking-tight text-brand-900 sm:text-3xl dark:text-slate-100">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-1.5 text-base text-slate-700 dark:text-slate-300">{subtitle}</p>
      )}
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
  if (user?.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (!user) {
    const dest = location.pathname + location.search;
    // /app is the default landing page, so a `next` for it would be redundant noise.
    // An invitation link names the company, so the person lands on that company's sign-in page.
    const named = new URLSearchParams(location.search).get('company');
    const login = signInPath(null, named && /^[a-z0-9-]{3,40}$/.test(named) ? named : null);
    return (
      <Navigate
        to={dest === '/app' ? login : `${login}?next=${encodeURIComponent(dest)}`}
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

/** The round picture at the top right: opens a small menu with the profile, security and sign out. */
function ProfileMenu({ account, onSignOut }: { account: string; onSignOut: () => void }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') setOpen(false);
      } else if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const item =
    'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label="Your account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded-full ring-2 ring-transparent hover:ring-brand-200"
      >
        <Avatar name={user?.displayName} version={user?.avatarVersion} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-40 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-level3 dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="flex items-center gap-3 px-3 py-2">
            <Avatar name={user?.displayName} version={user?.avatarVersion} />
            <div className="min-w-0 text-xs">
              <p className="truncate text-sm font-semibold">{user?.displayName}</p>
              <p className="truncate text-slate-500">{user?.email ?? user?.phone}</p>
            </div>
          </div>
          <div className="my-1 h-px bg-slate-100 dark:bg-slate-800" />
          <Link
            role="menuitem"
            to={`${account}/profile`}
            className={item}
            onClick={() => setOpen(false)}
          >
            <UserRound aria-hidden="true" className="size-4" strokeWidth={1.8} />
            Profile and settings
          </Link>
          <Link
            role="menuitem"
            to={`${account}/security`}
            className={item}
            onClick={() => setOpen(false)}
          >
            <ShieldCheck aria-hidden="true" className="size-4" strokeWidth={1.8} />
            Security
          </Link>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <LogOut aria-hidden="true" className="size-4" strokeWidth={1.8} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Foot of every signed-in page: whose workspace this is, and the way back to the public site. */
function AppFooter({ company, account }: { company?: CompanyBrand | undefined; account: string }) {
  return (
    <footer className="border-t border-slate-200 px-4 py-5 text-xs text-slate-500 sm:px-6 lg:px-8 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p>
          © {new Date().getFullYear()} {company?.name ?? 'NTS Transport'}
          {company ? ' · powered by NTS Transport' : ''}. Prices are shown in Sierra Leonean leone
          (SLE) unless a company sets another currency.
        </p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-1">
          <Link to="/trips" className="hover:text-brand-700">
            Find a trip
          </Link>
          <Link to={`${account}/profile`} className="hover:text-brand-700">
            My account
          </Link>
          <Link to={`${account}/security`} className="hover:text-brand-700">
            Security
          </Link>
        </nav>
      </div>
    </footer>
  );
}

const sideLink = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-brand-600 text-white shadow-level1'
      : 'text-slate-200 hover:bg-white/10 hover:text-white'
  }`;

/**
 * Signed-in layout: a sidebar of grouped links (a drawer on phones), a top bar with notifications
 * and the account, and the page. The `platform` theme recolours it with the logo's navy and orange.
 */
export function DashboardShell({
  nav,
  heading,
  theme,
  company,
  account = '/app',
  children,
}: {
  nav: NavItem[];
  heading?: string;
  theme?: 'platform';
  /** Set inside a company's workspace: its name, logo and colours replace the system's. */
  company?: CompanyBrand | undefined;
  /** Where this person's profile and security pages live inside this area. */
  account?: string;
  children?: ReactNode;
}) {
  const { user, clear } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const signOut = useMutation({
    mutationFn: async () => {
      // Hold the message on screen long enough to read, even when the server answers at once.
      const [res] = await Promise.allSettled([
        api('/auth/logout', { method: 'POST' }),
        new Promise((r) => setTimeout(r, 900)),
      ]);
      if (res.status === 'rejected') throw res.reason;
    },
    onSettled: () => {
      const back = signInPath(user);
      clear();
      void navigate(back, { replace: true });
    },
  });
  const sidebar = (
    <>
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <Brand company={company} onDark />
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="grid size-10 place-items-center rounded-lg text-white hover:bg-white/10 lg:hidden"
        >
          <X className="size-5" />
        </button>
      </div>
      {heading && (
        <p
          className={`mx-4 mt-4 truncate rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
            theme === 'platform' ? 'bg-accent-500 text-brand-900' : 'bg-white/10 text-white'
          }`}
        >
          {heading}
        </p>
      )}
      <nav aria-label="Main" className="mt-3 flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {groupNav(nav).map((g, i) => (
          <div key={g.name ?? `g${i}`}>
            {g.name && (
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
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
      <div className="border-t border-white/10 p-4 text-white">
        <div className="flex items-center gap-3">
          <Avatar name={user?.displayName} accent />
          <div className="min-w-0 text-xs">
            <p className="truncate font-medium">{user?.displayName}</p>
            <p className="truncate text-slate-300">{user?.email ?? user?.phone}</p>
          </div>
        </div>
        <Button
          variant="accent"
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
    <div
      className={`min-h-dvh lg:flex ${theme === 'platform' ? 'theme-platform' : ''}`}
      style={company ? brandStyle(company.primary, company.accent) : undefined}
    >
      <TopProgress />
      {signOut.isPending && (
        <BlockingOverlay title="Signing you out…" note="Closing your session safely." />
      )}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2"
      >
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col bg-brand-900 text-white lg:sticky lg:top-0 lg:flex lg:h-dvh">
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
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-brand-900 text-white shadow-level3">
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
            <ThemeToggle />
            <NotificationBell />
            <ProfileMenu account={account} onSignOut={() => signOut.mutate()} />
          </div>
        </header>
        <MaintenanceBanner />
        <main id="main" className="min-w-0 p-4 sm:p-6 lg:p-8">
          {children ?? <Outlet />}
        </main>
        <AppFooter company={company} account={account} />
      </div>
    </div>
  );
}

const APP_NAV: NavItem[] = [
  { to: '/app/bookings', label: 'My bookings', icon: Ticket, group: 'Travel' },
  { to: '/app/complaints', label: 'My complaints', icon: MessageSquareWarning, group: 'Travel' },
  { to: '/app/applications', label: 'My job applications', icon: Briefcase, group: 'Travel' },
  { to: '/app/security', label: 'Security', icon: ShieldCheck, group: 'Account' },
];

/** A staff member who works for more than one company chooses which to open. */
const PICKER_NAV: NavItem[] = [{ to: '/app', label: 'My companies', end: true, icon: Building2 }];

/**
 * The passenger area. Platform administrators and company staff never see it: they are sent
 * straight to their own area when they sign in, and only ordinary (passenger) accounts stay here.
 */
export function AppShell() {
  const { user } = useAuth();
  const isPlatform = (user?.platformRoles.length ?? 0) > 0;
  const mine = useQuery({
    queryKey: ['tenants', 'mine'],
    enabled: Boolean(user) && !isPlatform,
    queryFn: ({ signal }) =>
      api<{ tenants: { tenantId: string; name: string; membershipStatus: string }[] }>(
        '/tenants/mine',
        { signal },
      ),
  });
  if (isPlatform) return <Navigate to="/platform" replace />;
  if (mine.isPending) return <PageLoader label="Opening your workspace" full />;
  const staff = (mine.data?.tenants ?? []).filter((t) => t.membershipStatus === 'ACTIVE');
  if (staff.length === 1) return <Navigate to={`/c/${staff[0]!.tenantId}`} replace />;
  if (staff.length > 1) {
    return (
      <DashboardShell nav={PICKER_NAV} heading="Your companies">
        <div className="mx-auto w-[90%] space-y-3">
          <h1 className="text-2xl">Choose a company</h1>
          <ul className="grid gap-3 sm:grid-cols-2">
            {staff.map((t) => (
              <li key={t.tenantId}>
                <Link
                  to={'/c/' + t.tenantId}
                  className="block rounded-2xl border border-slate-200 bg-white p-4 font-semibold shadow-level1 hover:border-brand-600 dark:border-slate-700 dark:bg-slate-900"
                >
                  {t.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </DashboardShell>
    );
  }
  return <DashboardShell nav={APP_NAV} heading="Your account" />;
}
