/**
 * Uploads are identified by their content, never by the file name or the Content-Type header the
 * client sent. Only formats we can recognise by their signature are accepted:
 *
 *   documents  PDF
 *   images     PNG, JPEG, WebP
 *   audio      WebM, Ogg, MP4/M4A, MP3, WAV   (voice messages, recordings)
 *   video      MP4, WebM, MOV, Ogg
 *
 * WebM, Ogg and MP4 are containers that can hold sound or pictures; the bytes prove the container,
 * and the client's declared type (audio/* or video/*) only chooses which of the two it is. Nothing
 * else (GIF, SVG, HTML, scripts, archives) is accepted.
 */
export type MediaClass = 'document' | 'image' | 'audio' | 'video';

export interface DetectedFile {
  ext: string;
  contentType: string;
  media: MediaClass;
}

const MB = 1024 * 1024;
/** Largest accepted size per class. A voice message of two minutes is about 1 MB. */
export const MAX_BYTES: Record<MediaClass, number> = {
  document: 5 * MB,
  image: 5 * MB,
  audio: 10 * MB,
  video: 25 * MB,
};
/** Upper bound for the request body parser; the per-class limit is applied after detection. */
export const MAX_UPLOAD_BYTES = MAX_BYTES.video;

/** Content types the upload endpoints will read as a raw body. */
export const UPLOAD_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'audio/*',
  'video/*',
];

/** Every content type we can store, for the database constraint and documentation. */
export const STORED_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/ogg',
] as const;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString('latin1');

export function maxBytesFor(f: DetectedFile): number {
  return MAX_BYTES[f.media];
}

/**
 * `declared` is the Content-Type the client sent. It is trusted only to choose between audio and
 * video for a container that can be either; it never makes a non-media file acceptable.
 */
export function detectFileType(b: Buffer, declared?: string): DetectedFile | null {
  const wantsAudio = (declared ?? '').toLowerCase().trim().startsWith('audio/');
  const wantsVideo = (declared ?? '').toLowerCase().trim().startsWith('video/');

  if (b.length >= 5 && ascii(b, 0, 5) === '%PDF-') {
    return { ext: 'pdf', contentType: 'application/pdf', media: 'document' };
  }
  if (b.length >= 8 && b.subarray(0, 8).equals(PNG)) {
    return { ext: 'png', contentType: 'image/png', media: 'image' };
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg', media: 'image' };
  }
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF') {
    const kind = ascii(b, 8, 12);
    if (kind === 'WEBP') return { ext: 'webp', contentType: 'image/webp', media: 'image' };
    if (kind === 'WAVE') return { ext: 'wav', contentType: 'audio/wav', media: 'audio' };
    return null;
  }
  if (b.length >= 4 && b.subarray(0, 4).equals(EBML)) {
    return wantsAudio
      ? { ext: 'webm', contentType: 'audio/webm', media: 'audio' }
      : { ext: 'webm', contentType: 'video/webm', media: 'video' };
  }
  if (b.length >= 4 && ascii(b, 0, 4) === 'OggS') {
    return wantsVideo
      ? { ext: 'ogv', contentType: 'video/ogg', media: 'video' }
      : { ext: 'ogg', contentType: 'audio/ogg', media: 'audio' };
  }
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12);
    if (brand === 'qt  ') return { ext: 'mov', contentType: 'video/quicktime', media: 'video' };
    if (brand === 'M4A ' || brand === 'M4B ' || wantsAudio) {
      return { ext: 'm4a', contentType: 'audio/mp4', media: 'audio' };
    }
    return { ext: 'mp4', contentType: 'video/mp4', media: 'video' };
  }
  // MP3: an ID3 tag, or an MPEG audio frame header (eleven set bits).
  if (
    b.length >= 3 &&
    (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && b[1] !== undefined && (b[1] & 0xe0) === 0xe0))
  ) {
    return { ext: 'mp3', contentType: 'audio/mpeg', media: 'audio' };
  }
  return null;
}

/** The media class of a stored content type. */
export function mediaOf(contentType: string): MediaClass {
  if (contentType.startsWith('audio/')) return 'audio';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType.startsWith('image/')) return 'image';
  return 'document';
}

/**
 * A display name for downloads: no path, no control characters, no quotes, short, and with the
 * extension matching the detected type (so "cv.exe" uploaded as a PDF downloads as "cv.pdf").
 */
export function safeFilename(raw: string | undefined, fallback: string, ext: string): string {
  const base = (raw ?? '')
    .split(/[\\/]/)
    .pop()!
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ._()-]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 80);
  return `${base || fallback}.${ext}`;
}
