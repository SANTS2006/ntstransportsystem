import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { LIMITS, MAX_UPLOAD_BYTES, fileProblem, mediaOf } from './FileControls';

const MB = 1024 * 1024;
const file = (size: number, type: string, name = 'x.pdf') =>
  new File([new Uint8Array(size)], name, { type });

describe('fileProblem for a CV', () => {
  it('accepts a PDF or an image up to 5 MB', () => {
    expect(fileProblem(file(1000, 'application/pdf'))).toBeNull();
    expect(fileProblem(file(1000, 'image/png', 'a.png'))).toBeNull();
    expect(fileProblem(file(1000, 'image/jpeg', 'a.jpg'))).toBeNull();
    expect(fileProblem(file(1000, 'image/webp', 'a.webp'))).toBeNull();
    expect(fileProblem(file(5 * MB, 'application/pdf'))).toBeNull();
  });
  it('explains what is wrong with anything else', () => {
    expect(fileProblem(file(0, 'application/pdf'))).toMatch(/empty/);
    expect(fileProblem(file(5 * MB + 1, 'application/pdf'))).toMatch(/5 MB/);
    expect(fileProblem(file(10, 'text/html', 'x.html'))).toMatch(/PDF or an image/);
    expect(fileProblem(file(10, '', 'x'))).toMatch(/PDF or an image/);
    expect(fileProblem(file(10, 'audio/webm', 'v.webm'))).toMatch(/PDF or an image/); // not for a CV
    expect(fileProblem(file(10, 'video/mp4', 'v.mp4'))).toMatch(/PDF or an image/);
  });
});

describe('fileProblem for an attachment', () => {
  it('also accepts audio and video, with a limit for each kind', () => {
    expect(fileProblem(file(1000, 'audio/webm', 'v.webm'), 'attachment')).toBeNull();
    expect(fileProblem(file(1000, 'audio/webm;codecs=opus', 'v.webm'), 'attachment')).toBeNull();
    expect(fileProblem(file(1000, 'audio/mp4', 'v.m4a'), 'attachment')).toBeNull();
    expect(fileProblem(file(1000, 'video/quicktime', 'v.mov'), 'attachment')).toBeNull();
    expect(fileProblem(file(10 * MB, 'audio/webm', 'v.webm'), 'attachment')).toBeNull();
    expect(fileProblem(file(10 * MB + 1, 'audio/webm', 'v.webm'), 'attachment')).toMatch(
      /audio is larger than 10 MB/,
    );
    expect(fileProblem(file(25 * MB, 'video/mp4', 'v.mp4'), 'attachment')).toBeNull();
    expect(fileProblem(file(25 * MB + 1, 'video/mp4', 'v.mp4'), 'attachment')).toMatch(
      /video is larger than 25 MB/,
    );
    expect(fileProblem(file(5 * MB + 1, 'image/jpeg', 'p.jpg'), 'attachment')).toMatch(
      /image is larger than 5 MB/,
    );
  });
  it('still refuses what the server refuses', () => {
    for (const t of ['text/html', 'image/gif', 'image/svg+xml', 'application/zip', '']) {
      expect(fileProblem(file(10, t, 'x'), 'attachment')).toMatch(/Choose a PDF/);
    }
  });
  it('knows each kind of file and its limits', () => {
    expect(mediaOf('audio/webm')).toBe('audio');
    expect(mediaOf('video/mp4')).toBe('video');
    expect(mediaOf('image/webp')).toBe('image');
    expect(mediaOf('application/pdf')).toBe('document');
    expect(MAX_UPLOAD_BYTES).toBe(LIMITS.video);
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
