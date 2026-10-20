import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigation } from 'react-router';

const MAX_VISIBLE_MS = 15_000;

/**
 * Branded global activity bar. It reflects route transitions and in-flight requests, and is
 * forcibly hidden after MAX_VISIBLE_MS so it can never be stuck on.
 */
export function TopProgress() {
  const navigation = useNavigation();
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const busy = navigation.state !== 'idle' || fetching > 0 || mutating > 0;
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!busy) {
      setExpired(false);
      return;
    }
    const t = setTimeout(() => setExpired(true), MAX_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [busy]);

  const visible = busy && !expired;
  return (
    <div
      aria-hidden="true"
      className={`fixed inset-x-0 top-0 z-50 h-1 overflow-hidden transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      <div className="h-full w-1/3 animate-[nts-bar_1.1s_ease-in-out_infinite] rounded-r bg-brand-600 motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-60" />
    </div>
  );
}
