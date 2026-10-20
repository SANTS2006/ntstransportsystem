import { useEffect, useRef } from 'react';

interface GoogleIdApi {
  initialize: (cfg: { client_id: string; callback: (r: { credential: string }) => void }) => void;
  renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const SRC = 'https://accounts.google.com/gsi/client';
let scriptPromise: Promise<void> | undefined;

function loadGsi(): Promise<void> {
  scriptPromise ??= new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scriptPromise = undefined; // allow a later retry
      reject(new Error('Google sign-in failed to load'));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

/**
 * Google Identity Services button. The browser only ever receives an ID token (`credential`) and
 * hands it to our backend, which verifies it. Nothing in the token is trusted client-side.
 * Renders nothing when VITE_GOOGLE_CLIENT_ID is not configured.
 */
export function GoogleButton({
  onCredential,
  text = 'continue_with',
}: {
  onCredential: (credential: string) => void;
  text?: 'signin_with' | 'signup_with' | 'continue_with';
}) {
  const host = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;

  useEffect(() => {
    if (!CLIENT_ID || !host.current) return;
    let cancelled = false;
    loadGsi()
      .then(() => {
        if (cancelled || !host.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (r) => cb.current(r.credential),
        });
        window.google.accounts.id.renderButton(host.current, {
          theme: 'outline',
          size: 'large',
          text,
          width: 320,
        });
      })
      .catch(() => undefined); // button simply stays absent; password sign-in still works
    return () => {
      cancelled = true;
    };
  }, [text]);

  if (!CLIENT_ID) return null;
  return (
    <div ref={host} className="flex min-h-10 justify-center" aria-label="Sign in with Google" />
  );
}

export const googleEnabled = Boolean(CLIENT_ID);
