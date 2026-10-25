import { Compass, Home, LogIn } from 'lucide-react';
import { Link } from 'react-router';
import { linkButton } from '../components/ui/Button';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { signInPath } from '../lib/company-page';

/** Shown for any address that does not exist, anywhere in the system. */
export default function NotFoundPage() {
  return (
    <div className="relative grid min-h-dvh place-items-center bg-gradient-to-br from-sky-100 via-white to-sky-50 p-6 dark:from-brand-900 dark:via-slate-900 dark:to-slate-950">
      <ThemeToggle className="absolute right-4 top-4" />
      <main
        id="main"
        className="w-full max-w-lg space-y-6 rounded-3xl bg-white p-8 text-center shadow-level3 sm:p-10 dark:bg-slate-900"
      >
        <img
          src="/nts-wordmark.png"
          alt="NTS Transport"
          width={340}
          height={130}
          className="mx-auto h-14 w-auto"
        />
        <div className="space-y-2">
          <p className="flex items-center justify-center gap-2 text-7xl font-extrabold leading-none tracking-tight text-brand-600">
            4
            <Compass aria-hidden="true" className="size-14 text-accent-500" strokeWidth={1.6} />4
          </p>
          <h1 className="text-2xl font-bold text-brand-900 dark:text-white">Page not found</h1>
          <p className="text-slate-700 dark:text-slate-300">
            The page you are looking for does not exist, or it has moved. Check the address, or go
            back to a page that works.
          </p>
        </div>
        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <Link to="/" className={linkButton('primary')}>
            <Home aria-hidden="true" className="size-4" strokeWidth={1.8} />
            Go to home
          </Link>
          <Link to={signInPath()} className={linkButton('secondary')}>
            <LogIn aria-hidden="true" className="size-4" strokeWidth={1.8} />
            Go to login
          </Link>
        </div>
      </main>
    </div>
  );
}
