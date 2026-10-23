import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

interface Status {
  enabled: boolean;
  message: string | null;
  since: string | null;
}

/**
 * Shown on every page while the platform is in maintenance mode. The status endpoint stays up
 * during maintenance, so this keeps working when everything else answers 503.
 */
export function MaintenanceBanner() {
  const q = useQuery({
    queryKey: ['maintenance-status'],
    queryFn: ({ signal }) => api<Status>('/maintenance-status', { signal }),
    refetchInterval: 60_000,
    retry: false,
    staleTime: 30_000,
  });
  if (!q.data?.enabled) return null;
  return (
    <div
      role="status"
      className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-100"
    >
      <strong>Maintenance:</strong> {q.data.message ?? 'The service is temporarily unavailable.'}
    </div>
  );
}
