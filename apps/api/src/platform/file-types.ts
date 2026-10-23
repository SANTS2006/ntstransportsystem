/**
 * Uploads are identified by their content, never by the file name or the Content-Type header the
 * client sent. Only formats we can recognise by their signature are accepted: PDF, PNG, JPEG.
 */
export interface DetectedFile {
  ext: 'pdf' | 'png' | 'jpg';
  contentType: 'application/pdf' | 'image/png' | 'image/jpeg';
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detectFileType(b: Buffer): DetectedFile | null {
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { ext: 'pdf', contentType: 'application/pdf' };
  }
  if (b.length >= 8 && b.subarray(0, 8).equals(PNG))
    return { ext: 'png', contentType: 'image/png' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  return null;
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
