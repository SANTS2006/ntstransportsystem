import { describe, expect, it } from 'vitest';
import { formatPhone, normalizePhone } from './phone.js';

describe('normalizePhone', () => {
  it('turns every usual way of writing a Sierra Leone number into one form', () => {
    for (const typed of [
      '076123456',
      '076 123 456',
      '76123456',
      '+232 76 123 456',
      '+23276123456',
      '23276123456',
      '00232-76-123456',
      '(076) 123-456',
      ' 076.123.456 ',
    ]) {
      expect(normalizePhone(typed)).toBe('+23276123456');
    }
  });

  it('does not guess the network: any 8-digit number is accepted the same way', () => {
    for (const n of ['030123456', '072123456', '077123456', '033123456', '088123456']) {
      expect(normalizePhone(n)).toMatch(/^\+232\d{8}$/);
    }
  });

  it('keeps numbers from other countries when they are given with their country code', () => {
    expect(normalizePhone('+44 7911 123456')).toBe('+447911123456');
    expect(normalizePhone('+233201234567')).toBe('+233201234567');
  });

  it('refuses what is not a phone number', () => {
    for (const bad of [
      '',
      '   ',
      'abc',
      '76 12 34', // too short
      '0761234567', // too long for Sierra Leone
      '+232761234', // too short for Sierra Leone
      '+2327612345678', // too long for Sierra Leone
      '+0123456789',
      '+1',
      '76123456x',
      '+23276123456; DROP TABLE users',
      '++23276123456',
      '+' + '9'.repeat(20),
    ]) {
      expect(normalizePhone(bad)).toBeNull();
    }
  });
});

describe('formatPhone', () => {
  it('groups Sierra Leone numbers and leaves others alone', () => {
    expect(formatPhone('+23276123456')).toBe('+232 76 123 456');
    expect(formatPhone('+447911123456')).toBe('+447911123456');
  });
});
