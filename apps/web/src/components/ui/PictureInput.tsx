import { ImagePlus } from 'lucide-react';
import { useRef, useState } from 'react';

export const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** A "choose a picture" button that checks the type and size before anything is sent. */
export function PictureInput({
  label,
  maxBytes,
  disabled,
  onPick,
}: {
  label: string;
  maxBytes: number;
  disabled?: boolean;
  onPick: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      >
        <ImagePlus aria-hidden="true" className="size-4" strokeWidth={1.8} />
        {label}
      </button>
      <input
        ref={input}
        type="file"
        accept={PICTURE_TYPES.join(',')}
        className="sr-only"
        aria-label={label}
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          if (!PICTURE_TYPES.includes(f.type)) {
            setProblem('Use a PNG, JPEG or WebP picture.');
            return;
          }
          if (f.size > maxBytes) {
            setProblem(`The picture is too large. The limit is ${Math.round(maxBytes / 1000)} KB.`);
            return;
          }
          setProblem(null);
          onPick(f);
        }}
      />
      {problem && (
        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}
    </div>
  );
}
