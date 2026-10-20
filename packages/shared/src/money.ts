/** Money is always integer minor units plus an explicit ISO-4217-style currency code. No floats. */
export interface Money {
  readonly amountMinor: bigint;
  readonly currency: string;
}

export function money(amountMinor: bigint | number, currency: string): Money {
  if (typeof amountMinor === 'number' && !Number.isSafeInteger(amountMinor)) {
    throw new RangeError('Money amount must be an integer number of minor units');
  }
  if (!/^[A-Z]{3}$/.test(currency)) throw new RangeError('Invalid currency code');
  return { amountMinor: BigInt(amountMinor), currency };
}

function assertSame(a: Money, b: Money) {
  if (a.currency !== b.currency) throw new RangeError('Currency mismatch');
}

export const add = (a: Money, b: Money): Money => (
  assertSame(a, b),
  { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency }
);

export const subtract = (a: Money, b: Money): Money => (
  assertSame(a, b),
  { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency }
);

/** Percentage in basis points (1% = 100 bps), rounded half away from zero. */
export function percentBps(a: Money, bps: number): Money {
  if (!Number.isInteger(bps)) throw new RangeError('bps must be an integer');
  const num = a.amountMinor * BigInt(bps);
  const den = 10_000n;
  const sign = num < 0n ? -1n : 1n;
  const abs = num < 0n ? -num : num;
  const q = (abs * 2n + den) / (den * 2n);
  return { amountMinor: sign * q, currency: a.currency };
}

/** Split into n parts that sum exactly to the total (remainder spread from the first part). */
export function allocate(a: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts < 1) throw new RangeError('parts must be >= 1');
  const n = BigInt(parts);
  const base = a.amountMinor / n;
  let rem = a.amountMinor - base * n;
  return Array.from({ length: parts }, () => {
    const extra = rem > 0n ? 1n : 0n;
    rem -= extra;
    return { amountMinor: base + extra, currency: a.currency };
  });
}
