import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import {
  FIELD_TYPES,
  FIELD_TYPE_LABEL,
  fieldKey,
  hasOptions,
  type FieldType,
  type FormField,
} from '../../lib/job-form';
import { Button } from '../ui/Button';

const inputClass =
  'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900';

/**
 * Builds the application form that is published with a posting: the company adds questions of
 * different kinds, says which are required, orders them, and gives choices to the choice kinds.
 */
export function FormBuilder({
  fields,
  onChange,
}: {
  fields: FormField[];
  onChange: (next: FormField[]) => void;
}) {
  const uid = useId();
  const update = (i: number, patch: Partial<FormField>) =>
    onChange(fields.map((f, n) => (n === i ? { ...f, ...patch } : f)));
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const add = (type: FieldType) => {
    const taken = new Set(fields.map((f) => f.id));
    const label = FIELD_TYPE_LABEL[type];
    onChange([
      ...fields,
      {
        id: fieldKey(label, taken),
        label: '',
        type,
        required: false,
        ...(hasOptions(type) ? { options: ['', ''] } : {}),
      },
    ]);
  };
  const rekey = (i: number, label: string) => {
    // The key follows the label until the posting is saved, so answers keep a readable name.
    const taken = new Set(fields.filter((_, n) => n !== i).map((f) => f.id));
    update(i, { label, id: fieldKey(label || FIELD_TYPE_LABEL[fields[i]!.type], taken) });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Applicants always give their name, phone number, years of experience and experience, and can
        add a picture and a licence photo. Add any further questions you need.
      </p>
      {fields.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-slate-600">
          No extra questions yet.
        </p>
      )}
      <ol className="space-y-3">
        {fields.map((f, i) => (
          <li
            key={f.id + i}
            className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50"
          >
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <div>
                <label htmlFor={`${uid}-l${i}`} className="mb-1 block text-sm font-medium">
                  Question
                </label>
                <input
                  id={`${uid}-l${i}`}
                  className={inputClass}
                  maxLength={120}
                  value={f.label}
                  placeholder="e.g. Do you hold a PSV badge?"
                  onChange={(e) => rekey(i, e.target.value)}
                />
              </div>
              <div>
                <label htmlFor={`${uid}-t${i}`} className="mb-1 block text-sm font-medium">
                  Answer type
                </label>
                <select
                  id={`${uid}-t${i}`}
                  className={inputClass}
                  value={f.type}
                  onChange={(e) => {
                    const type = e.target.value as FieldType;
                    update(i, {
                      type,
                      options: hasOptions(type)
                        ? f.options?.length
                          ? f.options
                          : ['', '']
                        : undefined,
                    });
                  }}
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {FIELD_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor={`${uid}-h${i}`} className="mb-1 block text-sm font-medium">
                Help text (optional)
              </label>
              <input
                id={`${uid}-h${i}`}
                className={inputClass}
                maxLength={200}
                value={f.help ?? ''}
                onChange={(e) => update(i, { help: e.target.value })}
              />
            </div>
            {hasOptions(f.type) && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Options</p>
                {(f.options ?? []).map((o, n) => (
                  <div key={n} className="flex gap-2">
                    <input
                      aria-label={`Option ${n + 1} of question ${i + 1}`}
                      className={inputClass}
                      maxLength={80}
                      value={o}
                      onChange={(e) =>
                        update(i, {
                          options: (f.options ?? []).map((x, k) => (k === n ? e.target.value : x)),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Remove option ${n + 1}`}
                      disabled={(f.options ?? []).length <= 2}
                      onClick={() =>
                        update(i, { options: (f.options ?? []).filter((_, k) => k !== n) })
                      }
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={(f.options ?? []).length >= 30}
                  onClick={() => update(i, { options: [...(f.options ?? []), ''] })}
                >
                  <Plus aria-hidden="true" className="size-4" />
                  Add option
                </Button>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={f.required}
                  onChange={(e) => update(i, { required: e.target.checked })}
                />
                Required
              </label>
              <span className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Move question ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp aria-hidden="true" className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Move question ${i + 1} down`}
                  disabled={i === fields.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown aria-hidden="true" className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="dangerQuiet"
                  onClick={() => onChange(fields.filter((_, n) => n !== i))}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                  Remove
                </Button>
              </span>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${uid}-add`} className="text-sm font-medium">
          Add a question
        </label>
        <select
          id={`${uid}-add`}
          className={`${inputClass} w-auto`}
          value=""
          disabled={fields.length >= 25}
          onChange={(e) => {
            if (e.target.value) add(e.target.value as FieldType);
          }}
        >
          <option value="">Choose a type…</option>
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
