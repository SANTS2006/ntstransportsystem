/**
 * Timezone-aware date helpers for schedule -> trip generation.
 *
 * Departure times are stored as local wall-clock times ("07:30" in the company's timezone) and
 * converted to a UTC instant per service date, so a 07:30 bus keeps leaving at 07:30 local time
 * across daylight-saving changes. Implemented with Intl only (no dependency).
 *
 * DST edge cases (documented behaviour):
 *  - Nonexistent local time (spring-forward gap): shifted forward by the gap, e.g. 02:30 -> 03:30.
 *  - Ambiguous local time (fall-back overlap): the first (earlier) occurrence is used.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** The wall-clock reading in `tz` at UTC instant `ms`, expressed as if it were UTC milliseconds. */
function wallClockAsUtc(ms: number, tz: string): number {
  const parts: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour!,
    parts.minute!,
    parts.second!,
  );
}

const offsetMs = (ms: number, tz: string) => wallClockAsUtc(ms, tz) - ms;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimezone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Parses "YYYY-MM-DD" strictly (rejects 2026-02-30 and similar). */
export function parseDate(date: string): { y: number; m: number; d: number } {
  const match = DATE_RE.exec(date);
  if (!match) throw new RangeError(`Invalid date: ${date}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new RangeError(`Invalid date: ${date}`);
  }
  return { y, m, d };
}

/** Converts a local date + "HH:MM" in `tz` to the corresponding UTC instant. */
export function zonedTimeToUtc(date: string, time: string, tz: string): Date {
  const { y, m, d } = parseDate(date);
  const t = TIME_RE.exec(time);
  if (!t) throw new RangeError(`Invalid time: ${time}`);
  const target = Date.UTC(y, m - 1, d, Number(t[1]), Number(t[2]));

  // Offsets a day either side bracket any single transition; test both candidate instants.
  const before = offsetMs(target - 24 * 3_600_000, tz);
  const after = offsetMs(target + 24 * 3_600_000, tz);
  const candidates = [...new Set([target - before, target - after])].sort((a, b) => a - b);
  const exact = candidates.filter((c) => wallClockAsUtc(c, tz) === target);
  if (exact.length > 0) return new Date(exact[0]!); // earliest valid (ambiguous -> first occurrence)

  // Nonexistent local time: use the pre-transition offset, which lands after the gap.
  return new Date(target - before);
}

/** ISO weekday bit: Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64. */
export function weekdayBit(date: string): number {
  const { y, m, d } = parseDate(date);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  return dow === 0 ? 64 : 1 << (dow - 1);
}

export const addDays = (date: string, days: number): string => {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/** Inclusive list of dates from `from` to `to`, refusing absurdly long ranges. */
export function eachDate(from: string, to: string, maxDays = 366): string[] {
  const out: string[] = [];
  for (let cur = from; cur <= to; cur = addDays(cur, 1)) {
    out.push(cur);
    if (out.length > maxDays) throw new RangeError(`Date range exceeds ${maxDays} days`);
  }
  return out;
}

export const DAY_BITS = { MON: 1, TUE: 2, WED: 4, THU: 8, FRI: 16, SAT: 32, SUN: 64 } as const;
export const EVERY_DAY = 127;
