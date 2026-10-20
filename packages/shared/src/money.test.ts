import { describe, expect, it } from 'vitest';
import { add, allocate, money, percentBps, subtract } from './money.js';

describe('money', () => {
  it('adds and subtracts exactly', () => {
    expect(add(money(10, 'SLE'), money(20, 'SLE')).amountMinor).toBe(30n);
    expect(subtract(money(10, 'SLE'), money(20, 'SLE')).amountMinor).toBe(-10n);
  });
  it('rejects currency mismatch, floats and bad codes', () => {
    expect(() => add(money(1, 'SLE'), money(1, 'USD'))).toThrow();
    expect(() => money(1.5, 'SLE')).toThrow();
    expect(() => money(1, 'sle')).toThrow();
  });
  it('computes basis-point percentages with rounding', () => {
    expect(percentBps(money(1005, 'SLE'), 1000).amountMinor).toBe(101n); // 100.5 -> 101
    expect(percentBps(money(10, 'SLE'), 250).amountMinor).toBe(0n); // 0.25 -> 0
  });
  it('allocates without losing a minor unit', () => {
    const parts = allocate(money(100, 'SLE'), 3);
    expect(parts.map((p) => p.amountMinor)).toEqual([34n, 33n, 33n]);
    expect(parts.reduce((s, p) => s + p.amountMinor, 0n)).toBe(100n);
  });
});
