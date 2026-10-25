import type { CSSProperties } from 'react';

const HEX = /^#[0-9a-fA-F]{6}$/;

function parse(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}
const toHex = (c: number[]) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
/** `t` of the way from `hex` towards `to` (0 keeps `hex`, 1 is `to`). */
function mix(hex: string, to: [number, number, number], t: number): string {
  const c = parse(hex);
  return toHex(c.map((v, i) => v + (to[i]! - v) * t));
}
const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

/**
 * Turns a company's two chosen colours into the whole palette the app uses (every `brand-*` and
 * `accent-*` class reads these variables), so one pair of colours re-themes a company's workspace.
 * Anything that is not a #rrggbb colour is ignored and the default logo colours stay.
 */
export function brandStyle(
  primary: string | null | undefined,
  accent: string | null | undefined,
): CSSProperties {
  const v: Record<string, string> = {};
  if (primary && HEX.test(primary)) {
    v['--brand-50'] = mix(primary, WHITE, 0.92);
    v['--brand-100'] = mix(primary, WHITE, 0.82);
    v['--brand-200'] = mix(primary, WHITE, 0.62);
    v['--brand-500'] = primary;
    v['--brand-600'] = primary;
    v['--brand-700'] = mix(primary, BLACK, 0.2);
    v['--brand-800'] = mix(primary, BLACK, 0.42);
    v['--brand-900'] = mix(primary, BLACK, 0.65);
  }
  // A company that chose only a main colour gets a lighter shade of it, never the system's orange.
  const second =
    accent && HEX.test(accent)
      ? accent
      : primary && HEX.test(primary)
        ? mix(primary, WHITE, 0.3)
        : null;
  if (second) {
    accent = second;
    v['--accent-50'] = mix(accent, WHITE, 0.9);
    v['--accent-100'] = mix(accent, WHITE, 0.78);
    v['--accent-500'] = accent;
    v['--accent-600'] = mix(accent, BLACK, 0.1);
    v['--accent-700'] = mix(accent, BLACK, 0.3);
  }
  return v as CSSProperties;
}

export const isHexColor = (v: string) => HEX.test(v);
