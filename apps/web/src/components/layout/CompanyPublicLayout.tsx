import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../../lib/api';
import { rememberCompany } from '../../lib/company-page';
import { CompanyPublicContext, type PublicCompany } from '../../lib/company-public';
import { brandStyle } from '../../lib/theme';
import { PageLoader } from '../ui/Spinner';
import { PublicLayout } from './Layouts';

/**
 * A company's own public site at /<web-address-name>: its trips and jobs, with its logo, name and
 * colours, and sign-in and sign-up buttons that lead to that company's own pages.
 */
export function CompanyPublicLayout() {
  const { slug } = useParams();
  const found = useQuery({
    queryKey: ['public-company', slug],
    retry: false,
    queryFn: ({ signal }) => api<PublicCompany>(`/public/companies/${slug}`, { signal }),
  });
  const company = found.data;
  useEffect(() => {
    if (company) rememberCompany(company.slug);
  }, [company]);
  if (found.isPending) return <PageLoader label="Loading" full />;
  if (!company) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <h1 className="text-2xl font-bold">Page not found</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            There is no company at this web address, or it is not open yet.
          </p>
          <Link className="mt-4 inline-block font-semibold text-brand-600" to="/login">
            Go to the sign-in page
          </Link>
        </div>
      </div>
    );
  }
  return (
    <CompanyPublicContext.Provider value={company}>
      <div style={brandStyle(company.primaryColor, company.accentColor)}>
        <PublicLayout
          company={{
            name: company.name,
            logoUrl: company.logoUrl,
            primary: company.primaryColor,
            accent: company.accentColor,
          }}
          base={`/${company.slug}`}
        />
      </div>
    </CompanyPublicContext.Provider>
  );
}
