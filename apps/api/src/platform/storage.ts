import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Where uploaded documents live. Objects are private; access is through short-lived signed URLs. */
export interface FileStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** A link that works for `expiresSec` seconds and downloads the object under `filename`. */
  signedGetUrl(
    key: string,
    opts: { expiresSec: number; filename: string; contentType: string; inline?: boolean },
  ): Promise<string>;
  delete(key: string): Promise<void>;
}

/** Object keys are built by the server from ids; this is the shape we accept anywhere a key is read. */
export const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,300}$/;
export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.includes('//'))
    throw new Error('Unsafe storage key');
}

// ---- Cloudflare R2 (S3-compatible) -----------------------------------------------------------------

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export class R2Storage implements FileStorage {
  private readonly client: S3Client;
  constructor(private readonly cfg: R2Config) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }
  async signedGetUrl(
    key: string,
    opts: { expiresSec: number; filename: string; contentType: string; inline?: boolean },
  ): Promise<string> {
    assertSafeKey(key);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        ResponseContentType: opts.contentType,
        // A download, unless the caller asked to show an image or play audio/video (never in our origin).
        ResponseContentDisposition: `${opts.inline ? 'inline' : 'attachment'}; filename="${opts.filename.replace(/["\\]/g, '')}"`,
      }),
      { expiresIn: opts.expiresSec },
    );
  }
  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
}

// ---- Local disk (development only) -------------------------------------------------------------------

/**
 * Writes files under a directory and serves them through a signed URL on this API
 * (see devFilesRouter). For local development without a cloud account; production refuses it.
 */
export class LocalDiskStorage implements FileStorage {
  constructor(
    private readonly dir: string,
    private readonly secret: Buffer,
    private readonly apiUrl: string,
  ) {}

  pathOf(key: string): string {
    assertSafeKey(key);
    const root = resolve(this.dir);
    const full = resolve(root, key);
    if (!full.startsWith(root + sep)) throw new Error('Unsafe storage key');
    return full;
  }
  async put(key: string, body: Buffer): Promise<void> {
    const p = this.pathOf(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  async read(key: string): Promise<Buffer> {
    return readFile(this.pathOf(key));
  }
  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }
  sign(key: string, exp: number, filename: string, contentType: string, inline = false): string {
    return createHmac('sha256', this.secret)
      .update(`${key}\n${exp}\n${filename}\n${contentType}\n${inline ? 'inline' : 'attachment'}`)
      .digest('base64url');
  }
  verify(
    key: string,
    exp: number,
    filename: string,
    contentType: string,
    sig: string,
    inline = false,
  ): boolean {
    if (!Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000)) return false;
    const a = Buffer.from(this.sign(key, exp, filename, contentType, inline));
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  async signedGetUrl(
    key: string,
    opts: { expiresSec: number; filename: string; contentType: string; inline?: boolean },
  ): Promise<string> {
    assertSafeKey(key);
    const exp = Math.floor(Date.now() / 1000) + opts.expiresSec;
    const q = new URLSearchParams({
      key,
      exp: String(exp),
      fn: opts.filename,
      ct: opts.contentType,
      ...(opts.inline ? { in: '1' } : {}),
      sig: this.sign(key, exp, opts.filename, opts.contentType, opts.inline === true),
    });
    return `${this.apiUrl.replace(/\/$/, '')}/api/v1/dev-files?${q.toString()}`;
  }
}

// ---- In memory (tests) ---------------------------------------------------------------------------------

export class MemoryStorage implements FileStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  failNextPut = false;
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error('storage unavailable');
    }
    this.objects.set(key, { body, contentType });
  }
  async signedGetUrl(
    key: string,
    opts: { expiresSec: number; filename: string; inline?: boolean },
  ): Promise<string> {
    assertSafeKey(key);
    return `https://files.test/${key}?expires=${opts.expiresSec}&filename=${encodeURIComponent(opts.filename)}${opts.inline ? '&inline=1' : ''}`;
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
