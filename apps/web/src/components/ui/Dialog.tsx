import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Pop-up built on the native <dialog> element, which provides focus trapping, Escape-to-close and
 * an inert page behind it. It is 40% of the screen wide on laptops and desktops, and nearly the
 * whole width on phones and tablets where 40% would be too narrow to use.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // click on the backdrop
      }}
      className="m-auto max-h-[92dvh] w-[94vw] max-w-none overflow-hidden rounded-3xl bg-white p-0 text-slate-900 shadow-[0_24px_70px_-12px_rgb(15_23_42/0.45)] backdrop:bg-slate-950/55 backdrop:backdrop-blur-[3px] md:w-[40vw] md:min-w-[30rem] dark:bg-slate-900 dark:text-slate-100 dark:shadow-[0_24px_70px_-12px_rgb(0_0_0/0.8)]"
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <header className="relative flex items-start justify-between gap-4 bg-gradient-to-br from-brand-50 via-white to-white px-6 pb-4 pt-5 dark:from-slate-800 dark:via-slate-900 dark:to-slate-900">
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-brand-600 via-brand-500 to-accent-500"
            />
            <h2
              id={titleId}
              className="min-w-0 text-xl font-bold tracking-tight text-brand-900 dark:text-white"
            >
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-9 shrink-0 place-items-center rounded-full text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <X aria-hidden="true" className="size-5" strokeWidth={2} />
            </button>
          </header>
          <div className="space-y-4 overflow-y-auto px-6 pb-6 pt-2">{children}</div>
        </div>
      )}
    </dialog>
  );
}
