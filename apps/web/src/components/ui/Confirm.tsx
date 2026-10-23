import { TriangleAlert } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  /** The words on the button that goes ahead ("Delete route"). */
  confirmLabel?: string;
  /** Red button for something that cannot be undone. */
  danger?: boolean;
}
type Ask = (o: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

/** One shared "are you sure?" pop-up for the whole app, asked with `await ask({...})`. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const ask = useCallback<Ask>(
    (o) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setOpts(o);
      }),
    [],
  );
  const answer = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  };
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <Dialog open={opts !== null} title={opts?.title ?? ''} onClose={() => answer(false)}>
        {opts && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              {opts.danger && (
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                  <TriangleAlert aria-hidden="true" className="size-5" strokeWidth={1.8} />
                </span>
              )}
              <div className="text-sm text-slate-700 dark:text-slate-300">{opts.message}</div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => answer(false)}>
                Cancel
              </Button>
              <Button variant={opts.danger ? 'danger' : 'primary'} onClick={() => answer(true)}>
                {opts.confirmLabel ?? 'Confirm'}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

/**
 * Returns the function that asks. Outside the provider (a page rendered on its own in a test) it
 * falls back to the browser's own question, so nothing is ever done without being asked.
 */
export function useConfirm(): Ask {
  const ctx = useContext(ConfirmContext);
  return (
    ctx ??
    ((o) => Promise.resolve(window.confirm(typeof o.message === 'string' ? o.message : o.title)))
  );
}
