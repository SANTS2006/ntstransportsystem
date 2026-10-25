import { rememberedCompany } from './company-page';

/**
 * Every account except a platform administrator belongs to one company, and everything that
 * account sees (dashboard, bookings, staff pages ...) lives directly under the company's web
 * address: /<company>/dashboard. The company is set from the address in the browser; before that
 * it comes from the signed-in account.
 */
let current: string | null = null;
export function setAppCompany(slug: string | null | undefined): void {
  current = slug ?? null;
}
export function appRoot(): string {
  const s = current ?? rememberedCompany();
  return s ? `/${s}` : '/app';
}
