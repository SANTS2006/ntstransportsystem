import { describe, expect, it } from 'vitest';
import { MAX_BYTES, detectFileType, maxBytesFor, mediaOf } from './file-types.js';

const bytes = (...parts: (number[] | string)[]) =>
  Buffer.concat(
    parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))),
  );

const WEBM = [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81];
const ftyp = (brand: string) => bytes([0, 0, 0, 0x20], 'ftyp', brand, [0, 0, 0, 0]);

describe('media detection', () => {
  it('recognises WebP and WAV from their RIFF header', () => {
    expect(detectFileType(bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 '))).toMatchObject({
      ext: 'webp',
      contentType: 'image/webp',
      media: 'image',
    });
    expect(detectFileType(bytes('RIFF', [1, 2, 3, 4], 'WAVEfmt '))).toMatchObject({
      ext: 'wav',
      contentType: 'audio/wav',
      media: 'audio',
    });
    expect(detectFileType(bytes('RIFF', [1, 2, 3, 4], 'AVI LIST'))).toBeNull();
  });

  it('uses the declared type only to tell a voice message from a video in a shared container', () => {
    expect(detectFileType(Buffer.from(WEBM), 'audio/webm')).toMatchObject({
      contentType: 'audio/webm',
      media: 'audio',
    });
    expect(detectFileType(Buffer.from(WEBM), 'video/webm')).toMatchObject({
      contentType: 'video/webm',
      media: 'video',
    });
    expect(detectFileType(Buffer.from(WEBM))).toMatchObject({ media: 'video' });
    expect(detectFileType(bytes('OggS', [0, 2, 0, 0]), 'audio/ogg')).toMatchObject({
      contentType: 'audio/ogg',
      media: 'audio',
    });
    expect(detectFileType(bytes('OggS', [0, 2, 0, 0]), 'video/ogg')).toMatchObject({
      contentType: 'video/ogg',
      media: 'video',
    });
    expect(detectFileType(ftyp('isom'), 'audio/mp4')).toMatchObject({ ext: 'm4a', media: 'audio' });
    expect(detectFileType(ftyp('isom'), 'video/mp4')).toMatchObject({ ext: 'mp4', media: 'video' });
    expect(detectFileType(ftyp('M4A '))).toMatchObject({ ext: 'm4a', media: 'audio' });
    expect(detectFileType(ftyp('qt  '))).toMatchObject({
      ext: 'mov',
      contentType: 'video/quicktime',
    });
  });

  it('recognises MP3 by tag or frame, without mistaking a JPEG for one', () => {
    expect(detectFileType(bytes('ID3', [4, 0, 0]))).toMatchObject({ ext: 'mp3', media: 'audio' });
    expect(detectFileType(Buffer.from([0xff, 0xfb, 0x90, 0x00]))).toMatchObject({ ext: 'mp3' });
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({ ext: 'jpg' });
  });

  it('never lets a declared media type make something else acceptable', () => {
    for (const declared of ['audio/webm', 'video/mp4', 'image/png', 'application/pdf']) {
      expect(detectFileType(Buffer.from('<html><script>alert(1)</script>'), declared)).toBeNull();
      expect(detectFileType(Buffer.from('MZ\x90\x00 an exe'), declared)).toBeNull();
      expect(detectFileType(Buffer.from('GIF89a'), declared)).toBeNull();
    }
  });

  it('sets a size limit per class and classifies stored types', () => {
    expect(MAX_BYTES).toEqual({
      document: 5 * 1024 * 1024,
      image: 5 * 1024 * 1024,
      audio: 10 * 1024 * 1024,
      video: 25 * 1024 * 1024,
    });
    expect(maxBytesFor({ ext: 'mp4', contentType: 'video/mp4', media: 'video' })).toBe(
      25 * 1024 * 1024,
    );
    expect(mediaOf('audio/webm')).toBe('audio');
    expect(mediaOf('video/quicktime')).toBe('video');
    expect(mediaOf('image/webp')).toBe('image');
    expect(mediaOf('application/pdf')).toBe('document');
  });
});
