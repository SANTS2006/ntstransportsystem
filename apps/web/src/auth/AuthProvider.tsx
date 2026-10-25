import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import { setAppCompany } from '../lib/app-path';

export interface Me {
  id: string;
  email: string | null;
  phone?: string | null;
  phoneVerifiedAt?: string | null;
  displayName: string;
  emailVerifiedAt: string | null;
  mfaEnabled: boolean;
  /** A first password made by someone else: it has to be replaced before anything else works. */
  mustChangePassword?: boolean;
  /** Changes whenever the profile picture does (null: no picture). */
  avatarVersion?: number | null;
  /** The company this account signed up with (null for platform staff). */
  homeCompany?: { id: string; name: string; slug: string } | null;
  identities: { provider: string }[];
  platformRoles: string[];
}

interface AuthState {
  user: Me | null;
  loading: boolean;
  /** Set when the session check itself failed (not merely "signed out"). */
  error: ApiError | null;
  refresh: () => Promise<void>;
  clear: () => void;
}

const AuthContext = createContext<AuthState | null>(null);
export const ME_KEY = ['me'] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const query = useQuery<Me | null, ApiError>({
    queryKey: ME_KEY,
    queryFn: async ({ signal }) => {
      // The readable `csrf` cookie is set only while signed in, so its absence means signed out
      // and we can skip a request that would just return 401 (saves data on slow connections).
      // It is a hint only: the server remains the authority on whether a session is valid.
      if (!document.cookie.split('; ').some((c) => c.startsWith('csrf='))) return null;
      try {
        return await api<Me>('/auth/me', { signal });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null; // signed out is a normal state
        throw e;
      }
    },
    retry: (count, err) => err.retryable && count < 2,
    staleTime: 60_000,
  });

  // Back/forward and tab switches can show a page kept from before sign-out. The readable `csrf`
  // cookie exists only while signed in, so when it is gone the person is signed out here too and
  // the protected page gives way to the sign-in page.
  useEffect(() => {
    const recheck = () => {
      const signedIn = document.cookie.split('; ').some((c) => c.startsWith('csrf='));
      if (!signedIn && qc.getQueryData(ME_KEY)) {
        void qc.cancelQueries();
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
        qc.setQueryData(ME_KEY, null);
      } else if (signedIn && !qc.getQueryData(ME_KEY)) {
        void qc.invalidateQueries({ queryKey: ME_KEY });
      }
    };
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) recheck();
    };
    window.addEventListener('pageshow', onShow);
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('pageshow', onShow);
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [qc]);

  // The passenger pages live under the company the account belongs to.
  setAppCompany(query.data?.homeCompany?.slug);
  const value = useMemo<AuthState>(
    () => ({
      user: query.data ?? null,
      loading: query.isPending,
      error: query.isError ? query.error : null,
      refresh: async () => {
        await qc.invalidateQueries({ queryKey: ME_KEY });
      },
      clear: () => {
        // Nothing of the finished session survives: cached screens, drafts and pending requests.
        void qc.cancelQueries();
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
        qc.setQueryData(ME_KEY, null);
        try {
          sessionStorage.clear();
        } catch {
          /* storage unavailable */
        }
      },
    }),
    [query.data, query.isPending, query.isError, query.error, qc],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
