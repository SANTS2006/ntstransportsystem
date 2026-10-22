import type { Prisma } from '../generated/prisma/client.js';
import { withDb, type Db, type Tx } from './db.js';

export interface OutboxInput {
  tenantId: string;
  type: string;
  payload: Prisma.InputJsonValue;
  /** Same key => at most one event (idempotent enqueue). */
  dedupeKey?: string | undefined;
  availableAt?: Date | undefined;
}

/**
 * Writes an outbox event inside the caller's transaction, so the event exists if and only if the
 * change that caused it committed. Uses createMany + skipDuplicates so a repeated dedupeKey is a
 * silent no-op instead of an error.
 */
export async function enqueueOutbox(tx: Tx, e: OutboxInput): Promise<void> {
  await tx.outboxEvent.createMany({
    data: [
      {
        tenantId: e.tenantId,
        type: e.type,
        payload: e.payload,
        dedupeKey: e.dedupeKey ?? null,
        ...(e.availableAt ? { availableAt: e.availableAt } : {}),
      },
    ],
    skipDuplicates: true,
  });
}

export interface ClaimedEvent {
  id: string;
  tenantId: string;
  type: string;
  payload: unknown;
  attempts: number;
}
export type OutboxHandler = (event: ClaimedEvent) => Promise<void>;

export interface ProcessorOptions {
  batchSize?: number;
  /** How long a claimed event stays invisible to other workers if this one dies mid-way. */
  leaseMs?: number;
  maxAttempts?: number;
  backoffBaseMs?: number;
  now?: () => Date;
  random?: () => number;
  /** Only process this company's events (tests, or an operator draining one company). */
  tenantId?: string;
}

const truncate = (s: string) => s.slice(0, 300);

/**
 * Processes outbox events safely with any number of concurrent workers:
 *  - rows are claimed with FOR UPDATE SKIP LOCKED and leased (available_at pushed forward), so two
 *    workers never take the same row and a crashed worker's rows reappear after the lease;
 *  - failures retry with exponential backoff and jitter; after `maxAttempts` the event is
 *    dead-lettered (failed_at) for an operator rather than retried forever;
 *  - handlers must be idempotent: delivery is at-least-once.
 * Runs in platform scope (it spans tenants). Errors stored are truncated and never include payloads.
 */
export class OutboxProcessor {
  private readonly batchSize: number;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly tenantId: string | undefined;

  constructor(
    private readonly db: Db,
    private readonly handlers: Record<string, OutboxHandler>,
    opts: ProcessorOptions = {},
  ) {
    this.batchSize = opts.batchSize ?? 20;
    this.leaseMs = opts.leaseMs ?? 60_000;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.backoffBaseMs = opts.backoffBaseMs ?? 30_000;
    this.now = opts.now ?? (() => new Date());
    this.random = opts.random ?? Math.random;
    this.tenantId = opts.tenantId;
  }

  private async claim(): Promise<ClaimedEvent[]> {
    const now = this.now();
    const leaseUntil = new Date(now.getTime() + this.leaseMs);
    // Only claim types this worker can handle, so an older worker never dead-letters a newer type.
    const types = Object.keys(this.handlers);
    if (types.length === 0) return [];
    return withDb(this.db, { platform: true }, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "outbox_events"
        WHERE "processed_at" IS NULL AND "failed_at" IS NULL AND "available_at" <= ${now}
          AND "type" = ANY(${types})
          AND (${this.tenantId ?? null}::uuid IS NULL OR "tenant_id" = ${this.tenantId ?? null}::uuid)
        ORDER BY "available_at" ASC
        LIMIT ${this.batchSize}
        FOR UPDATE SKIP LOCKED`;
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      await tx.outboxEvent.updateMany({
        where: { id: { in: ids } },
        data: { attempts: { increment: 1 }, availableAt: leaseUntil },
      });
      const claimed = await tx.outboxEvent.findMany({
        where: { id: { in: ids } },
        orderBy: { createdAt: 'asc' },
      });
      return claimed.map((e) => ({
        id: e.id,
        tenantId: e.tenantId,
        type: e.type,
        payload: e.payload,
        attempts: e.attempts,
      }));
    });
  }

  /** Claims and processes one batch. Returns counts for monitoring. */
  async runOnce(): Promise<{
    claimed: number;
    processed: number;
    retried: number;
    deadLettered: number;
  }> {
    const events = await this.claim();
    let processed = 0;
    let retried = 0;
    let deadLettered = 0;
    for (const event of events) {
      const handler = this.handlers[event.type];
      try {
        if (!handler) throw new Error(`No handler registered for "${event.type}"`);
        await handler(event);
        await withDb(this.db, { platform: true }, (tx) =>
          tx.outboxEvent.updateMany({
            where: { id: event.id },
            data: { processedAt: this.now(), lastError: null },
          }),
        );
        processed++;
      } catch (err) {
        const message = truncate(err instanceof Error ? err.message : 'Handler failed');
        const exhausted = event.attempts >= this.maxAttempts;
        const backoff = this.backoffBaseMs * 2 ** (event.attempts - 1);
        await withDb(this.db, { platform: true }, (tx) =>
          tx.outboxEvent.updateMany({
            where: { id: event.id },
            data: exhausted
              ? { failedAt: this.now(), lastError: message }
              : {
                  availableAt: new Date(
                    this.now().getTime() + backoff + Math.floor(this.random() * backoff),
                  ),
                  lastError: message,
                },
          }),
        );
        if (exhausted) deadLettered++;
        else retried++;
      }
    }
    return { claimed: events.length, processed, retried, deadLettered };
  }
}
