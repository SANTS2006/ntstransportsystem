import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { signInPath, signUpPath } from './company-page';

/**
 * Sign-in and sign-up links for the company a page is about (a trip, a job), found from its id, so
 * a visitor is sent to that company's own pages. Until it is known, the last company this browser
 * used is the fallback.
 */
export function useCompanyLinks(tenantId: string | undefined) {
  const q = useQuery({
    queryKey: ['company-by-id', tenantId],
    enabled: Boolean(tenantId),
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: ({ signal }) =>
      api<{ id: string; name: string; slug: string }>(`/public/company-by-id/${tenantId}`, {
        signal,
      }),
  });
  const slug = q.data?.slug ?? null;
  return {
    signIn: (next?: string) => {
      const base = signInPath(null, slug);
      return next ? `${base}?next=${encodeURIComponent(next)}` : base;
    },
    signUp: signUpPath(null, slug),
  };
}
