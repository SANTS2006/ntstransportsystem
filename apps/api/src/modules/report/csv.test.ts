import { describe, expect, it } from 'vitest';
import { BOM, csvCell, toCsv } from './csv.js';

describe('csv', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Freetown, Sierra Leone')).toBe('"Freetown, Sierra Leone"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell('plain')).toBe('plain');
  });
  it('neutralises spreadsheet formulas in text but leaves numbers alone', () => {
    for (const evil of ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) {
      expect(csvCell(evil).replace(/^"/, '')).toMatch(/^'/);
    }
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(1234.5)).toBe('1234.5');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
  it('writes a BOM, CRLF line endings and a header', () => {
    const out = toCsv(
      ['Route', 'Seats'],
      [
        ['A - B', 3],
        ['=cmd', 4],
      ],
    );
    expect(out.startsWith(`${BOM}Route,Seats\r\n`)).toBe(true);
    expect(BOM.charCodeAt(0)).toBe(0xfeff);
    expect(out).toContain("A - B,3\r\n'=cmd,4\r\n");
  });
});
