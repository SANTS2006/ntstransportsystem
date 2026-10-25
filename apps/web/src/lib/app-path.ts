import { rememberedCompany } from './company-page';

/**
 * Every account except a platform administrator belongs to one company, and its passenger pages
 * live under that company's address: /<company>/app/... The company is set when the signed-in
 * account is known; an account with no company falls back to the plain /app address.
 */
let current: string | null = null;
export function setAppCompany(slug: string | null | undefined): void {
  current = slug ?? null;
}
export function appRoot(): string {
  const s = current ?? rememberedCompany();
  return s ? `/${s}/app` : '/app';
}
