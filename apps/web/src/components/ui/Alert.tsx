import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError } from '../../lib/api';

type Tone = 'error' | 'success' | 'info' | 'warning';

const tones: Record<Tone, string> = {
  error:
    'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100',
  success:
    'border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100',
  info: 'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
  warning:
    'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100',
};
const icons = { error: XCircle, success: CheckCircle2, info: Info, warning: AlertTriangle };
const iconTones: Record<Tone, string> = {
  error: 'text-red-600',
  success: 'text-green-600',
  info: 'text-brand-600',
  warning: 'text-amber-600',
};

export function Alert({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  const Icon = icons[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex gap-3 rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}
    >
      <Icon
        aria-hidden="true"
        className={`mt-0.5 size-5 shrink-0 ${iconTones[tone]}`}
        strokeWidth={1.8}
      />
      <div className="min-w-0">{children}</div>
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
        <button type="button" onClick={onRetry} className="mt-2 text-xs font-medium font-medium">
          Try again
        </button>
      )}
    </Alert>
  );
}
