import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { detectFileType, safeFilename } from './file-types.js';
import { LocalDiskStorage, MemoryStorage, R2Storage, assertSafeKey } from './storage.js';

describe('file type detection', () => {
  it('recognises PDF, PNG and JPEG by content', () => {
    expect(detectFileType(Buffer.from('%PDF-1.7\n...'))).toEqual({
      ext: 'pdf',
      contentType: 'application/pdf',
      media: 'document',
    });
    expect(
      detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])),
    ).toEqual({ ext: 'png', contentType: 'image/png', media: 'image' });
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toEqual({
      ext: 'jpg',
      contentType: 'image/jpeg',
      media: 'image',
    });
  });
  it('rejects everything else, whatever it claims to be', () => {
    for (const b of [
      Buffer.from('MZ\x90\x00 an exe'),
      Buffer.from('<script>alert(1)</script>'),
      Buffer.from('<svg onload=alert(1)></svg>'),
      Buffer.from('PK\x03\x04 zip or docx'),
      Buffer.from('%PD'),
      Buffer.alloc(0),
      Buffer.from('GIF89a'),
    ]) {
      expect(detectFileType(b)).toBeNull();
    }
  });
});

describe('filenames', () => {
  it('drops paths, control characters, quotes and header-injection, and uses the detected extension', () => {
    expect(safeFilename('C:\\Users\\me\\My CV (final).docx', 'cv', 'pdf')).toBe(
      'My CV (final).pdf',
    );
    expect(safeFilename('../../etc/passwd', 'cv', 'pdf')).toBe('passwd.pdf');
    expect(safeFilename('a"b\r\nSet-Cookie: x=1.pdf', 'cv', 'pdf')).toBe('abSet-Cookie x1.pdf');
    expect(safeFilename('   ...   ', 'cv', 'png')).toBe('cv.png');
    expect(safeFilename(undefined, 'attachment', 'jpg')).toBe('attachment.jpg');
    expect(safeFilename('x'.repeat(300), 'cv', 'pdf').length).toBeLessThanOrEqual(84);
    expect(safeFilename('résumé.pdf', 'cv', 'pdf')).toBe('resume.pdf');
  });
});

describe('storage keys', () => {
  it('accepts server-built keys and refuses traversal and odd characters', () => {
    expect(() => assertSafeKey('tenants/1f/applications/2a/cv-3b.pdf')).not.toThrow();
    for (const bad of [
      '../x',
      'a/../b',
      '/abs',
      'a//b',
      'a b',
      'a\\b',
      'a\u0000b',
      '',
      '.hidden',
      'x'.repeat(400),
    ]) {
      expect(() => assertSafeKey(bad)).toThrow();
    }
  });
});

describe('LocalDiskStorage', () => {
  let dir: string | undefined;
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('stores files inside its directory only and issues expiring, tamper-proof links', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nts-storage-'));
    const s = new LocalDiskStorage(dir, Buffer.alloc(32, 7), 'http://api.test');
    await s.put('tenants/t1/x/a.pdf', Buffer.from('%PDF-1'));
    expect((await s.read('tenants/t1/x/a.pdf')).toString()).toBe('%PDF-1');
    await expect(s.put('../escape.pdf', Buffer.from('x'))).rejects.toThrow();
    expect(() => s.pathOf('a/../../etc/passwd')).toThrow();

    const url = new URL(
      await s.signedGetUrl('tenants/t1/x/a.pdf', {
        expiresSec: 60,
        filename: 'cv.pdf',
        contentType: 'application/pdf',
      }),
    );
    const p = url.searchParams;
    const ok = (over: Record<string, string> = {}) =>
      s.verify(
        over.key ?? p.get('key')!,
        Number(over.exp ?? p.get('exp')),
        over.fn ?? p.get('fn')!,
        over.ct ?? p.get('ct')!,
        over.sig ?? p.get('sig')!,
      );
    expect(ok()).toBe(true);
    expect(ok({ key: 'tenants/t1/x/b.pdf' })).toBe(false); // another file
    expect(ok({ fn: 'evil.pdf' })).toBe(false); // another download name
    expect(ok({ ct: 'text/html' })).toBe(false); // another type
    expect(ok({ exp: String(Number(p.get('exp')) + 3600) })).toBe(false); // longer lifetime
    expect(ok({ sig: 'AAAA' })).toBe(false);
    const old = Math.floor(Date.now() / 1000) - 1;
    expect(
      s.verify(
        'tenants/t1/x/a.pdf',
        old,
        'cv.pdf',
        'application/pdf',
        s.sign('tenants/t1/x/a.pdf', old, 'cv.pdf', 'application/pdf'),
      ),
    ).toBe(false); // expired
    await s.delete('tenants/t1/x/a.pdf');
    await expect(s.read('tenants/t1/x/a.pdf')).rejects.toThrow();
  });
});

describe('R2Storage', () => {
  it('presigns short-lived download links as attachments, without any network call', async () => {
    const r2 = new R2Storage({
      accountId: 'acc123',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'secretsecretsecretsecretsecret',
      bucket: 'nts-docs',
    });
    const url = new URL(
      await r2.signedGetUrl('tenants/t1/cv/a.pdf', {
        expiresSec: 300,
        filename: 'My "CV".pdf',
        contentType: 'application/pdf',
      }),
    );
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('nts-docs.acc123.r2.cloudflarestorage.com');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="My CV.pdf"',
    );
    expect(url.searchParams.get('response-content-type')).toBe('application/pdf');
    expect(url.toString()).not.toContain('secretsecret');
    await expect(
      r2.signedGetUrl('../x', {
        expiresSec: 60,
        filename: 'a.pdf',
        contentType: 'application/pdf',
      }),
    ).rejects.toThrow();
  });
});

describe('MemoryStorage', () => {
  it('can simulate an outage once', async () => {
    const m = new MemoryStorage();
    m.failNextPut = true;
    await expect(m.put('a/b.pdf', Buffer.from('x'), 'application/pdf')).rejects.toThrow();
    await m.put('a/b.pdf', Buffer.from('x'), 'application/pdf');
    expect(m.objects.size).toBe(1);
  });
});
