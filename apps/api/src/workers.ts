import type { Logger } from 'pino';
import { NotificationService } from './modules/notifications/notification.service.js';
import type { Mailer } from './modules/notifications/mailer.js';
import { BookingService } from './modules/booking/booking.service.js';
import type { Db } from './platform/db.js';
import { OutboxProcessor } from './platform/outbox.js';

const OUTBOX_BATCH_SIZE = 25;
const OUTBOX_MAX_BATCHES_PER_TICK = 8;

export interface WorkerDeps {
  db: Db;
  mailer: Mailer;
  appUrl: string;
  logger: Logger;
}

/** Runs `job` every `everyMs`, never overlapping itself and never crashing the process. */
function every(name: string, everyMs: number, logger: Logger, job: () => Promise<void>) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    job()
      .catch((err: unknown) =>
        logger.error(
          { err: err instanceof Error ? err.message : 'failed', job: name },
          'background job failed',
        ),
      )
      .finally(() => {
        running = false;
      });
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Background work that runs inside the API process: freeing seats held by unpaid bookings, and
 * delivering outbox events (passenger and staff emails). Both are safe to run on several
 * instances at once (the outbox claims rows with SKIP LOCKED).
 */
export function startWorkers({ db, mailer, appUrl, logger }: WorkerDeps): () => void {
  const bookings = new BookingService(db);
  const outbox = new OutboxProcessor(db, new NotificationService(db, mailer, appUrl).handlers(), {
    batchSize: OUTBOX_BATCH_SIZE,
  });

  const stopSweep = every('booking-expiry', 60_000, logger, async () => {
    const n = await bookings.expireDue();
    if (n > 0) logger.info({ expired: n }, 'expired unpaid bookings');
  });
  const stopOutbox = every('outbox', 10_000, logger, async () => {
    // A full batch means more is probably waiting: keep going (bounded) rather than
    // delivering a burst of events at one batch per tick.
    for (let i = 0; i < OUTBOX_MAX_BATCHES_PER_TICK; i++) {
      const r = await outbox.runOnce();
      if (r.deadLettered > 0) {
        logger.error({ ...r }, 'outbox events dead-lettered: operator attention needed');
      } else if (r.claimed > 0) {
        logger.info({ ...r }, 'outbox batch processed');
      }
      if (r.claimed < OUTBOX_BATCH_SIZE) break;
    }
  });
  return () => {
    stopSweep();
    stopOutbox();
  };
}
