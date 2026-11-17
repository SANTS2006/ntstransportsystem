/** The questions a company adds to a posting's application form. */
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

export interface FormField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  help?: string | undefined;
  options?: string[] | undefined;
}

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: 'Short answer',
  textarea: 'Long answer',
  number: 'Number',
  email: 'Email address',
  phone: 'Phone number',
  date: 'Date',
  select: 'Dropdown',
  radio: 'Single choice',
  checkbox: 'Yes / no tick box',
  file: 'File upload',
};

export const hasOptions = (t: FieldType) => t === 'select' || t === 'radio';

/** A key for an answer, made from the label: letters, digits and underscores, never repeated. */
export function fieldKey(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30) || 'question';
  let key = /^[a-z]/.test(base) ? base : `q_${base}`;
  for (let n = 2; taken.has(key); n += 1) key = `${key.replace(/_\d+$/, '')}_${n}`;
  return key;
}

/** What is wrong with a form under construction (null when it can be saved). */
export function formProblem(fields: FormField[]): string | null {
  for (const f of fields) {
    if (!f.label.trim()) return 'Every question needs a label.';
    if (hasOptions(f.type) && (f.options ?? []).filter((o) => o.trim()).length < 2)
      return `"${f.label}" needs at least two options.`;
  }
  return null;
}

/** The fields exactly as the server stores them: trimmed, with options only where they apply. */
export function cleanFields(fields: FormField[]): FormField[] {
  return fields.map((f) => ({
    id: f.id,
    label: f.label.trim(),
    type: f.type,
    required: f.required,
    ...(f.help?.trim() ? { help: f.help.trim() } : {}),
    ...(hasOptions(f.type)
      ? { options: (f.options ?? []).map((o) => o.trim()).filter(Boolean) }
      : {}),
  }));
}
