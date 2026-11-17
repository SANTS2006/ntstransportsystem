import { describe, expect, it } from 'vitest';
import { computeBreakdown } from './salary.service.js';

describe('computeBreakdown', () => {
  const structure = { id: 's1', name: 'Driver', baseMinor: 100_000 };
  const allowances = [
    { id: 'a1', name: 'Transport', amountMinor: 20_000 },
    { id: 'a2', name: 'Housing', amountMinor: 30_000 },
  ];

  it('adds allowances to base pay for gross and takes deductions off for net', () => {
    const b = computeBreakdown({
      currency: 'SLE',
      structure,
      allowances,
      deductions: [
        { id: 'd1', name: 'Pension', kind: 'PERCENT', value: 500 }, // 5% of gross
        { id: 'd2', name: 'Loan', kind: 'FIXED', value: 10_000 },
      ],
    });
    expect(b.grossMinor).toBe(150_000);
    expect(b.totalAllowancesMinor).toBe(50_000);
    expect(b.deductions.map((d) => d.amountMinor)).toEqual([7_500, 10_000]);
    expect(b.totalDeductionsMinor).toBe(17_500);
    expect(b.netMinor).toBe(132_500);
  });

  it('rounds percentage deductions to whole minor units', () => {
    const b = computeBreakdown({
      currency: 'SLE',
      structure: { ...structure, baseMinor: 333 },
      allowances: [],
      deductions: [{ id: 'd1', name: 'Tax', kind: 'PERCENT', value: 1_000 }], // 10% of 333
    });
    expect(b.deductions[0]!.amountMinor).toBe(33);
    expect(b.netMinor).toBe(300);
  });

  it('is all zero without a structure', () => {
    const b = computeBreakdown({
      currency: 'SLE',
      structure: null,
      allowances: [],
      deductions: [],
    });
    expect(b).toMatchObject({ structure: null, grossMinor: 0, netMinor: 0 });
  });
});
