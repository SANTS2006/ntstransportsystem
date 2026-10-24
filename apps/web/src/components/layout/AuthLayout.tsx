import {
  BarChart3,
  Bus,
  Settings,
  ShieldCheck,
  Ticket,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { rememberCompany } from '../../lib/company-page';
import { Link, Outlet, useLocation, useParams } from 'react-router';
import { PageLoader } from '../ui/Spinner';
import { ThemeToggle } from '../ui/ThemeToggle';
import { api } from '../../lib/api';
import { brandStyle } from '../../lib/theme';
import { MaintenanceBanner } from './MaintenanceBanner';
import { TopProgress } from './TopProgress';

const FEATURES: { icon: LucideIcon; title: string; note: string }[] = [
  { icon: Bus, title: 'Manage Fleet', note: 'Buses, taxis and more' },
  { icon: Ticket, title: 'Sell Tickets', note: 'Online and at terminals' },
  { icon: Users, title: 'Manage Staff', note: 'Drivers, conductors and staff' },
  { icon: BarChart3, title: 'Grow Your Business', note: 'Reports and analytics' },
];
const TRUST: { icon: LucideIcon; title: string; note: string }[] = [
  { icon: ShieldCheck, title: 'Secure Platform', note: 'Your data is protected' },
  { icon: Zap, title: 'Reliable & Fast', note: 'Built for operations' },
  { icon: Settings, title: 'Trusted by Transport Companies', note: 'Across the region' },
];

/** The pitch beside the form: logo, headline, what the platform does, and the fleet. */
interface PublicCompany {
  name: string;
  slug: string;
  primaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
}

function HeroPanel({ company }: { company?: PublicCompany | undefined }) {
  const { pathname } = useLocation();
  const joining = pathname.endsWith('/register');
  return (
    <aside className="relative hidden flex-col justify-between gap-6 overflow-hidden px-8 pt-10 lg:flex xl:px-16 xl:pt-12">
      <div>
        <Link to={company ? `/${company.slug}` : '/'} aria-label="Home" className="inline-block">
          {company ? (
            company.logoUrl ? (
              <img
                src={company.logoUrl}
                alt={company.name}
                className="h-24 w-auto max-w-72 object-contain"
              />
            ) : (
              <span className="text-3xl font-bold text-brand-900 dark:text-white">
                {company.name}
              </span>
            )
          ) : (
            <img
              src="/nts-wordmark.png"
              alt="NTS Transport"
              width={340}
              height={130}
              className="h-24 w-auto"
            />
          )}
        </Link>
        <h2 className="mt-5 text-4xl font-bold tracking-tight text-brand-900 xl:text-5xl dark:text-white">
          {company
            ? joining
              ? `Join ${company.name}`
              : `Welcome to ${company.name}`
            : 'Transport System'}
        </h2>
        <p className="mt-3 max-w-md text-base font-medium text-slate-800 xl:text-lg dark:text-slate-100">
          {company
            ? joining
              ? `Create your account to book ${company.name} trips and manage your tickets.`
              : `Sign in to book ${company.name} trips and manage your tickets.`
            : 'Sign in to manage companies, review activity and keep the platform running.'}
        </p>
        <ul className="mt-6 grid max-w-xl gap-x-6 gap-y-4 xl:mt-8 xl:grid-cols-2 xl:gap-y-5">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex items-center gap-3">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-white text-brand-600 shadow-level2">
                <f.icon aria-hidden="true" className="size-6" strokeWidth={1.8} />
              </span>
              <span>
                <span className="block text-sm font-semibold text-brand-900 dark:text-white">
                  {f.title}
                </span>
                <span className="block text-xs text-slate-700 dark:text-slate-300">{f.note}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="relative -mx-8 mt-auto xl:-mx-16">
        <img
          src="/auth-hero.jpg"
          alt=""
          width={860}
          height={310}
          className="max-h-[38dvh] w-full object-cover object-bottom [mask-image:linear-gradient(to_bottom,transparent,black_35%)]"
        />
        <ul className="absolute inset-x-0 bottom-0 grid grid-cols-3 gap-3 bg-gradient-to-t from-brand-900/90 to-transparent px-8 pb-4 pt-10 text-white xl:gap-4 xl:px-16 xl:pb-5">
          {TRUST.map((t) => (
            <li key={t.title} className="flex items-start gap-2.5">
              <t.icon aria-hidden="true" className="mt-0.5 size-6 shrink-0" strokeWidth={1.6} />
              <span>
                <span className="block text-xs font-semibold leading-snug xl:text-sm">
                  {t.title}
                </span>
                <span className="hidden text-xs text-slate-200 xl:block">{t.note}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

/**
 * Sign-in, sign-up and password pages: the hero on the left (large screens), the form card on the
 * right. On phones only the logo and the card show.
 */
export function AuthLayout() {
  const { slug } = useParams();
  const found = useQuery({
    queryKey: ['public-company', slug],
    enabled: Boolean(slug),
    retry: false,
    queryFn: ({ signal }) => api<PublicCompany>(`/public/companies/${slug}`, { signal }),
  });
  const company = found.data;
  useEffect(() => {
    if (company) rememberCompany(company.slug);
  }, [company]);
  if (slug && found.isPending) return <PageLoader label="Loading" full />;
  if (slug && !company) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <h1 className="text-2xl font-bold">Company not found</h1>
          <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
            There is no company at this web address, or it is not open yet.
          </p>
          <Link className="mt-4 inline-block font-semibold text-brand-600" to="/login">
            Go to the main sign-in page
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div
      style={company ? brandStyle(company.primaryColor, company.accentColor) : undefined}
      className={`min-h-dvh bg-gradient-to-br dark:from-brand-900 dark:via-slate-900 dark:to-slate-950 ${
        company ? 'from-brand-100 via-brand-50 to-white' : 'from-sky-200 via-sky-100 to-sky-50'
      }`}
    >
      <TopProgress />
      <MaintenanceBanner />
      <div className="mx-auto grid min-h-dvh max-w-[1500px] lg:grid-cols-[1.05fr_1fr]">
        <HeroPanel company={company} />
        <main
          id="main"
          className="relative flex min-w-0 flex-col items-center justify-center gap-4 px-4 pb-8 pt-16 sm:gap-5 sm:px-8"
        >
          <ThemeToggle className="absolute right-4 top-4" />
          <Link to={company ? `/${company.slug}` : '/'} aria-label="Home" className="lg:hidden">
            {company ? (
              company.logoUrl ? (
                <img
                  src={company.logoUrl}
                  alt={company.name}
                  className="h-16 w-auto max-w-56 object-contain"
                />
              ) : (
                <span className="text-2xl font-bold text-brand-900 dark:text-white">
                  {company.name}
                </span>
              )
            ) : (
              <img
                src="/nts-wordmark.png"
                alt="NTS Transport"
                width={340}
                height={130}
                className="h-16 w-auto"
              />
            )}
          </Link>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
