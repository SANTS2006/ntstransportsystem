import './config/dotenv.js';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { BrevoMailer } from './modules/notifications/brevo.mailer.js';
import { DevLogMailer, type Mailer } from './modules/notifications/mailer.js';
import { createDb } from './platform/db.js';
import { createLogger } from './platform/logger.js';
import { createRedis, redisRateLimitStores } from './platform/redis.js';
import { startWorkers } from './workers.js';

const env = loadEnv();
const logger = createLogger(env);

function buildMailer(): Mailer {
  if (env.BREVO_API_KEY && env.MAIL_FROM_EMAIL) {
    return new BrevoMailer({
      apiKey: env.BREVO_API_KEY,
      senderEmail: env.MAIL_FROM_EMAIL,
      senderName: env.MAIL_FROM_NAME,
    });
  }
  // loadEnv guarantees Brevo settings exist in production unless ALLOW_DEV_MAILER is set.
  logger.warn(
    env.NODE_ENV === 'production'
      ? 'ALLOW_DEV_MAILER is on: emails (with their links) are logged, NOT sent. Test deployments only.'
      : 'BREVO_API_KEY/MAIL_FROM_EMAIL not set: emails are logged, not sent (development only)',
  );
  return new DevLogMailer(logger);
}

const db = env.DATABASE_URL ? createDb(env.DATABASE_URL) : undefined;
const redis = env.REDIS_URL ? createRedis(env.REDIS_URL) : undefined;
redis?.on('error', (err: Error) => logger.error({ err: err.message }, 'redis error'));

const readinessChecks = [
  ...(db ? [{ name: 'database', check: async () => void (await db.$queryRaw`SELECT 1`) }] : []),
  ...(redis ? [{ name: 'redis', check: async () => void (await redis.ping()) }] : []),
];
if (!db) logger.warn('DATABASE_URL not set: auth and data routes are disabled');
if (!redis) logger.warn('REDIS_URL not set: rate limits are per-instance, in memory');

const app = createApp({
  env,
  logger,
  readinessChecks,
  ...(db ? { db, mailer: buildMailer() } : {}),
  ...(redis ? { rateLimitStores: redisRateLimitStores(redis) } : {}),
});

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'api listening');
});

// Background work: expire unpaid bookings, deliver passenger/staff emails from the outbox.
const stopWorkers = db
  ? startWorkers({ db, mailer: buildMailer(), appUrl: env.APP_URL, logger })
  : () => undefined;

function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  stopWorkers();
  server.close(() => {
    void Promise.allSettled([db?.$disconnect(), redis?.quit()]).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
