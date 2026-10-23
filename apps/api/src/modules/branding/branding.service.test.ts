import { describe, expect, it } from 'vitest';
import { checkImage, checkSlug, sniffImage } from './branding.service.js';

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(20),
]);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0]);
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBP'),
  Buffer.alloc(4),
]);

describe('image checks', () => {
  it('knows PNG, JPEG and WebP from their bytes', () => {
    expect(sniffImage(png)).toBe('image/png');
    expect(sniffImage(jpg)).toBe('image/jpeg');
    expect(sniffImage(webp)).toBe('image/webp');
  });
  it('refuses SVG, scripts and empty files, whatever they are called', () => {
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(() => checkImage(Buffer.from('<script>alert(1)</script>'), 1000)).toThrow();
    expect(() => checkImage(Buffer.alloc(0), 1000)).toThrow();
  });
  it('refuses a picture over the limit', () => {
    expect(() => checkImage(png, 10)).toThrow(/too large/);
  });
});

describe('company web address names', () => {
  it('accepts plain names', () => {
    expect(() => checkSlug('sierra-coaches')).not.toThrow();
  });
  it('refuses bad shapes and names the app already uses', () => {
    for (const bad of ['ab', 'Has Space', '-lead', 'trail-', 'double--hyphen', 'x'.repeat(41)]) {
      expect(() => checkSlug(bad)).toThrow();
    }
    for (const taken of ['login', 'app', 'platform', 'api', 'trips']) {
      expect(() => checkSlug(taken)).toThrow(/reserved/);
    }
  });
});
