import { BarChart3, Bus, Ticket, Users, type LucideIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { rememberCompany } from '../../lib/company-page';
import { useDocumentBrand } from '../../lib/document-brand';
import { Link, Outlet, useLocation, useParams } from 'react-router';
import NotFoundPage from '../../pages/NotFoundPage';
import { PageLoader } from '../ui/Spinner';
import { ThemeToggle } from '../ui/ThemeToggle';
import { AuthCompanyContext } from './AuthBrand';
import { api } from '../../lib/api';
import { brandStyle } from '../../lib/theme';
import { MaintenanceBanner } from './MaintenanceBanner';

const FEATURES: { icon: LucideIcon; title: string; note: string }[] = [
  { icon: Bus, title: 'Manage Fleet', note: 'Buses, taxis and more' },
  { icon: Ticket, title: 'Sell Tickets', note: 'Online and at terminals' },
  { icon: Users, title: 'Manage Staff', note: 'Drivers, conductors and staff' },
  { icon: BarChart3, title: 'Grow Your Business', note: 'Reports and analytics' },
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
    <aside className="relative hidden flex-col justify-center gap-6 overflow-hidden px-8 py-10 lg:flex xl:px-16">
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
  useDocumentBrand(company);
  useEffect(() => {
    if (company) rememberCompany(company.slug);
  }, [company]);
  if (slug && found.isPending) return <PageLoader label="Loading" full />;
  if (slug && !company) return <NotFoundPage />;
  return (
    <div
      style={company ? brandStyle(company.primaryColor, company.accentColor) : undefined}
      className={`min-h-dvh bg-gradient-to-br dark:from-brand-900 dark:via-slate-900 dark:to-slate-950 ${
        company ? 'from-brand-100 via-brand-50 to-white' : 'from-sky-200 via-sky-100 to-sky-50'
      }`}
    >
      <MaintenanceBanner />
      <div className="mx-auto grid min-h-dvh max-w-[1500px] lg:grid-cols-[1.05fr_1fr]">
        <HeroPanel company={company} />
        <main
          id="main"
          className="relative flex min-w-0 flex-col items-center justify-center gap-4 px-4 pb-8 pt-14 sm:gap-5 sm:px-8 lg:pt-16"
        >
          <ThemeToggle className="absolute right-4 top-4" />
          <AuthCompanyContext.Provider value={company ?? null}>
            <div className="flex w-full justify-center">
              <Outlet />
            </div>
          </AuthCompanyContext.Provider>
        </main>
      </div>
    </div>
  );
}
