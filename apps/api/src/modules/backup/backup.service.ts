import { randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { withDb, type Db, type Tx } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';

/**
 * Tables that are never part of a backup: live sessions, one-time tokens and codes (restoring them
 * would resurrect logins and reset links), and queued notifications (they would be sent again).
 */
const SKIPPED = new Set([
  '_prisma_migrations',
  'sessions',
  'one_time_tokens',
  'phone_otps',
  'outbox_events',
]);

const FORMAT = 'nts-backup';
const VERSION = 1;
/**
 * Rows go to the database in large slices (by size, not count): every statement is a round trip,
 * and on a slow link the round trips, not the rows, are what take the time.
 */
const SLICE_BYTES = 2 * 1024 * 1024;
const SLICE_ROWS = 20_000;
/** Rows read per query when making a backup. */
const CHUNK_ROWS = 5_000;
/** A restore file larger than this is refused (it is held in memory while it is checked). */
export const MAX_RESTORE_BYTES = 80 * 1024 * 1024;

export interface BackupSummary {
  createdAt: string;
  tables: { name: string; rows: number }[];
  skipped: string[];
}
export interface RestoreReport {
  mode: 'check' | 'apply';
  createdAt: string;
  tables: { name: string; inFile: number; restored: number }[];
  restored: number;
  /** Tables in the file that this system's database account may not write to (left as they are). */
  notWritable: string[];
}

function* slices(rows: string[]): Generator<string[]> {
  let cur: string[] = [];
  let bytes = 0;
  for (const r of rows) {
    if (cur.length > 0 && (bytes + r.length > SLICE_BYTES || cur.length >= SLICE_ROWS)) {
      yield cur;
      cur = [];
      bytes = 0;
    }
    cur.push(r);
    bytes += r.length + 1;
  }
  if (cur.length > 0) yield cur;
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Backup and recovery of the platform's data as one file. A backup is a gzip-compressed text file
 * with one table row per line, written parents-first. Recovery is non-destructive: it adds back
 * the rows that are missing and never changes or deletes a row that exists, so restoring an old
 * file cannot damage what has happened since. A check runs the same restore and undoes it.
 */
export class BackupService {
  constructor(private readonly db: Db) {}

  /** The tables the database role can read, parents before the tables that refer to them. */
  private async orderedTables(tx: Tx): Promise<string[]> {
    const tables = (
      await tx.$queryRaw<{ name: string }[]>`
        SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    )
      .map((t) => t.name)
      .filter((n) => !SKIPPED.has(n));
    const links = await tx.$queryRaw<{ child: string; parent: string }[]>`
      SELECT cc.relname AS child, pc.relname AS parent
      FROM pg_constraint c
      JOIN pg_class cc ON cc.oid = c.conrelid
      JOIN pg_class pc ON pc.oid = c.confrelid
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`;
    const wanted = new Set(tables);
    const needs = new Map<string, Set<string>>(tables.map((t) => [t, new Set<string>()]));
    for (const l of links) {
      if (l.child !== l.parent && wanted.has(l.child) && wanted.has(l.parent)) {
        needs.get(l.child)!.add(l.parent);
      }
    }
    const out: string[] = [];
    const done = new Set<string>();
    while (out.length < tables.length) {
      const ready = tables.filter(
        (t) => !done.has(t) && [...needs.get(t)!].every((p) => done.has(p)),
      );
      // A circular reference between tables: take the rest in name order rather than loop forever.
      const next = ready.length > 0 ? ready : tables.filter((t) => !done.has(t)).slice(0, 1);
      for (const t of next.sort()) {
        out.push(t);
        done.add(t);
      }
    }
    return out;
  }

  /** The whole backup as one compressed file. */
  async create(): Promise<{ file: Buffer; summary: BackupSummary }> {
    const summary: BackupSummary = { createdAt: new Date().toISOString(), tables: [], skipped: [] };
    const names = await withDb(this.db, { platform: true }, (tx) => this.orderedTables(tx));
    const parts = new Map<string, string[]>();
    // A few tables at a time, each read in its own transaction: a large system or a slow link
    // must not depend on one long transaction.
    let next = 0;
    const worker = async () => {
      while (next < names.length) {
        const name = names[next++]!;
        try {
          // Read in chunks, each in its own short transaction, and try a chunk again if the
          // connection drops: one huge answer is exactly what a slow link fails to deliver.
          const lines: string[] = [];
          for (let offset = 0; ; offset += CHUNK_ROWS) {
            let rows: { j: string }[] = [];
            for (let attempt = 1; ; attempt++) {
              try {
                rows = await withDb(
                  this.db,
                  { platform: true },
                  (tx) =>
                    tx.$queryRawUnsafe<{ j: string }[]>(
                      `SELECT row_to_json(t)::text AS j FROM ${quote(name)} t ORDER BY ctid LIMIT ${CHUNK_ROWS} OFFSET ${offset}`,
                    ),
                  { timeoutMs: 300_000 },
                );
                break;
              } catch (err) {
                if (attempt >= 3) throw err;
              }
            }
            for (const r of rows) lines.push(`{"t":${JSON.stringify(name)},"r":${r.j}}`);
            if (rows.length < CHUNK_ROWS) break;
          }
          parts.set(name, lines);
        } catch {
          // A table this role may not read is left out and said so, never silently.
          summary.skipped.push(name);
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    const lines: string[] = [];
    for (const name of names) {
      const rows = parts.get(name);
      if (!rows) continue;
      lines.push(...rows);
      summary.tables.push({ name, rows: rows.length });
    }
    const header = JSON.stringify({ format: FORMAT, version: VERSION, ...summary });
    return {
      file: gzipSync(Buffer.from([header, ...lines].join(String.fromCharCode(10)), 'utf8')),
      summary,
    };
  }

  /**
   * Restores the missing rows from a backup file. `check` does everything a restore would and then
   * undoes it, so the numbers are exact and nothing changes.
   */
  async restore(file: Buffer, mode: 'check' | 'apply'): Promise<RestoreReport> {
    let text: string;
    try {
      text = gunzipSync(file, { maxOutputLength: 400 * 1024 * 1024 }).toString('utf8');
    } catch {
      throw AppError.validation('This is not a backup file');
    }
    const all = text.split('\n').filter(Boolean);
    let header: { format?: string; version?: number; createdAt?: string };
    try {
      header = JSON.parse(all[0] ?? '') as typeof header;
    } catch {
      throw AppError.validation('This is not a backup file');
    }
    if (header.format !== FORMAT || header.version !== VERSION) {
      throw AppError.validation('This backup file is from an incompatible version');
    }
    const byTable = new Map<string, string[]>();
    for (const line of all.slice(1)) {
      let parsed: { t?: string; r?: unknown };
      try {
        parsed = JSON.parse(line) as typeof parsed;
      } catch {
        throw AppError.validation('The backup file is damaged');
      }
      if (typeof parsed.t !== 'string' || typeof parsed.r !== 'object' || parsed.r === null) {
        throw AppError.validation('The backup file is damaged');
      }
      const list = byTable.get(parsed.t) ?? [];
      list.push(JSON.stringify(parsed.r));
      byTable.set(parsed.t, list);
    }

    const report: RestoreReport = {
      mode,
      createdAt: header.createdAt ?? '',
      tables: [],
      restored: 0,
      notWritable: [],
    };
    const UNDO = new Error('undo');
    let current = '';
    try {
      await withDb(
        this.db,
        { platform: true },
        async (tx) => {
          const known = await this.orderedTables(tx);
          const writable = new Set(
            (
              await tx.$queryRaw<{ name: string }[]>`
                SELECT table_name AS name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                  AND has_table_privilege(format('%I', table_name), 'INSERT')`
            ).map((t) => t.name),
          );
          for (const name of known) {
            const rows = byTable.get(name);
            if (!rows) continue;
            if (!writable.has(name)) {
              report.notWritable.push(name);
              continue;
            }
            current = name;
            let restored = 0;
            for (const slice of slices(rows)) {
              // `name` comes from the database's own table list, never from the file.
              restored += await tx.$executeRawUnsafe(
                `INSERT INTO ${quote(name)} SELECT * FROM json_populate_recordset(NULL::${quote(name)}, $1::json) ON CONFLICT DO NOTHING`,
                `[${slice.join(',')}]`,
              );
            }
            report.tables.push({ name, inFile: rows.length, restored });
            report.restored += restored;
          }
          for (const name of byTable.keys()) {
            if (!known.includes(name)) {
              throw AppError.validation(
                `The backup has a table this system does not know: ${name}`,
              );
            }
          }
          if (mode === 'check') throw UNDO;
        },
        { timeoutMs: 600_000 },
      );
    } catch (err) {
      if (err !== UNDO) {
        if (err instanceof AppError) throw err;
        // Say which table and what the database objected to, so the cause can be fixed.
        const meta = (
          err as {
            meta?: { message?: string; driverAdapterError?: { cause?: { message?: string } } };
          }
        ).meta;
        const why = String(
          meta?.driverAdapterError?.cause?.message ?? meta?.message ?? (err as Error).message ?? '',
        )
          .split(String.fromCharCode(10))
          .find((l) => l.trim())
          ?.slice(0, 300);
        throw AppError.conflict(
          `The backup could not be restored${current ? ` (table ${current})` : ''}: ${why || 'the database refused it'}. Nothing was changed.`,
        );
      }
    }
    return report;
  }

  // ---- Jobs: a backup or restore can outlast a web request, so it runs in the background and
  // the page asks how it is going. Kept in memory for half an hour.
  private readonly jobs = new Map<string, Job>();

  private track<T>(kind: Job['kind'], work: () => Promise<T>, done: (job: Job, r: T) => void) {
    for (const [id, j] of this.jobs)
      if (Date.now() - j.startedAt > 30 * 60_000) this.jobs.delete(id);
    while (this.jobs.size >= 5) this.jobs.delete(this.jobs.keys().next().value as string);
    const job: Job = { id: randomUUID(), kind, status: 'running', startedAt: Date.now() };
    this.jobs.set(job.id, job);
    void work().then(
      (r) => {
        done(job, r);
        job.status = 'done';
      },
      (err: unknown) => {
        job.status = 'failed';
        job.error =
          err instanceof AppError ? err.message : 'The backup job failed. Nothing was changed.';
      },
    );
    return job.id;
  }

  startBackup(): string {
    return this.track(
      'backup',
      () => this.create(),
      (job, r) => {
        job.file = r.file;
        job.summary = r.summary;
      },
    );
  }

  startRestore(file: Buffer, mode: 'check' | 'apply'): string {
    return this.track(
      'restore',
      () => this.restore(file, mode),
      (job, r) => {
        job.report = r;
      },
    );
  }

  job(id: string): Job | undefined {
    return this.jobs.get(id);
  }
}

export interface Job {
  id: string;
  kind: 'backup' | 'restore';
  status: 'running' | 'done' | 'failed';
  startedAt: number;
  error?: string;
  file?: Buffer;
  summary?: BackupSummary;
  report?: RestoreReport;
}
