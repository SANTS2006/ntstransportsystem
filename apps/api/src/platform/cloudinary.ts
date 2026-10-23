import { createHash } from 'node:crypto';
import { assertSafeKey, type FileStorage } from './storage.js';

/**
 * Cloudinary as the place uploaded files live (images, photos, video, voice messages, PDFs).
 *
 * Every file is stored with `type=private`: the original can only be fetched through a signed,
 * time-limited download link made here, never by guessing a URL. Uploads and deletes go through
 * Cloudinary's REST API signed with the API secret; the secret never leaves this process.
 *
 * Cloudinary has three "resource types": images and PDFs are `image`, and both video and audio are
 * `video`. A stored key looks like `tenants/<company>/<kind>/<owner>/<uuid>.<ext>`; the public id
 * in Cloudinary is the key without its extension, and the extension is the format.
 */
export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

/** Parses the standard `cloudinary://<api_key>:<api_secret>@<cloud_name>` setting. */
export function parseCloudinaryUrl(raw: string): CloudinaryConfig {
  const m = /^cloudinary:\/\/([^:/\s]+):([^@\s]+)@([A-Za-z0-9_-]+)\/?$/.exec(raw.trim());
  if (!m)
    throw new Error(
      'CLOUDINARY_URL must look like cloudinary://<api_key>:<api_secret>@<cloud_name>',
    );
  return { apiKey: m[1] as string, apiSecret: m[2] as string, cloudName: m[3] as string };
}

/**
 * Cloudinary's request signature: the parameters (without `file`, `cloud_name`, `resource_type`,
 * `api_key`) sorted by name, joined as `name=value` with `&`, the API secret appended, then hashed.
 * SHA-1 is the documented default.
 */
export function cloudinarySignature(
  params: Record<string, string | number | boolean | undefined>,
  apiSecret: string,
): string {
  const text = Object.entries(params)
    .filter(
      ([k, v]) =>
        v !== undefined &&
        v !== '' &&
        !['file', 'cloud_name', 'resource_type', 'api_key', 'signature'].includes(k),
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&');
  return createHash('sha1')
    .update(text + apiSecret)
    .digest('hex');
}

type ResourceType = 'image' | 'video';

const FORMATS: Record<string, { resource: ResourceType; format: string }> = {
  pdf: { resource: 'image', format: 'pdf' },
  png: { resource: 'image', format: 'png' },
  jpg: { resource: 'image', format: 'jpg' },
  webp: { resource: 'image', format: 'webp' },
  mp4: { resource: 'video', format: 'mp4' },
  m4a: { resource: 'video', format: 'm4a' },
  mov: { resource: 'video', format: 'mov' },
  webm: { resource: 'video', format: 'webm' },
  ogg: { resource: 'video', format: 'ogg' },
  ogv: { resource: 'video', format: 'ogv' },
  mp3: { resource: 'video', format: 'mp3' },
  wav: { resource: 'video', format: 'wav' },
};

/** Where a stored key lives in Cloudinary. */
export function cloudinaryRef(key: string): {
  resource: ResourceType;
  publicId: string;
  format: string;
} {
  assertSafeKey(key);
  const dot = key.lastIndexOf('.');
  const ext = dot > 0 ? key.slice(dot + 1).toLowerCase() : '';
  const f = FORMATS[ext];
  if (!f) throw new Error('Unsupported file extension for Cloudinary storage');
  return { resource: f.resource, publicId: key.slice(0, dot), format: f.format };
}

type FetchFn = typeof fetch;

export class CloudinaryStorage implements FileStorage {
  constructor(
    private readonly cfg: CloudinaryConfig,
    private readonly http: FetchFn = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private api(resource: ResourceType, action: string): string {
    return `https://api.cloudinary.com/v1_1/${this.cfg.cloudName}/${resource}/${action}`;
  }
  private ts(): number {
    return Math.floor(this.now() / 1000);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const ref = cloudinaryRef(key);
    const signed = { public_id: ref.publicId, timestamp: this.ts(), type: 'private' };
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(body)], { type: contentType }), `file.${ref.format}`);
    form.set('api_key', this.cfg.apiKey);
    form.set('signature', cloudinarySignature(signed, this.cfg.apiSecret));
    for (const [k, v] of Object.entries(signed)) form.set(k, String(v));
    const res = await this.http(this.api(ref.resource, 'upload'), { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Cloudinary upload failed (${res.status})`);
    const out = (await res.json().catch(() => null)) as { public_id?: string } | null;
    if (!out || out.public_id !== ref.publicId)
      throw new Error('Cloudinary upload was not confirmed');
  }

  /**
   * A private download link that stops working after `expiresSec`. Images, audio and video that the
   * app plays or shows itself (`inline`) are delivered for viewing; everything else is a download.
   */
  async signedGetUrl(
    key: string,
    opts: { expiresSec: number; filename: string; contentType: string; inline?: boolean },
  ): Promise<string> {
    const ref = cloudinaryRef(key);
    const signed: Record<string, string | number> = {
      public_id: ref.publicId,
      format: ref.format,
      type: 'private',
      timestamp: this.ts(),
      expires_at: this.ts() + opts.expiresSec,
      ...(opts.inline ? {} : { attachment: 'true' }),
    };
    const q = new URLSearchParams(Object.entries(signed).map(([k, v]) => [k, String(v)]));
    q.set('api_key', this.cfg.apiKey);
    q.set('signature', cloudinarySignature(signed, this.cfg.apiSecret));
    return `${this.api(ref.resource, 'download')}?${q.toString()}`;
  }

  async delete(key: string): Promise<void> {
    const ref = cloudinaryRef(key);
    const signed = {
      public_id: ref.publicId,
      timestamp: this.ts(),
      type: 'private',
      invalidate: 'true',
    };
    const form = new URLSearchParams({
      ...Object.fromEntries(Object.entries(signed).map(([k, v]) => [k, String(v)])),
      api_key: this.cfg.apiKey,
      signature: cloudinarySignature(signed, this.cfg.apiSecret),
    });
    const res = await this.http(this.api(ref.resource, 'destroy'), { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Cloudinary delete failed (${res.status})`);
    const out = (await res.json().catch(() => null)) as { result?: string } | null;
    // "not found" means it is already gone, which is what we wanted.
    if (!out || (out.result !== 'ok' && out.result !== 'not found')) {
      throw new Error('Cloudinary delete was not confirmed');
    }
  }
}
