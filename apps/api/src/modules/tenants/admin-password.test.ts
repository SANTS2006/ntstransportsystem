import { describe, expect, it } from 'vitest';
import { defaultAdminPassword } from './admin-password.js';

describe('defaultAdminPassword', () => {
  it('is the first letters of the company words, an @, and the year', () => {
    expect(defaultAdminPassword('Sierra Coaches Ltd', 2026)).toBe('SCL@2026');
    expect(defaultAdminPassword('  salone  express-lines ', 2027)).toBe('SEL@2027');
  });
  it('copes with accents, digits and very long names', () => {
    expect(defaultAdminPassword('Élan 24 Transport', 2026)).toBe('ET@2026');
    expect(defaultAdminPassword('a b c d e f g h', 2026)).toBe('ABCDEF@2026');
  });
  it('falls back when the name has no letters', () => {
    expect(defaultAdminPassword('123', 2026)).toBe('NTS@2026');
  });
});
