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
import { Link, Outlet, useLocation, useParams } from 'react-router';
import { PageLoader } from '../ui/Spinner';
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
    <aside className="relative hidden flex-col justify-between overflow-hidden px-10 pt-12 lg:flex xl:px-16">
      <div>
        <Link to="/" aria-label="NTS Transport home" className="inline-block">
          {company ? (
            company.logoUrl ? (
              <img
                src={company.logoUrl}
                alt={company.name}
                className="h-24 w-auto max-w-72 object-contain"
              />
            ) : (
              <span className="text-3xl font-bold text-brand-900">{company.name}</span>
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
        <h2 className="mt-6 text-5xl font-bold tracking-tight text-brand-900">
          {company
            ? joining
              ? `Join ${company.name}`
              : `Welcome to ${company.name}`
            : joining
              ? 'Join NTS'
              : 'Welcome Back'}
        </h2>
        <p className="mt-3 max-w-md text-lg text-slate-700">
          {company
            ? joining
              ? `Create your account to book ${company.name} trips and manage your tickets.`
              : `Sign in to book ${company.name} trips and manage your tickets.`
            : joining
              ? 'Create your account to book trips, or to join the transport company that invited you.'
              : 'Sign in to your account to book trips or manage your transport operations.'}
        </p>
        <ul className="mt-8 grid max-w-xl grid-cols-2 gap-x-6 gap-y-5">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex items-center gap-3">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-white text-brand-600 shadow-level2">
                <f.icon aria-hidden="true" className="size-6" strokeWidth={1.8} />
              </span>
              <span>
                <span className="block text-sm font-semibold text-brand-900">{f.title}</span>
                <span className="block text-xs text-slate-600">{f.note}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="relative -mx-10 mt-8 xl:-mx-16">
        <img
          src="/auth-hero.jpg"
          alt=""
          width={860}
          height={310}
          className="w-full object-cover [mask-image:linear-gradient(to_bottom,transparent,black_35%)]"
        />
        <ul className="absolute inset-x-0 bottom-0 grid grid-cols-3 gap-4 bg-gradient-to-t from-brand-900/90 to-transparent px-10 pb-5 pt-10 text-white xl:px-16">
          {TRUST.map((t) => (
            <li key={t.title} className="flex items-start gap-2.5">
              <t.icon aria-hidden="true" className="mt-0.5 size-6 shrink-0" strokeWidth={1.6} />
              <span>
                <span className="block text-sm font-semibold leading-snug">{t.title}</span>
                <span className="block text-xs text-slate-200">{t.note}</span>
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
  if (slug && found.isPending) return <PageLoader label="Loading" full />;
  if (slug && !company) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <h1 className="text-2xl font-bold">Company not found</h1>
          <p className="mt-2 text-sm text-slate-600">
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
          className="flex flex-col items-center justify-center gap-5 px-4 py-8 sm:px-8"
        >
          <Link to="/" aria-label="NTS Transport home" className="lg:hidden">
            {company ? (
              company.logoUrl ? (
                <img
                  src={company.logoUrl}
                  alt={company.name}
                  className="h-16 w-auto max-w-56 object-contain"
                />
              ) : (
                <span className="text-2xl font-bold text-brand-900">{company.name}</span>
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
