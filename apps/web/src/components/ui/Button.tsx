import type { ComponentProps } from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const styles: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-600 disabled:bg-brand-700/60',
  secondary:
    'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-600 dark:hover:bg-slate-700',
  danger: 'bg-red-700 text-white hover:bg-red-600 disabled:bg-red-700/60',
  ghost:
    'text-brand-700 hover:bg-brand-50 disabled:text-slate-400 dark:text-brand-500 dark:hover:bg-slate-800',
};

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: Variant;
  /** Shows an activity indicator and blocks further clicks (prevents double submission). */
  loading?: boolean;
  loadingText?: string;
}

export function Button({
  variant = 'primary',
  loading = false,
  loadingText,
  disabled,
  children,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...rest}
    >
      {loading && <Spinner size="sm" />}
      <span>{loading && loadingText ? loadingText : children}</span>
    </button>
  );
}
