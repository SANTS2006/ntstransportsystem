import { describe, expect, it } from 'vitest';
import { findMomo } from './methods.js';

const momo = (providerId: string, name: string, active = true, canPayFrom = true) => ({
  providerId,
  name,
  active,
  canPayFrom,
});

describe('findMomo', () => {
  const all = [momo('m17', 'Orange Money'), momo('m18', 'Africell Money'), momo('m77', 'Q-Money')];
  it('recognises each wallet by the name Monime gives it, and returns the id Monime gave', () => {
    expect(findMomo('ORANGE_MONEY', all)?.providerId).toBe('m17');
    expect(findMomo('AFRIMONEY', all)?.providerId).toBe('m18');
    expect(findMomo('QMONEY', all)?.providerId).toBe('m77');
  });
  it('copes with the spellings of the names', () => {
    expect(findMomo('AFRIMONEY', [momo('a', 'Afrimoney')])?.providerId).toBe('a');
    expect(findMomo('QMONEY', [momo('q', 'QMoney')])?.providerId).toBe('q');
    expect(findMomo('QMONEY', [momo('q', 'Qcell Q Money')])?.providerId).toBe('q');
    expect(findMomo('ORANGE_MONEY', [momo('o', 'ORANGE MONEY SL')])?.providerId).toBe('o');
  });
  it('only counts a provider that is active and can take payments', () => {
    expect(findMomo('ORANGE_MONEY', [momo('m17', 'Orange Money', false)])).toBeUndefined();
    expect(findMomo('ORANGE_MONEY', [momo('m17', 'Orange Money', true, false)])).toBeUndefined();
  });
  it('finds nothing for a wallet Monime does not list, rather than guessing an id', () => {
    expect(
      findMomo('QMONEY', [momo('m17', 'Orange Money'), momo('m18', 'Africell Money')]),
    ).toBeUndefined();
    expect(findMomo('AFRIMONEY', [])).toBeUndefined();
  });
});
