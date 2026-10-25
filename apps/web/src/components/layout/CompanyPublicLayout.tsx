import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useParams } from 'react-router';
import { api } from '../../lib/api';
import { rememberCompany } from '../../lib/company-page';
import { useDocumentBrand } from '../../lib/document-brand';
import { CompanyPublicContext, type PublicCompany } from '../../lib/company-public';
import { brandStyle } from '../../lib/theme';
import NotFoundPage from '../../pages/NotFoundPage';
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
  useDocumentBrand(company);
  useEffect(() => {
    if (company) rememberCompany(company.slug);
  }, [company]);
  if (found.isPending) return <PageLoader label="Loading" full />;
  if (!company) return <NotFoundPage />;
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
