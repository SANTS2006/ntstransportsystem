/**
 * The NTS activity indicator. Small sizes (inside buttons) are the logo's swoosh: two arcs, one in
 * the logo's blue and one in its orange, turning. Larger sizes put the full logo inside that ring.
 * The arcs use `currentColor` for the first and the logo's orange for the second, so it reads on
 * both a blue button and a white card.
 */
export function Spinner({ size = 'md', label }: { size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const px = size === 'sm' ? 18 : size === 'lg' ? 64 : 28;
  const ring = (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="animate-spin motion-reduce:animate-none"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M3 12a9 9 0 0 0 9 9" stroke="#fc8b01" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      className="relative inline-flex items-center justify-center text-brand-600"
    >
      {ring}
      {size === 'lg' && (
        <img
          src="/nts-logo-small.jpg"
          alt=""
          aria-hidden="true"
          className="absolute size-9 rounded-full bg-white object-contain p-0.5 animate-[nts-pulse_1.6s_ease-in-out_infinite] motion-reduce:animate-none"
        />
      )}
    </span>
  );
}

/** A section, table or page that is still loading: the logo spinner with a line of text. */
export function PageLoader({
  label = 'Loading',
  full = false,
}: {
  label?: string;
  full?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-3 text-slate-600 dark:text-slate-300 ${
        full ? 'min-h-dvh' : 'min-h-48 py-10'
      }`}
    >
      <Spinner size="lg" />
      <p className="text-sm font-medium">{label}…</p>
    </div>
  );
}

/** Full-screen overlay shown while an action the user cannot continue past is under way. */
export function BlockingOverlay({ title, note }: { title: string; note?: string }) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] grid place-items-center bg-white/90 backdrop-blur-sm dark:bg-slate-950/90"
    >
      <div className="flex max-w-xs flex-col items-center gap-4 px-6 text-center">
        <Spinner size="lg" />
        <p className="text-lg font-semibold">{title}</p>
        {note && <p className="text-sm text-slate-600 dark:text-slate-400">{note}</p>}
      </div>
    </div>
  );
}
