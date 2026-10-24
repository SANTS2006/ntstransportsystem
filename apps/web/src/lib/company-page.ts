/**
 * Where people sign in. Platform administrators use the main page (/login); everyone else uses
 * the page of their own company (/<web-address-name>/login). The company a browser last used is
 * remembered so that expired sessions and links lead back to the right page.
 */
const KEY = 'nts-company';

export function rememberCompany(slug: string): void {
  try {
    localStorage.setItem(KEY, slug);
  } catch {
    /* not remembered */
  }
}
export function rememberedCompany(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

interface Who {
  platformRoles?: string[];
  homeCompany?: { slug: string } | null;
}

function companyOf(user?: Who | null, slug?: string | null): string | null {
  return slug ?? user?.homeCompany?.slug ?? rememberedCompany();
}

/** The sign-in page this person (or this company, when a slug is given) should be sent to. */
export function signInPath(user?: Who | null, slug?: string | null): string {
  if (!slug && user?.platformRoles?.length) return '/login';
  const s = companyOf(user, slug);
  return s ? `/${s}/login` : '/login';
}

/** The sign-up page for a company. Without a known company there is none: the main page has no sign-up. */
export function signUpPath(user?: Who | null, slug?: string | null): string {
  const s = companyOf(user, slug);
  return s ? `/${s}/register` : '/login';
}

/**
 * A page inside this person's company's public site (for example "/trips"), or the sign-in page
 * when no company is known. There is no system-wide trip or job listing: only companies have one.
 */
export function companyPath(user?: Who | null, sub = ''): string {
  const s = user?.homeCompany?.slug ?? rememberedCompany();
  return s ? `/${s}${sub}` : '/login';
}
