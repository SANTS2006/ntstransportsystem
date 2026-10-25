import { Eye, EyeOff, Lock, type LucideIcon } from 'lucide-react';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';

interface FieldProps extends Omit<ComponentProps<'input'>, 'id'> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  /** An icon shown inside the left edge of the box. */
  icon?: LucideIcon;
  /** Anything shown inside the right edge (for example the show-password button). */
  trailing?: ReactNode;
}

/** Labelled input wired for accessibility: label, hint and error are all programmatically linked. */
export function Field({
  label,
  error,
  hint,
  icon: Icon,
  trailing,
  className = '',
  ...rest
}: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className="block text-sm font-semibold text-slate-900 dark:text-slate-100"
      >
        {label}
      </label>
      <div className="relative">
        {Icon && (
          <Icon
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-slate-500"
            strokeWidth={1.8}
          />
        )}
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errId].filter(Boolean).join(' ') || undefined}
          className={`block min-h-11 w-full rounded-lg border bg-white py-2 text-base text-slate-900 transition-shadow focus:border-brand-600 focus:shadow-[0_0_0_3px_rgb(0_117_223/0.15)] placeholder:text-slate-500 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400 ${
            Icon ? 'pl-10' : 'pl-3'
          } ${trailing ? 'pr-11' : 'pr-3'} ${
            error ? 'border-red-600' : 'border-slate-300 dark:border-slate-600'
          } ${className}`}
          {...rest}
        />
        {trailing && <div className="absolute right-1 top-1/2 -translate-y-1/2">{trailing}</div>}
      </div>
      {hint && !error && (
        <p id={hintId} className="text-xs text-slate-700 dark:text-slate-300">
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

/** A password box with a button that shows or hides what was typed. */
export function PasswordField(props: Omit<FieldProps, 'type' | 'trailing'>) {
  const [shown, setShown] = useState(false);
  return (
    <Field
      icon={Lock}
      {...props}
      type={shown ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          onClick={() => setShown((v) => !v)}
          className="grid size-9 place-items-center rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
        >
          {shown ? (
            <EyeOff aria-hidden="true" className="size-[18px]" strokeWidth={1.8} />
          ) : (
            <Eye aria-hidden="true" className="size-[18px]" strokeWidth={1.8} />
          )}
        </button>
      }
    />
  );
}
