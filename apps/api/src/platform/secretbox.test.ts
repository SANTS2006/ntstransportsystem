import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecretBox } from './secretbox.js';

const key = () => randomBytes(32).toString('base64');

describe('SecretBox', () => {
  it('round-trips and never repeats ciphertext', () => {
    const box = new SecretBox(key());
    const a = box.encrypt('JBSWY3DPEHPK3PXP');
    expect(box.decrypt(a)).toBe('JBSWY3DPEHPK3PXP');
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.encrypt('JBSWY3DPEHPK3PXP')).not.toBe(a);
  });
  it('rejects tampering and a different key', () => {
    const box = new SecretBox(key());
    const enc = box.encrypt('secret');
    const parts = enc.split('.');
    parts[3] = Buffer.from('forged').toString('base64url');
    expect(() => box.decrypt(parts.join('.'))).toThrow();
    expect(() => new SecretBox(key()).decrypt(enc)).toThrow();
  });
  it('rejects keys of the wrong length', () => {
    expect(() => new SecretBox(Buffer.from('short').toString('base64'))).toThrow();
  });
});
