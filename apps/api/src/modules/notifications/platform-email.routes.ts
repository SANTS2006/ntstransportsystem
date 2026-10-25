import type { Router as ExpressRouter } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { withDb, type Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { Router } from '../../platform/router.js';
import { writeAudit } from '../audit/audit.js';
import { requireAuth } from '../authentication/session.middleware.js';
import { platformGuard } from '../tenants/tenant.guards.js';
import type { Mailer } from './mailer.js';

/** Mail providers cap a message at about 4 MB, and base64 adds a third on top of the file bytes. */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_ATTACHMENTS = 6;
const ALLOWED_EXT = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'mp4',
  'mov',
  'webm',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'csv',
  'zip',
]);

const attachment = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((n) => !/[\\/\0]/.test(n), 'Use a plain file name')
      .refine(
        (n) => ALLOWED_EXT.has(n.split('.').pop()?.toLowerCase() ?? ''),
        'This file type is not allowed',
      ),
    contentBase64: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/, 'The file is not valid'),
  })
  .strict();

export const platformEmailSchema = z
  .object({
    tenantId: z.uuid(),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(150)
      .transform((v) => v.replace(/\s+/g, ' ')),
    message: z.string().trim().min(1).max(10_000),
    attachments: z.array(attachment).max(MAX_ATTACHMENTS).default([]),
  })
  .strict();

const decodedBytes = (b64: string) =>
  Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

export function platformEmailRouter(db: Db, mailer: Mailer): ExpressRouter {
  const r = Router();
  const guard = platformGuard(db, ['SUPER_ADMIN', 'OPERATIONS', 'SUPPORT']);
  // Mail costs money and reputation: a hard ceiling per hour on top of the general limits.
  const sendLimit = rateLimit({
    windowMs: 60 * 60_000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Too many emails sent. Try again later.')),
  });

  // The companies a message can go to, each with the administrator who receives it.
  r.get('/platform/email/companies', requireAuth, guard, async (_req, res) => {
    const rows = await withDb(db, { platform: true }, (tx) =>
      tx.tenant.findMany({
        where: { status: { in: ['ACTIVE', 'SUSPENDED'] } },
        orderBy: { name: 'asc' },
        take: 500,
        select: {
          id: true,
          name: true,
          slug: true,
          memberships: {
            where: { status: 'ACTIVE', role: { key: 'owner' } },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { user: { select: { displayName: true, email: true } } },
          },
        },
      }),
    );
    res.json({
      items: rows.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        adminName: t.memberships[0]?.user.displayName ?? null,
        adminEmail: t.memberships[0]?.user.email ?? null,
      })),
    });
  });

  r.post('/platform/email', requireAuth, guard, sendLimit, async (req, res) => {
    if (!req.platform) throw AppError.unauthenticated();
    const input = platformEmailSchema.parse(req.body);
    const total = input.attachments.reduce((n, a) => n + decodedBytes(a.contentBase64), 0);
    if (total > MAX_ATTACHMENT_BYTES) {
      throw AppError.validation('Attachments are too large: keep them under 4 MB in total');
    }
    const admin = await withDb(db, { platform: true }, async (tx) => {
      const t = await tx.tenant.findUnique({
        where: { id: input.tenantId },
        select: {
          name: true,
          memberships: {
            where: { status: 'ACTIVE', role: { key: 'owner' } },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { user: { select: { email: true } } },
          },
        },
      });
      if (!t) throw AppError.notFound('Company not found');
      return { company: t.name, email: t.memberships[0]?.user.email ?? null };
    });
    if (!admin.email) throw AppError.conflict('This company has no administrator e-mail yet');
    // No tenantId: this is the system speaking, so it goes out with the system's name, logo and colour.
    await mailer.send({
      to: admin.email,
      template: 'platform-message',
      data: { subject: input.subject, message: input.message },
      attachments: input.attachments,
    });
    await withDb(db, { platform: true, userId: req.platform.userId }, (tx) =>
      writeAudit(tx, {
        action: 'platform.email_sent',
        outcome: 'SUCCESS',
        tenantId: input.tenantId,
        actorUserId: req.platform!.userId,
        requestId: req.id,
        summary: { attachments: input.attachments.length },
      }),
    );
    res.status(202).json({ sentTo: admin.email, company: admin.company });
  });
  return r;
}
