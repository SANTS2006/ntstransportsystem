import { useRef } from 'react';
import { fileProblem } from '../files/FileControls';
import { Field } from '../ui/Field';
import type { FormField } from '../../lib/job-form';

export type AnswerValue = string | number | boolean;

const inputClass =
  'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900';

/** A picture or document chosen now and uploaded once the application exists. */
export function PendingFile({
  label,
  hint,
  required,
  accept,
  file,
  onPick,
  problem,
}: {
  label: string;
  hint?: string | undefined;
  required?: boolean | undefined;
  accept: string;
  file: File | null;
  onPick: (f: File | null) => void;
  problem?: string | null | undefined;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1">
      <label className="block text-sm font-semibold">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={ref}
          type="file"
          aria-label={label}
          accept={accept}
          className="block w-full max-w-sm text-sm file:mr-3 file:min-h-10 file:rounded-lg file:border-0 file:bg-brand-600 file:px-4 file:text-sm file:font-medium file:text-white"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        />
        {file && file.type.startsWith('image/') && (
          <img
            src={URL.createObjectURL(file)}
            alt="Preview"
            className="size-14 rounded-lg object-cover"
            onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
          />
        )}
      </div>
      {hint && !problem && <p className="text-xs text-slate-600 dark:text-slate-400">{hint}</p>}
      {problem && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}
    </div>
  );
}

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';
export const DOC_ACCEPT = `${IMAGE_ACCEPT},application/pdf,.pdf`;

/** A problem with a chosen picture (null when fine); the server checks again. */
export function pictureProblem(f: File | null): string | null {
  if (!f) return null;
  if (!f.type.startsWith('image/')) return 'Choose a picture (PNG, JPEG or WebP).';
  return fileProblem(f, 'cv');
}

/** Renders the questions a company built for a posting; the answers live in the page above. */
export function ApplicationFields({
  fields,
  answers,
  files,
  onAnswer,
  onFile,
}: {
  fields: FormField[];
  answers: Record<string, AnswerValue>;
  files: Record<string, File | null>;
  onAnswer: (id: string, v: AnswerValue) => void;
  onFile: (id: string, f: File | null) => void;
}) {
  return (
    <>
      {fields.map((f) => {
        const label = f.required ? `${f.label} *` : f.label;
        const v = answers[f.id];
        switch (f.type) {
          case 'text':
          case 'email':
          case 'number':
          case 'date':
            return (
              <Field
                key={f.id}
                label={label}
                hint={f.help}
                type={f.type === 'text' ? 'text' : f.type}
                value={typeof v === 'string' || typeof v === 'number' ? String(v) : ''}
                onChange={(e) => onAnswer(f.id, e.target.value)}
              />
            );
          case 'phone':
            return (
              <Field
                key={f.id}
                label={label}
                hint={f.help}
                type="tel"
                value={typeof v === 'string' ? v : ''}
                onChange={(e) => onAnswer(f.id, e.target.value)}
              />
            );
          case 'textarea':
            return (
              <div key={f.id}>
                <label htmlFor={`q-${f.id}`} className="mb-1 block text-sm font-semibold">
                  {label}
                </label>
                <textarea
                  id={`q-${f.id}`}
                  rows={4}
                  maxLength={4000}
                  value={typeof v === 'string' ? v : ''}
                  onChange={(e) => onAnswer(f.id, e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm dark:border-slate-600 dark:bg-slate-900"
                />
                {f.help && <p className="mt-1 text-xs text-slate-600">{f.help}</p>}
              </div>
            );
          case 'select':
            return (
              <div key={f.id}>
                <label htmlFor={`q-${f.id}`} className="mb-1 block text-sm font-semibold">
                  {label}
                </label>
                <select
                  id={`q-${f.id}`}
                  className={inputClass}
                  value={typeof v === 'string' ? v : ''}
                  onChange={(e) => onAnswer(f.id, e.target.value)}
                >
                  <option value="">Choose…</option>
                  {f.options?.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                {f.help && <p className="mt-1 text-xs text-slate-600">{f.help}</p>}
              </div>
            );
          case 'radio':
            return (
              <fieldset key={f.id} className="space-y-1">
                <legend className="mb-1 text-sm font-semibold">{label}</legend>
                {f.options?.map((o) => (
                  <label key={o} className="flex min-h-9 items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`q-${f.id}`}
                      checked={v === o}
                      onChange={() => onAnswer(f.id, o)}
                    />
                    {o}
                  </label>
                ))}
                {f.help && <p className="text-xs text-slate-600">{f.help}</p>}
              </fieldset>
            );
          case 'checkbox':
            return (
              <label key={f.id} className="flex min-h-11 items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={v === true}
                  onChange={(e) => onAnswer(f.id, e.target.checked)}
                />
                {label}
              </label>
            );
          case 'file':
            return (
              <PendingFile
                key={f.id}
                label={f.label}
                required={f.required}
                hint={f.help}
                accept={DOC_ACCEPT}
                file={files[f.id] ?? null}
                onPick={(file) => onFile(f.id, file)}
                problem={files[f.id] ? fileProblem(files[f.id]!, 'cv') : null}
              />
            );
        }
      })}
    </>
  );
}

/** The first thing missing or wrong in the custom answers (null when the form can be sent). */
export function answersProblem(
  fields: FormField[],
  answers: Record<string, AnswerValue>,
  files: Record<string, File | null>,
): string | null {
  for (const f of fields) {
    if (f.type === 'file') {
      if (f.required && !files[f.id]) return `Please attach a file for "${f.label}".`;
      if (files[f.id]) {
        const p = fileProblem(files[f.id]!, 'cv');
        if (p) return `${f.label}: ${p}`;
      }
      continue;
    }
    const v = answers[f.id];
    const empty = v === undefined || v === '' || (f.type === 'checkbox' && v !== true);
    if (f.required && empty) return `Please answer "${f.label}".`;
  }
  return null;
}
