import { z } from 'zod';
import { AppError } from '../../platform/errors.js';

/** The kinds of question a company can put on a posting's application form. */
export const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'email',
  'phone',
  'date',
  'select',
  'radio',
  'checkbox',
  'file',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

const trim = z.string().trim();

export const formFieldSchema = z
  .object({
    /** Stable key of the answer (a slug made from the label by the builder). */
    id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Invalid field key'),
    label: trim.min(1).max(120),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().default(false),
    help: trim.max(200).optional(),
    options: z.array(trim.min(1).max(80)).max(30).optional(),
  })
  .strict();

export const formFieldsSchema = z
  .array(formFieldSchema)
  .max(25)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    fields.forEach((f, i) => {
      if (seen.has(f.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate field', path: [i] });
      seen.add(f.id);
      if ((f.type === 'select' || f.type === 'radio') && (f.options?.length ?? 0) < 2) {
        ctx.addIssue({
          code: 'custom',
          message: 'A choice question needs at least two options',
          path: [i, 'options'],
        });
      }
    });
  });

export type FormField = z.infer<typeof formFieldSchema>;
export type AnswerValue = string | number | boolean;

/** Reads the stored JSON back as fields (anything malformed is dropped, never trusted). */
export function parseStoredFields(raw: unknown): FormField[] {
  const r = formFieldsSchema.safeParse(raw);
  return r.success ? r.data : [];
}

/**
 * Checks an applicant's answers against the posting's own questions: required ones are present,
 * each answer has the right shape, choices are one of the offered options. File questions are
 * answered by uploading, so they are not part of this body. Unknown keys are refused.
 */
export function validateAnswers(
  fields: FormField[],
  answers: Record<string, unknown>,
): Record<string, AnswerValue> {
  const known = new Map(fields.map((f) => [f.id, f]));
  for (const k of Object.keys(answers)) {
    if (!known.has(k))
      throw AppError.validation('The application form has changed. Please reload.');
  }
  const out: Record<string, AnswerValue> = {};
  for (const f of fields) {
    if (f.type === 'file') continue;
    const raw = answers[f.id];
    const empty = raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim());
    if (f.type === 'checkbox') {
      if (raw !== undefined && typeof raw !== 'boolean')
        throw AppError.validation(`"${f.label}" must be yes or no`);
      if (f.required && raw !== true) throw AppError.validation(`Please tick "${f.label}"`);
      out[f.id] = raw === true;
      continue;
    }
    if (empty) {
      if (f.required) throw AppError.validation(`Please answer "${f.label}"`);
      continue;
    }
    const bad = () => AppError.validation(`Check your answer to "${f.label}"`);
    switch (f.type) {
      case 'text':
      case 'phone': {
        if (typeof raw !== 'string' || raw.length > 300) throw bad();
        if (f.type === 'phone' && !/^\+?[0-9 ()-]{6,20}$/.test(raw.trim())) throw bad();
        out[f.id] = raw.trim();
        break;
      }
      case 'textarea': {
        if (typeof raw !== 'string' || raw.length > 4000) throw bad();
        out[f.id] = raw.trim();
        break;
      }
      case 'email': {
        if (typeof raw !== 'string' || !z.email().safeParse(raw.trim()).success) throw bad();
        out[f.id] = raw.trim();
        break;
      }
      case 'number': {
        const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
        if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw bad();
        out[f.id] = n;
        break;
      }
      case 'date': {
        if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw bad();
        if (Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime())) throw bad();
        out[f.id] = raw;
        break;
      }
      case 'select':
      case 'radio': {
        if (typeof raw !== 'string' || !f.options?.includes(raw)) throw bad();
        out[f.id] = raw;
        break;
      }
    }
  }
  return out;
}
