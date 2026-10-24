import { Moon, Sun } from 'lucide-react';
import { useThemeMode } from '../../lib/theme-mode';

/** A sun/moon button that switches between light and dark mode. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { mode, toggle } = useThemeMode();
  const dark = mode === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      className={`grid size-10 place-items-center rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 ${className}`}
    >
      {dark ? (
        <Sun aria-hidden="true" className="size-5" strokeWidth={1.8} />
      ) : (
        <Moon aria-hidden="true" className="size-5" strokeWidth={1.8} />
      )}
    </button>
  );
}
