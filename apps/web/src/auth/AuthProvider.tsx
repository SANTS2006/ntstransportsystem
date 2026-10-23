import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';

export interface Me {
  id: string;
  email: string | null;
  phone?: string | null;
  phoneVerifiedAt?: string | null;
  displayName: string;
  emailVerifiedAt: string | null;
  mfaEnabled: boolean;
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

  const value = useMemo<AuthState>(
    () => ({
      user: query.data ?? null,
      loading: query.isPending,
      error: query.isError ? query.error : null,
      refresh: async () => {
        await qc.invalidateQueries({ queryKey: ME_KEY });
      },
      clear: () => {
        qc.setQueryData(ME_KEY, null);
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' }); // drop cached tenant data
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
