import { describe, expect, it } from 'vitest';
import { brandStyle } from './theme';

describe('brandStyle', () => {
  it('builds the whole palette from one colour', () => {
    const s = brandStyle('#0b6e4f', null) as Record<string, string>;
    expect(s['--brand-600']).toBe('#0b6e4f');
    expect(s['--brand-900']).toMatch(/^#[0-9a-f]{6}$/);
    expect(s['--brand-50']).not.toBe(s['--brand-600']);
    expect(s['--accent-500']).toBeUndefined();
  });
  it('ignores anything that is not a hex colour', () => {
    expect(brandStyle('red', 'url(javascript:alert(1))')).toEqual({});
    expect(brandStyle(null, undefined)).toEqual({});
  });
});
