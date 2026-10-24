import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_URL: z.url().default('http://localhost:5173'),
  API_URL: z.url().default('http://localhost:4000'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  // Neon: pooled URL for the app, direct URL for migrations.
  DATABASE_URL: z.string().min(1).optional(),
  DIRECT_DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  PAYMENTS_SANDBOX: bool,
  // Monime REST base URL (override only for a mock/proxy).
  MONIME_API_BASE: z.url().default('https://api.monime.io/v1'),
  // Multiplies auth rate limits. Exists so test suites that create many users are not throttled;
  // must be 1 in production (enforced below).
  RATE_LIMIT_SCALE: z.coerce.number().int().min(1).max(1000).default(1),
  // Brevo transactional email. The sender address must be verified in Brevo.
  BREVO_API_KEY: z.string().min(10).optional(),
  MAIL_FROM_EMAIL: z.email().optional(),
  MAIL_FROM_NAME: z.string().min(1).max(80).default('NTS Transport'),
  // Serve /api/v1/openapi.json and /api/v1/docs. Defaults to on outside production, off in production.
  API_DOCS_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  // Google Identity Services web client ID. Google sign-in is disabled when unset.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  // Text messages for sign-up codes. Twilio: account SID and auth token plus either a sender
  // (TWILIO_FROM) or a messaging service (TWILIO_MESSAGING_SERVICE_SID). Without them phone
  // sign-up is off in production, and codes are logged in development.
  TWILIO_ACCOUNT_SID: z.string().min(10).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(10).optional(),
  TWILIO_FROM: z.string().min(1).max(20).optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().min(10).optional(),
  // Brevo SMS (uses BREVO_API_KEY): set a sender name (up to 11 letters and digits) to send sign-up
  // codes through Brevo. Used when Twilio is not configured.
  BREVO_SMS_SENDER: z
    .string()
    .trim()
    .regex(/^([A-Za-z0-9]{1,11}|[0-9]{12,15})$/, 'up to 11 letters and digits, or 12 to 15 digits')
    .optional(),
  // TEST DEPLOYMENTS ONLY: in production mode, log each text (with its code) instead of sending it.
  ALLOW_DEV_SMS: bool,
  // Cloudinary for uploaded files, as three separate settings from the Cloudinary dashboard
  // ("API Keys"): the cloud name, the API key and the API secret. All three or none.
  // When set, Cloudinary is used before R2.
  CLOUDINARY_NAME: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]+$/, 'must be the cloud name only, e.g. my-cloud')
    .optional(),
  CLOUDINARY_API_KEY: z
    .string()
    .trim()
    .regex(/^[0-9]+$/, 'must be the numeric API key')
    .optional(),
  CLOUDINARY_API_SECRET: z.string().trim().min(8).optional(),
  // Alternative to the three above: cloudinary://<api_key>:<api_secret>@<cloud_name>.
  CLOUDINARY_URL: z
    .string()
    .regex(
      /^cloudinary:\/\/[^:/\s]+:[^@\s]+@[A-Za-z0-9_-]+\/?$/,
      'must look like cloudinary://<api_key>:<api_secret>@<cloud_name>',
    )
    .optional(),
  // Cloudflare R2 (S3-compatible) for uploaded documents. All four or none; uploads are off without them.
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET: z.string().min(1).optional(),
  // Serve the built web app (apps/web/dist) from this API process, so one origin hosts both.
  // Relative paths resolve against the working directory. Unset: the API only serves /api and /health.
  WEB_DIST_DIR: z.string().min(1).optional(),
  // TEST DEPLOYMENTS ONLY: allow production mode without Brevo, logging each e-mail (including
  // verification and reset links) instead of sending it. Anyone who can read the logs can use them.
  ALLOW_DEV_MAILER: bool,
  // Development only: keep uploads in this directory instead of R2.
  STORAGE_DEV_DIR: z.string().min(1).optional(),
  // 32 random bytes, base64. Encrypts TOTP seeds at rest. Generate: openssl rand -base64 32
  MFA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded')
    .optional(),
});

export const envSchema = baseSchema.superRefine((env, ctx) => {
  const r2 = [env.R2_ACCOUNT_ID, env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY, env.R2_BUCKET];
  if (r2.some(Boolean) && !r2.every(Boolean)) {
    ctx.addIssue({
      code: 'custom',
      path: ['R2_BUCKET'],
      message:
        'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET must all be set together',
    });
  }
  const cloudinary = [env.CLOUDINARY_NAME, env.CLOUDINARY_API_KEY, env.CLOUDINARY_API_SECRET];
  if (cloudinary.some(Boolean) && !cloudinary.every(Boolean)) {
    ctx.addIssue({
      code: 'custom',
      path: ['CLOUDINARY_API_SECRET'],
      message:
        'CLOUDINARY_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET must all be set together',
    });
  }
  const twilio = [env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN];
  if (twilio.some(Boolean) && !twilio.every(Boolean)) {
    ctx.addIssue({
      code: 'custom',
      path: ['TWILIO_AUTH_TOKEN'],
      message: 'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set together',
    });
  }
  if (twilio.every(Boolean) && !env.TWILIO_FROM && !env.TWILIO_MESSAGING_SERVICE_SID) {
    ctx.addIssue({
      code: 'custom',
      path: ['TWILIO_FROM'],
      message: 'Set TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID so texts have a sender',
    });
  }
  if (env.NODE_ENV === 'production' && env.STORAGE_DEV_DIR) {
    ctx.addIssue({
      code: 'custom',
      path: ['STORAGE_DEV_DIR'],
      message: 'STORAGE_DEV_DIR is for development only; use R2 in production',
    });
  }
  if (env.NODE_ENV !== 'production') return;
  const required = [
    'DATABASE_URL',
    'REDIS_URL',
    'SESSION_SECRET',
    'MFA_ENCRYPTION_KEY',
    ...(env.ALLOW_DEV_MAILER ? [] : (['BREVO_API_KEY', 'MAIL_FROM_EMAIL'] as const)),
  ] as const;
  for (const key of required) {
    if (!env[key]) {
      ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required in production` });
    }
  }
  if (env.RATE_LIMIT_SCALE !== 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['RATE_LIMIT_SCALE'],
      message: 'Rate limits must not be scaled in production',
    });
  }
  if (env.PAYMENTS_SANDBOX) {
    ctx.addIssue({
      code: 'custom',
      path: ['PAYMENTS_SANDBOX'],
      message: 'Payment sandbox mode must not be enabled in production',
    });
  }
  if (!env.APP_URL.startsWith('https://')) {
    ctx.addIssue({
      code: 'custom',
      path: ['APP_URL'],
      message: 'APP_URL must be https in production',
    });
  }
  if (env.CORS_ORIGINS.includes('*')) {
    ctx.addIssue({
      code: 'custom',
      path: ['CORS_ORIGINS'],
      message: 'Wildcard CORS is not allowed',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // A blank value (e.g. `REDIS_URL=` copied from .env.example) means "not configured".
  const present: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''),
  );
  // On Render the service's own public https URL is provided, and the app and API share it when
  // the API serves the web app. Explicit settings always win.
  const self = present.RENDER_EXTERNAL_URL;
  if (self) {
    present.APP_URL ??= self;
    present.API_URL ??= self;
    present.CORS_ORIGINS ??= self;
  }
  const parsed = envSchema.safeParse(present);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}
