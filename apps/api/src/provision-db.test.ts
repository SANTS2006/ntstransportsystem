import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { grantBlocks, pooledHost } from '../scripts/provision-db.js';

describe('provision-db helpers', () => {
  it('finds the privilege block of every migration that has one, in order', () => {
    const dir = resolve(import.meta.dirname, '../prisma/migrations');
    const sql = readdirSync(dir)
      .filter((n) => /^\d/.test(n))
      .sort()
      .map((n) => readFileSync(resolve(dir, n, 'migration.sql'), 'utf8'));
    const blocks = grantBlocks(sql);
    expect(blocks.length).toBeGreaterThanOrEqual(16);
    for (const b of blocks) {
      expect(b.startsWith('DO $$')).toBe(true);
      expect(b.endsWith('END $$;')).toBe(true);
    }
    // The cut-off privileges come after the grants they cut back.
    const grantAll = blocks.findIndex((b) => b.includes('ALL TABLES IN SCHEMA'));
    const revokeDelete = blocks.findIndex((b) => b.includes('REVOKE DELETE ON TABLES'));
    expect(grantAll).toBeGreaterThanOrEqual(0);
    expect(revokeDelete).toBeGreaterThan(grantAll);
  });

  it('ignores blocks that are not about the app role', () => {
    expect(grantBlocks(['DO $$ BEGIN PERFORM 1; END $$;'])).toEqual([]);
  });

  it('turns a Neon host into its pooled host exactly once', () => {
    expect(pooledHost('ep-cool-1234.us-east-2.aws.neon.tech')).toBe(
      'ep-cool-1234-pooler.us-east-2.aws.neon.tech',
    );
    expect(pooledHost('ep-cool-1234-pooler.us-east-2.aws.neon.tech')).toBe(
      'ep-cool-1234-pooler.us-east-2.aws.neon.tech',
    );
  });
});
