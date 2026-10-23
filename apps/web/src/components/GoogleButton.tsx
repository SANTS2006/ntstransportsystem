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
          width: 400,
        });
      })
      .catch(() => undefined); // button simply stays absent; password sign-in still works
    return () => {
      cancelled = true;
    };
  }, [text]);

  if (!CLIENT_ID) {
    // Still shown, so people see the option; it cannot work until the server owner sets it up.
    return (
      <button
        type="button"
        disabled
        title="Google sign-in has not been set up on this server yet"
        className="flex min-h-12 w-full items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white text-[15px] font-semibold text-slate-400 dark:border-slate-700 dark:bg-slate-900"
      >
        <GoogleMark />
        {LABEL[text]}
        <span className="text-xs font-normal">(not set up yet)</span>
      </button>
    );
  }
  return (
    <div ref={host} className="flex min-h-10 justify-center" aria-label="Sign in with Google" />
  );
}

const LABEL = {
  signin_with: 'Sign in with Google',
  signup_with: 'Sign up with Google',
  continue_with: 'Continue with Google',
} as const;

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"
      />
      <path
        fill="#FBBC05"
        d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 12-2.1 16-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}

export const googleEnabled = Boolean(CLIENT_ID);
