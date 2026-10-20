import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Single .env at the repository root (apps/api/src/config -> repo root).
config({ path: resolve(fileURLToPath(import.meta.url), '../../../../../.env'), quiet: true });
