/**
 * Phone numbers are stored and compared in E.164 (`+23276123456`). People type them many ways:
 * `076 123456`, `76123456`, `+232 76 123 456`, `00232-76-123456`. This turns any of those into the
 * one stored form, or says it is not a number.
 *
 * Sierra Leone (+232) numbers have exactly 8 digits after the country code. The network
 * (Orange, Africell, Qcell, ...) is not worked out from the digits: the message goes to whichever
 * network the number is on, and numbers can move between networks.
 */
export const DEFAULT_COUNTRY_CODE = '232';

export function normalizePhone(
  input: string,
  defaultCountryCode = DEFAULT_COUNTRY_CODE,
): string | null {
  const s = input.trim().replace(/[\s\-.()]/g, '');
  if (!s || !/^\+?\d+$/.test(s)) return null;

  let digits: string;
  if (s.startsWith('+')) digits = s.slice(1);
  else if (s.startsWith('00')) digits = s.slice(2);
  else if (s.startsWith('0')) digits = defaultCountryCode + s.slice(1);
  else if (s.length === 8) digits = defaultCountryCode + s;
  else if (s.startsWith(defaultCountryCode) && s.length === defaultCountryCode.length + 8)
    digits = s;
  else return null;

  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  if (digits.startsWith('232') && digits.length !== 3 + 8) return null;
  return `+${digits}`;
}

/** `+23276123456` as `+232 76 123 456`, for showing back to people. Other countries are left as is. */
export function formatPhone(e164: string): string {
  const m = /^\+232(\d{2})(\d{3})(\d{3})$/.exec(e164);
  return m ? `+232 ${m[1]} ${m[2]} ${m[3]}` : e164;
}
