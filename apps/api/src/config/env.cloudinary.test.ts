import { describe, expect, it } from 'vitest';
import { envSchema } from './env.js';

describe('Cloudinary settings', () => {
  it('accepts the three separate settings, trimming stray spaces', () => {
    const r = envSchema.safeParse({
      CLOUDINARY_NAME: ' my-cloud ',
      CLOUDINARY_API_KEY: '123456789012345',
      CLOUDINARY_API_SECRET: 'abcDEF_123-xyz',
    });
    expect(r.success).toBe(true);
    expect(r.data?.CLOUDINARY_NAME).toBe('my-cloud');
  });
  it('needs all three together', () => {
    const r = envSchema.safeParse({ CLOUDINARY_NAME: 'my-cloud' });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('must all be set together');
  });
  it('rejects a whole URL pasted as the cloud name', () => {
    const r = envSchema.safeParse({
      CLOUDINARY_NAME: 'cloudinary://1:2@x',
      CLOUDINARY_API_KEY: '1',
      CLOUDINARY_API_SECRET: 'abcdefgh',
    });
    expect(r.success).toBe(false);
  });
});
