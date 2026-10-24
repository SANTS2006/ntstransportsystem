import { createContext, useContext } from 'react';
import { Link } from 'react-router';

export interface AuthCompany {
  name: string;
  slug: string;
  logoUrl: string | null;
}

/** Set by the sign-in layout when the page belongs to a company, so the form card can show its logo. */
export const AuthCompanyContext = createContext<AuthCompany | null>(null);

/**
 * The logo at the top of the form card on phones and tablets (large screens show it in the panel
 * beside the card). Links home: the company's own page, or the system's.
 */
export function AuthBrandLogo({ className = '' }: { className?: string }) {
  const company = useContext(AuthCompanyContext);
  return (
    <Link
      to={company ? `/${company.slug}` : '/'}
      aria-label="Home"
      className={`inline-block lg:hidden ${className}`}
    >
      {company ? (
        company.logoUrl ? (
          <img
            src={company.logoUrl}
            alt={company.name}
            className="h-14 w-auto max-w-56 object-contain"
          />
        ) : (
          <span className="text-2xl font-bold text-brand-900 dark:text-white">{company.name}</span>
        )
      ) : (
        <img
          src="/nts-wordmark.png"
          alt="NTS Transport"
          width={340}
          height={130}
          className="h-14 w-auto"
        />
      )}
    </Link>
  );
}
