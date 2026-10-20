import { describe, expect, it } from 'vitest';
import {
  addDays,
  eachDate,
  isValidTimezone,
  parseDate,
  weekdayBit,
  zonedTimeToUtc,
} from './time.js';

const iso = (d: Date) => d.toISOString();

describe('zonedTimeToUtc', () => {
  it('handles a zone with no DST (Africa/Freetown = UTC)', () => {
    expect(iso(zonedTimeToUtc('2026-07-01', '07:30', 'Africa/Freetown'))).toBe(
      '2026-07-01T07:30:00.000Z',
    );
  });

  it('handles fractional offsets (Asia/Kolkata = +05:30) and positive offsets (Pacific/Auckland)', () => {
    expect(iso(zonedTimeToUtc('2026-01-10', '08:00', 'Asia/Kolkata'))).toBe(
      '2026-01-10T02:30:00.000Z',
    );
    // Auckland is UTC+13 in January (summer time).
    expect(iso(zonedTimeToUtc('2026-01-10', '08:00', 'Pacific/Auckland'))).toBe(
      '2026-01-09T19:00:00.000Z',
    );
  });

  it('keeps the same local departure across a DST change (America/New_York)', () => {
    // Before spring-forward (EST, UTC-5) and after (EDT, UTC-4): same 07:30 local, different UTC.
    expect(iso(zonedTimeToUtc('2026-03-07', '07:30', 'America/New_York'))).toBe(
      '2026-03-07T12:30:00.000Z',
    );
    expect(iso(zonedTimeToUtc('2026-03-09', '07:30', 'America/New_York'))).toBe(
      '2026-03-09T11:30:00.000Z',
    );
  });

  it('shifts a nonexistent local time forward across the spring-forward gap', () => {
    // 2026-03-08 02:30 does not exist in New York (clocks jump 02:00 -> 03:00).
    expect(iso(zonedTimeToUtc('2026-03-08', '02:30', 'America/New_York'))).toBe(
      '2026-03-08T07:30:00.000Z',
    ); // = 03:30 EDT
  });

  it('uses the first occurrence of an ambiguous local time in the fall-back overlap', () => {
    // 2026-11-01 01:30 happens twice in New York; the first is EDT (UTC-4).
    expect(iso(zonedTimeToUtc('2026-11-01', '01:30', 'America/New_York'))).toBe(
      '2026-11-01T05:30:00.000Z',
    );
  });

  it('rejects malformed input', () => {
    expect(() => zonedTimeToUtc('2026-02-30', '07:00', 'UTC')).toThrow();
    expect(() => zonedTimeToUtc('2026-02-01', '24:00', 'UTC')).toThrow();
    expect(() => zonedTimeToUtc('2026-02-01', '7:00', 'UTC')).toThrow();
    expect(() => zonedTimeToUtc('Feb 1', '07:00', 'UTC')).toThrow();
  });
});

describe('date helpers', () => {
  it('computes ISO weekday bits (Mon=1 ... Sun=64)', () => {
    expect(weekdayBit('2026-10-19')).toBe(1); // Monday
    expect(weekdayBit('2026-10-21')).toBe(4); // Wednesday
    expect(weekdayBit('2026-10-25')).toBe(64); // Sunday
  });
  it('adds days across month and year boundaries and leap day', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });
  it('lists an inclusive range and refuses very long ones', () => {
    expect(eachDate('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(() => eachDate('2026-01-01', '2028-01-01')).toThrow(/exceeds/);
  });
  it('validates timezones and dates', () => {
    expect(isValidTimezone('Africa/Freetown')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(parseDate('2026-02-28')).toEqual({ y: 2026, m: 2, d: 28 });
    expect(() => parseDate('2026-13-01')).toThrow();
  });
});
