import { useCallback, useEffect, useState } from 'react';

export type Mode = 'light' | 'dark';
const KEY = 'nts-theme';

const prefersDark = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

function saved(): Mode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

/** The mode the page is in now: the person's choice, otherwise whatever their system uses. */
export function currentMode(): Mode {
  return saved() ?? (prefersDark() ? 'dark' : 'light');
}

export function applyMode(mode: Mode): void {
  document.documentElement.classList.toggle('dark', mode === 'dark');
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', mode === 'dark' ? '#0b1220' : '#0075df');
}

/** Light or dark, remembered on this device. Until a choice is made it follows the system. */
export function useThemeMode(): { mode: Mode; toggle: () => void } {
  const [mode, setMode] = useState<Mode>(currentMode);
  useEffect(() => {
    applyMode(mode);
  }, [mode]);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const q = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (!saved()) setMode(q.matches ? 'dark' : 'light');
    };
    q.addEventListener('change', onChange);
    return () => q.removeEventListener('change', onChange);
  }, []);
  const toggle = useCallback(() => {
    setMode((m) => {
      const next: Mode = m === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* the choice just is not remembered */
      }
      return next;
    });
  }, []);
  return { mode, toggle };
}
