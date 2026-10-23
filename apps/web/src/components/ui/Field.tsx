import { useId, type ComponentProps } from 'react';

interface FieldProps extends Omit<ComponentProps<'input'>, 'id'> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}

/** Labelled input wired for accessibility: label, hint and error are all programmatically linked. */
export function Field({ label, error, hint, className = '', ...rest }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errId].filter(Boolean).join(' ') || undefined}
        className={`block min-h-11 w-full rounded-lg border bg-white px-3 py-2 text-[15px] text-slate-900 focus:border-brand-600 placeholder:text-slate-400 dark:bg-slate-900 dark:text-slate-100 ${
          error ? 'border-red-600' : 'border-slate-300 dark:border-slate-600'
        } ${className}`}
        {...rest}
      />
      {hint && !error && (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
