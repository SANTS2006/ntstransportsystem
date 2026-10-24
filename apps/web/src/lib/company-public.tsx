import { createContext, useContext } from 'react';

/** The company whose public pages (its trips and jobs) are being shown, when inside them. */
export interface PublicCompany {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
}

export const CompanyPublicContext = createContext<PublicCompany | null>(null);

/** The company of the page, or null on the system-wide pages. */
export const useCompanyPublic = () => useContext(CompanyPublicContext);
