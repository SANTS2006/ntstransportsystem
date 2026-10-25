import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

/** Tells people the connection is gone, so a button that does nothing is not a mystery. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' && navigator.onLine === false,
  );
  useEffect(() => {
    const down = () => setOffline(true);
    const up = () => setOffline(false);
    window.addEventListener('offline', down);
    window.addEventListener('online', up);
    return () => {
      window.removeEventListener('offline', down);
      window.removeEventListener('online', up);
    };
  }, []);
  if (!offline) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-3 top-3 z-[60] mx-auto flex max-w-md items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-level3"
    >
      <WifiOff aria-hidden="true" className="size-4 shrink-0" />
      You are offline. Changes cannot be saved until the connection is back.
    </div>
  );
}
