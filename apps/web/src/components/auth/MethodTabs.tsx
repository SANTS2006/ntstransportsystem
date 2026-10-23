export type Method = 'email' | 'phone';

/** Choose how to sign up or sign in: with an email address or a phone number. */
export function MethodTabs({
  value,
  onChange,
  label,
}: {
  value: Method;
  onChange: (m: Method) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
    >
      {(['email', 'phone'] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={value === m}
          onClick={() => onChange(m)}
          className={`min-h-10 rounded-md text-sm font-medium ${
            value === m
              ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-900 dark:text-brand-500'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
          }`}
        >
          {m === 'email' ? 'Email' : 'Phone number'}
        </button>
      ))}
    </div>
  );
}

/** Same wording wherever a phone number is asked for. */
export const PHONE_HINT = 'Orange, Africell and Qcell numbers all work. Example: 076 123 456';
