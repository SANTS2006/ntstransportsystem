import type { ReactNode } from 'react';
import { ApiError } from '../../lib/api';

type Tone = 'error' | 'success' | 'info' | 'warning';

const tones: Record<Tone, string> = {
  error:
    'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100',
  success:
    'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
  info: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100',
  warning:
    'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100',
};

export function Alert({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}
    >
      {children}
    </div>
  );
}

/** Renders an error from the API client, with the request ID to quote to support when available. */
export function ErrorAlert({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const api = error instanceof ApiError ? error : null;
  const message = api?.message ?? 'Something went wrong. Please try again.';
  return (
    <Alert tone="error">
      <p>{message}</p>
      {api?.requestId && api.status >= 500 && (
        <p className="mt-1 text-xs opacity-80">Reference: {api.requestId}</p>
      )}
      {onRetry && (api?.retryable ?? true) && (
        <button type="button" onClick={onRetry} className="mt-2 text-xs font-medium underline">
          Try again
        </button>
      )}
    </Alert>
  );
}
