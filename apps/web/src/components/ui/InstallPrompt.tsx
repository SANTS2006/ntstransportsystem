import { Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from './Button';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const KEY = 'nts-install-dismissed';
const dismissed = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

/** Offers to install the app on the home screen when the browser says it can. */
export function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      if (!dismissed()) setEvent(e as InstallEvent);
    };
    const onInstalled = () => setEvent(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!event) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* private mode: just hide it for now */
    }
    setEvent(null);
  };
  return (
    <div
      role="region"
      aria-label="Install the app"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-white p-3 shadow-level3 dark:bg-slate-900"
    >
      <img src="/icon-192.png" alt="" width={44} height={44} className="size-11 rounded-lg" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">Install NTS Transport</p>
        <p className="text-slate-600 dark:text-slate-300">Open it from your home screen.</p>
      </div>
      <Button
        onClick={() => {
          void event.prompt();
          void event.userChoice.then(() => setEvent(null));
        }}
      >
        <Download aria-hidden="true" className="size-4" strokeWidth={1.8} />
        Install
      </Button>
      <button
        type="button"
        aria-label="Not now"
        onClick={close}
        className="grid size-8 place-items-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
