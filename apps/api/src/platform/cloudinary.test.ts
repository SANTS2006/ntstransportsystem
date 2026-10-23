import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CloudinaryStorage,
  cloudinaryRef,
  cloudinarySignature,
  parseCloudinaryUrl,
} from './cloudinary.js';

const cfg = { cloudName: 'demo-cloud', apiKey: '123456789012345', apiSecret: 'abcd' };
const NOW = 1_315_060_510_000;

interface Call {
  url: string;
  method: string;
  form?: FormData;
  params?: URLSearchParams;
}
function fakeFetch(reply: (c: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const c: Call = { url: String(input), method: init?.method ?? 'GET' };
    if (init?.body instanceof FormData) c.form = init.body;
    if (init?.body instanceof URLSearchParams) c.params = init.body;
    calls.push(c);
    const r = reply(c);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { fn, calls };
}

describe('cloudinarySignature', () => {
  it("matches Cloudinary's published examples", () => {
    expect(cloudinarySignature({ timestamp: 1315060510 }, 'abcd')).toBe(
      'a21ad0f63beb4de2e5575204b79ab90bffb02c10',
    );
    expect(
      cloudinarySignature(
        {
          timestamp: 1315060510,
          public_id: 'sample_image',
          eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop',
        },
        'abcd',
      ),
    ).toBe('bfd09f95f331f558cbd1320e67aa8d488770583e');
  });
  it('leaves out the fields Cloudinary says are never signed, whatever order they come in', () => {
    const a = cloudinarySignature(
      {
        timestamp: 5,
        file: 'x',
        api_key: 'k',
        cloud_name: 'c',
        resource_type: 'image',
        public_id: 'p',
      },
      's',
    );
    const b = cloudinarySignature({ public_id: 'p', timestamp: 5 }, 's');
    expect(a).toBe(b);
    expect(b).toBe(createHash('sha1').update('public_id=p&timestamp=5s').digest('hex'));
  });
});

describe('CLOUDINARY_URL', () => {
  it('is parsed into key, secret and cloud name', () => {
    expect(parseCloudinaryUrl('cloudinary://123:abc_DEF-9@my-cloud')).toEqual({
      apiKey: '123',
      apiSecret: 'abc_DEF-9',
      cloudName: 'my-cloud',
    });
  });
  it('refuses anything else', () => {
    for (const bad of [
      '',
      'https://x',
      'cloudinary://nokey@cloud',
      'cloudinary://k:s@',
      'cloudinary://k:s@a b',
    ]) {
      expect(() => parseCloudinaryUrl(bad)).toThrow(/cloudinary:\/\//);
    }
  });
});

describe('where a key lives in Cloudinary', () => {
  const base = 'tenants/t1/complaint_attachment/c1/0a1b2c';
  it('puts images and PDFs under image, and video and audio under video', () => {
    expect(cloudinaryRef(`${base}.pdf`)).toEqual({
      resource: 'image',
      publicId: base,
      format: 'pdf',
    });
    expect(cloudinaryRef(`${base}.jpg`).resource).toBe('image');
    expect(cloudinaryRef(`${base}.webp`).resource).toBe('image');
    for (const ext of ['mp4', 'mov', 'webm', 'ogg', 'ogv', 'mp3', 'm4a', 'wav']) {
      expect(cloudinaryRef(`${base}.${ext}`)).toEqual({
        resource: 'video',
        publicId: base,
        format: ext,
      });
    }
  });
  it('refuses unknown extensions and unsafe keys', () => {
    expect(() => cloudinaryRef(`${base}.exe`)).toThrow();
    expect(() => cloudinaryRef(`${base}`)).toThrow();
    expect(() => cloudinaryRef('../x.pdf')).toThrow();
  });
});

describe('CloudinaryStorage', () => {
  const key = 'tenants/t1/complaint_attachment/c1/0a1b2c.webm';

  it('uploads privately, signed, to the right resource type, and checks the answer', async () => {
    const { fn, calls } = fakeFetch(() => ({
      body: { public_id: 'tenants/t1/complaint_attachment/c1/0a1b2c' },
    }));
    const s = new CloudinaryStorage(cfg, fn, () => NOW);
    await s.put(key, Buffer.from([1, 2, 3]), 'audio/webm');
    const c = calls[0]!;
    expect(c.url).toBe('https://api.cloudinary.com/v1_1/demo-cloud/video/upload');
    expect(c.method).toBe('POST');
    const f = c.form!;
    expect(f.get('type')).toBe('private');
    expect(f.get('public_id')).toBe('tenants/t1/complaint_attachment/c1/0a1b2c');
    expect(f.get('timestamp')).toBe('1315060510');
    expect(f.get('api_key')).toBe(cfg.apiKey);
    expect(f.get('file')).toBeInstanceOf(Blob);
    expect(f.get('signature')).toBe(
      createHash('sha1')
        .update(
          'public_id=tenants/t1/complaint_attachment/c1/0a1b2c&timestamp=1315060510&type=privateabcd',
        )
        .digest('hex'),
    );
    expect(String(f.get('signature'))).not.toContain(cfg.apiSecret);
  });

  it('fails the upload when Cloudinary refuses, or answers about something else', async () => {
    const down = new CloudinaryStorage(cfg, fakeFetch(() => ({ status: 500 })).fn, () => NOW);
    await expect(down.put(key, Buffer.from([1]), 'audio/webm')).rejects.toThrow(/500/);
    const odd = new CloudinaryStorage(
      cfg,
      fakeFetch(() => ({ body: { public_id: 'other' } })).fn,
      () => NOW,
    );
    await expect(odd.put(key, Buffer.from([1]), 'audio/webm')).rejects.toThrow(/not confirmed/);
  });

  it('makes a private download link that expires, signed over its own parameters', async () => {
    const s = new CloudinaryStorage(cfg, fakeFetch(() => ({})).fn, () => NOW);
    const url = new URL(
      await s.signedGetUrl(key, {
        expiresSec: 300,
        filename: 'voice.webm',
        contentType: 'audio/webm',
      }),
    );
    expect(url.origin + url.pathname).toBe(
      'https://api.cloudinary.com/v1_1/demo-cloud/video/download',
    );
    const q = url.searchParams;
    expect(q.get('type')).toBe('private');
    expect(q.get('format')).toBe('webm');
    expect(q.get('attachment')).toBe('true');
    expect(Number(q.get('expires_at'))).toBe(1315060510 + 300);
    expect(q.get('api_key')).toBe(cfg.apiKey);
    expect(q.get('signature')).toBe(
      cloudinarySignature(
        {
          attachment: 'true',
          expires_at: 1315060810,
          format: 'webm',
          public_id: 'tenants/t1/complaint_attachment/c1/0a1b2c',
          timestamp: 1315060510,
          type: 'private',
        },
        cfg.apiSecret,
      ),
    );
    expect(url.toString()).not.toContain(cfg.apiSecret);
  });

  it('delivers for viewing, not as a download, when asked to', async () => {
    const s = new CloudinaryStorage(cfg, fakeFetch(() => ({})).fn, () => NOW);
    const u = new URL(
      await s.signedGetUrl(key, {
        expiresSec: 300,
        filename: 'voice.webm',
        contentType: 'audio/webm',
        inline: true,
      }),
    );
    expect(u.searchParams.get('attachment')).toBeNull();
  });

  it('deletes signed, and treats an already-missing file as deleted', async () => {
    const ok = fakeFetch(() => ({ body: { result: 'ok' } }));
    await new CloudinaryStorage(cfg, ok.fn, () => NOW).delete(key);
    expect(ok.calls[0]!.url).toBe('https://api.cloudinary.com/v1_1/demo-cloud/video/destroy');
    expect(ok.calls[0]!.params!.get('type')).toBe('private');
    expect(ok.calls[0]!.params!.get('invalidate')).toBe('true');
    expect(ok.calls[0]!.params!.get('signature')).toHaveLength(40);
    const gone = fakeFetch(() => ({ body: { result: 'not found' } }));
    await expect(
      new CloudinaryStorage(cfg, gone.fn, () => NOW).delete(key),
    ).resolves.toBeUndefined();
    const bad = fakeFetch(() => ({ body: { result: 'error' } }));
    await expect(new CloudinaryStorage(cfg, bad.fn, () => NOW).delete(key)).rejects.toThrow();
  });
});
