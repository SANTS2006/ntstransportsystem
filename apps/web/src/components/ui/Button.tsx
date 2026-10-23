import type { ComponentProps } from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'danger' | 'dangerQuiet' | 'ghost' | 'accent';

/** Primary is the brand fill with a darker hover; secondary is a bordered white button. */
const styles: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50',
  secondary:
    'border border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50 disabled:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50',
  /** For an action that undoes something, in a list where a solid red button would shout. */
  dangerQuiet:
    'border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:text-red-300 dark:border-red-900 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950',
  /** The second brand colour (orange in the platform theme): for the one thing that needs notice. */
  accent: 'bg-accent-600 text-white hover:bg-accent-700 disabled:bg-accent-600/50',
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
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...rest}
    >
      {loading && <Spinner size="sm" />}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}

/** Class string for a link that should look like a button (used with <Link>). */
export const linkButton = (variant: Variant = 'primary') =>
  `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-[15px] font-semibold transition-colors ${styles[variant]}`;
