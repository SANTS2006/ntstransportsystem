import { useQuery } from '@tanstack/react-query';
import { Compass, LogIn } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { linkButton } from '../components/ui/Button';
import { PageLoader } from '../components/ui/Spinner';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { api } from '../lib/api';
import { useDocumentBrand } from '../lib/document-brand';
import { brandStyle } from '../lib/theme';

interface Company {
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
}

/**
 * The page for an address that does not exist. Inside a company's address it wears the company's
 * name, logo and colours and its only button leads to that company's sign-in page; anywhere else
 * it is the system's, and its button leads to the main sign-in page.
 */
export default function NotFoundPage({ company }: { company?: Company | null | undefined }) {
  useDocumentBrand(company ?? null);
  return (
    <div
      style={company ? brandStyle(company.primaryColor, company.accentColor) : undefined}
      className={`relative grid min-h-dvh place-items-center bg-gradient-to-br p-6 dark:from-brand-900 dark:via-slate-900 dark:to-slate-950 ${
        company ? 'from-brand-100 via-white to-brand-50' : 'from-sky-100 via-white to-sky-50'
      }`}
    >
      <ThemeToggle className="absolute right-4 top-4" />
      <main
        id="main"
        className="w-full max-w-lg space-y-6 rounded-3xl bg-white p-8 text-center shadow-level3 sm:p-10 dark:bg-slate-900"
      >
        {company ? (
          company.logoUrl ? (
            <img
              src={company.logoUrl}
              alt={company.name}
              className="mx-auto h-16 w-auto max-w-56 object-contain"
            />
          ) : (
            <p className="text-2xl font-bold text-brand-800 dark:text-white">{company.name}</p>
          )
        ) : (
          <img
            src="/nts-wordmark.png"
            alt="NTS Transport"
            width={340}
            height={130}
            className="mx-auto h-14 w-auto"
          />
        )}
        <div className="space-y-2">
          <p className="flex items-center justify-center gap-2 text-7xl font-extrabold leading-none tracking-tight text-brand-600">
            4
            <Compass aria-hidden="true" className="size-14 text-accent-500" strokeWidth={1.6} />4
          </p>
          <h1 className="text-2xl font-bold text-brand-900 dark:text-white">Page not found</h1>
          <p className="text-slate-700 dark:text-slate-300">
            The page you are looking for does not exist, or it has moved.{' '}
            {company ? `Sign in to ${company.name} to carry on.` : 'Sign in to carry on.'}
          </p>
        </div>
        <div className="flex justify-center">
          <Link
            to={company ? `/${company.slug}/login` : '/login'}
            className={`${linkButton('primary')} w-full sm:w-auto`}
          >
            <LogIn aria-hidden="true" className="size-4" strokeWidth={1.8} />
            Go to login
          </Link>
        </div>
      </main>
    </div>
  );
}

/**
 * An unknown page under a company's address (/<company>/anything): the company's own 404 when
 * the company exists, the system's otherwise.
 */
export function CompanyNotFoundPage() {
  const { slug } = useParams();
  const found = useQuery({
    queryKey: ['public-company', slug],
    enabled: Boolean(slug),
    retry: false,
    queryFn: ({ signal }) => api<Company>(`/public/companies/${slug}`, { signal }),
  });
  if (slug && found.isPending) return <PageLoader label="Loading" full />;
  return <NotFoundPage company={found.data ?? null} />;
}
