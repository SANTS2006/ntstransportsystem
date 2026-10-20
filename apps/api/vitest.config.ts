import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@nts/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    setupFiles: ['./src/config/dotenv.ts'],
    // DB tests share one database and truncate between suites.
    fileParallelism: false,
    // Tests use a remote Neon branch; round trips from some regions take 0.5-2s each.
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
