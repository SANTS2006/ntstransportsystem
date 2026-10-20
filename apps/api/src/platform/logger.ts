import { pino, type Logger } from 'pino';
import type { Env } from '../config/env.js';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.idToken',
  '*.secret',
  '*.apiKey',
];

export function createLogger(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  return pino({
    // Tests are quiet unless TEST_LOGS=1 (to see server-side causes of a 500 while debugging).
    level: env.NODE_ENV === 'test' && process.env.TEST_LOGS !== '1' ? 'silent' : env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  });
}
