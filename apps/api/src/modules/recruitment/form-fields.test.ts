import { describe, expect, it } from 'vitest';
import { formFieldsSchema, validateAnswers, type FormField } from './form-fields.js';

const fields: FormField[] = [
  { id: 'badge', label: 'PSV badge?', type: 'radio', required: true, options: ['Yes', 'No'] },
  { id: 'age', label: 'Age', type: 'number', required: false },
  { id: 'agree', label: 'I agree', type: 'checkbox', required: true },
  { id: 'cv2', label: 'Reference letter', type: 'file', required: true },
];

describe('formFieldsSchema', () => {
  it('accepts a good form and rejects duplicate keys and one-option choices', () => {
    expect(formFieldsSchema.safeParse(fields).success).toBe(true);
    expect(formFieldsSchema.safeParse([fields[1], fields[1]]).success).toBe(false);
    expect(formFieldsSchema.safeParse([{ ...fields[0], options: ['Only one'] }]).success).toBe(
      false,
    );
    expect(formFieldsSchema.safeParse([{ ...fields[1], id: 'Bad Key' }]).success).toBe(false);
  });
});

describe('validateAnswers', () => {
  it('returns the cleaned answers, ignoring file questions', () => {
    expect(validateAnswers(fields, { badge: 'Yes', age: '31', agree: true })).toEqual({
      badge: 'Yes',
      age: 31,
      agree: true,
    });
  });

  it('refuses missing required answers, bad choices and unknown keys', () => {
    expect(() => validateAnswers(fields, { agree: true })).toThrow(/PSV badge/);
    expect(() => validateAnswers(fields, { badge: 'Maybe', agree: true })).toThrow(/PSV badge/);
    expect(() => validateAnswers(fields, { badge: 'Yes', agree: false })).toThrow(/I agree/);
    expect(() => validateAnswers(fields, { badge: 'Yes', agree: true, extra: 'x' })).toThrow(
      /changed/,
    );
    expect(() => validateAnswers(fields, { badge: 'Yes', agree: true, age: 'abc' })).toThrow(/Age/);
  });
});
