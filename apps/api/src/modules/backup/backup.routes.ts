import express from 'express';
import type { Router as ExpressRouter } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { withDb, type Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { Router } from '../../platform/router.js';
import { writeAudit } from '../audit/audit.js';
import { requireAuth } from '../authentication/session.middleware.js';
import { platformGuard } from '../tenants/tenant.guards.js';
import { MAX_RESTORE_BYTES, type BackupService } from './backup.service.js';

const modeSchema = z.enum(['check', 'apply']);

/** Backup and recovery are for the platform's super administrators only. */
export function backupRouter(db: Db, backup: BackupService): ExpressRouter {
  const r = Router();
  const guard = platformGuard(db, ['SUPER_ADMIN']);
  const limit = rateLimit({
    windowMs: 60 * 60_000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Too many backup requests. Try again later.')),
  });
  const audit = (userId: string, action: string, requestId: string | undefined, summary = {}) =>
    withDb(db, { platform: true, userId }, (tx) =>
      writeAudit(tx, { action, outcome: 'SUCCESS', actorUserId: userId, requestId, summary }),
    );

  const jobId = (id: unknown) => {
    const parsed = z.uuid().safeParse(id);
    if (!parsed.success) throw AppError.notFound();
    return parsed.data;
  };
  const status = (j: NonNullable<ReturnType<BackupService['job']>>) => ({
    id: j.id,
    kind: j.kind,
    status: j.status,
    ...(j.error ? { error: j.error } : {}),
    ...(j.summary ? { tables: j.summary.tables.length, skipped: j.summary.skipped } : {}),
    ...(j.report ? { report: j.report } : {}),
  });

  // Start a backup; it runs in the background.
  r.post('/platform/backup', requireAuth, guard, limit, async (req, res) => {
    if (!req.platform) throw AppError.unauthenticated();
    const id = backup.startBackup();
    await audit(req.platform.userId, 'platform.backup_started', req.id);
    res.status(202).json({ id });
  });

  // Start a check or a restore from an uploaded file; it runs in the background.
  r.post(
    '/platform/backup/restore',
    requireAuth,
    guard,
    limit,
    express.raw({ type: () => true, limit: MAX_RESTORE_BYTES }),
    async (req, res) => {
      if (!req.platform) throw AppError.unauthenticated();
      const mode = modeSchema.parse(req.query.mode);
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw AppError.validation('Choose a backup file');
      }
      const id = backup.startRestore(req.body, mode);
      await audit(req.platform.userId, `platform.backup_${mode}_started`, req.id);
      res.status(202).json({ id });
    },
  );

  r.get('/platform/backup/jobs/:id', requireAuth, guard, async (req, res) => {
    const j = backup.job(jobId(req.params.id));
    if (!j) throw AppError.notFound('This job is no longer available. Start it again.');
    res.setHeader('Cache-Control', 'no-store');
    res.json(status(j));
  });

  r.get('/platform/backup/jobs/:id/file', requireAuth, guard, async (req, res) => {
    const j = backup.job(jobId(req.params.id));
    if (!j?.file || !j.summary) throw AppError.notFound('This backup is no longer available.');
    const stamp = j.summary.createdAt.slice(0, 19).replace(/[:T]/g, '-');
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="nts-backup-${stamp}.nts.gz"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(j.file);
  });
  return r;
}

export const requestSchemas = { modeSchema };
