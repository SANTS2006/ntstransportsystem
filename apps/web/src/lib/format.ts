/** Money is stored in minor units (1/100); the currency code is always shown. */
export const money = (minor: number, currency: string) =>
  `${currency} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The whole part and the cents of an amount, so a price can show its cents smaller. */
export function moneyParts(minor: number, currency: string) {
  const [whole = '0', cents = '00'] = (minor / 100)
    .toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .split('.');
  return { currency, whole, cents };
}

/** Clock time in the trip's own time zone, e.g. "06:30". */
export const clockTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );

/** Short date in the trip's own time zone, e.g. "Fri 24 Oct". */
export const shortDate = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));

/** "3 hr 45 min" for a number of minutes. */
export function minutesLabel(total: number): string {
  const mins = Math.max(0, Math.round(total));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/** The time between two instants, as "3 hr 45 min". */
export const duration = (fromIso: string, toIso: string) =>
  minutesLabel((Date.parse(toIso) - Date.parse(fromIso)) / 60_000);

/** Initials for a company badge: "Sierra Coach Express" gives "SC". */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) =>
  isoDay(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000));
