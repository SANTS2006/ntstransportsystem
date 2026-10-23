/**
 * CSV output for reports. Two things matter beyond quoting:
 *  - Values that start with = + - @ (or a tab/CR) would be executed as formulas by Excel/Sheets
 *    when the file is opened. Text cells that look like that are prefixed with an apostrophe.
 *    Numbers are written as numbers and are never touched.
 *  - Fields with commas, quotes or line breaks are quoted, with quotes doubled (RFC 4180).
 */
export type CsvCell = string | number | null | undefined;

/** UTF-8 byte order mark: Excel needs it to read accented names correctly. */
export const BOM = String.fromCharCode(0xfeff);

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = v;
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  // CRLF line endings, as RFC 4180 specifies.
  return `${BOM}${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
