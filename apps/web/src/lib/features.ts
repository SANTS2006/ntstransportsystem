import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface Features {
  fileUploads: boolean;
  /** Sign up and sign in with a phone number (a text-message provider is configured). */
  phoneSignup: boolean;
  /** Google OAuth client ID when Google sign-in is set up on the server, otherwise null. */
  googleClientId: string | null;
}

/** What this server can do. Anything unknown (or an unreachable server) counts as off. */
export function useFeatures(): Features {
  const q = useQuery({
    queryKey: ['features'],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: ({ signal }) => api<Partial<Features>>('/features', { signal }),
  });
  return {
    fileUploads: q.data?.fileUploads === true,
    phoneSignup: q.data?.phoneSignup === true,
    googleClientId: q.data?.googleClientId || null,
  };
}
