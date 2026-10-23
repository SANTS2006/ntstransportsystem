import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { MAX_UPLOAD_BYTES, fileProblem } from './FileControls';

const file = (size: number, type: string, name = 'x.pdf') =>
  new File([new Uint8Array(size)], name, { type });

describe('fileProblem', () => {
  it('accepts PDF, PNG and JPEG up to 5 MB', () => {
    expect(fileProblem(file(1000, 'application/pdf'))).toBeNull();
    expect(fileProblem(file(1000, 'image/png', 'a.png'))).toBeNull();
    expect(fileProblem(file(1000, 'image/jpeg', 'a.jpg'))).toBeNull();
    expect(fileProblem(file(MAX_UPLOAD_BYTES, 'application/pdf'))).toBeNull();
  });
  it('explains what is wrong with anything else', () => {
    expect(fileProblem(file(0, 'application/pdf'))).toMatch(/empty/);
    expect(fileProblem(file(MAX_UPLOAD_BYTES + 1, 'application/pdf'))).toMatch(/5 MB/);
    expect(fileProblem(file(10, 'text/html', 'x.html'))).toMatch(/PDF, PNG or JPEG/);
    expect(fileProblem(file(10, '', 'x'))).toMatch(/PDF, PNG or JPEG/);
  });
});

describe('api() file upload', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends the file itself with its type and an encoded name, not JSON', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: '1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const f = file(10, 'application/pdf', 'Mon CV (é).pdf');
    await api('/applicant/applications/1/cv', { method: 'POST', file: f });
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    const h = init.headers as Record<string, string>;
    expect(init.body).toBe(f);
    expect(h['content-type']).toBe('application/pdf');
    expect(decodeURIComponent(h['x-file-name']!)).toBe('Mon CV (é).pdf');
    expect(h['x-file-name']).not.toMatch(/[^\x20-\x7e]/); // header-safe
  });
});
