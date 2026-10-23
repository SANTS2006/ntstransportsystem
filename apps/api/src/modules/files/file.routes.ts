import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Permission } from '@nts/shared';
import type { Env } from '../../config/env.js';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { MAX_UPLOAD_BYTES } from '../../platform/file-types.js';
import type { RateLimitStoreFactory } from '../../platform/redis.js';
import { Router } from '../../platform/router.js';
import type { LocalDiskStorage } from '../../platform/storage.js';
import { requireAuth } from '../authentication/session.middleware.js';
import { createDenialAuditor } from '../tenants/tenant.audit.js';
import {
  requireTenantPermission,
  tenantScope,
  uuidParam,
  type TenantScope,
} from '../tenants/tenant.guards.js';
import type { FileService } from './file.service.js';

/** The body is the file itself. The type is decided from its bytes later, not from this header. */
const rawFile = express.raw({
  type: ['application/pdf', 'image/png', 'image/jpeg'],
  limit: MAX_UPLOAD_BYTES,
});

/** Display name sent by the browser; only a hint for the download name. */
function nameHeader(req: Request): string | undefined {
  const v = req.header('x-file-name');
  if (!v) return undefined;
  try {
    return decodeURIComponent(v).slice(0, 200);
  } catch {
    return undefined;
  }
}
function bodyOf(req: Request): Buffer {
  if (!Buffer.isBuffer(req.body)) {
    throw new AppError(
      415,
      'VALIDATION_ERROR',
      'Send the file as application/pdf, image/png or image/jpeg',
    );
  }
  return req.body;
}

export interface FileRouterDeps {
  db: Db;
  files: FileService;
  env: Pick<Env, 'RATE_LIMIT_SCALE'>;
  rateLimitStores?: RateLimitStoreFactory | undefined;
}

export function fileRouter({ db, files, env, rateLimitStores }: FileRouterDeps): ExpressRouter {
  const limit = (name: string, max: number) =>
    rateLimit({
      windowMs: 60_000,
      limit: max * env.RATE_LIMIT_SCALE,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      ...(rateLimitStores ? { store: rateLimitStores(`files:${name}`) } : {}),
      passOnStoreError: true,
      handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests')),
    });
  const userId = (req: Request) => {
    if (!req.auth) throw AppError.unauthenticated();
    return req.auth.userId;
  };
  const noStore = (res: Response) => res.setHeader('Cache-Control', 'private, no-store');

  // ---- Company staff, under /tenants/:tenantId ---------------------------------------------------
  const t = Router({ mergeParams: true });
  t.use(requireAuth, tenantScope(db));
  const audit = createDenialAuditor(db);
  const perm = (p: Permission) => requireTenantPermission(p, audit.permissionDenied);
  const scope = (req: Request): TenantScope => {
    if (!req.tenant) throw AppError.unauthenticated();
    return req.tenant;
  };
  t.get('/applications/:id/cv', perm('recruitment.manage'), async (req, res) => {
    noStore(res);
    res.json(await files.cvLinkForStaff(scope(req), uuidParam(req, 'id'), req.id));
  });
  t.get('/complaints/:id/attachments', perm('support.manage'), async (req, res) => {
    noStore(res);
    res.json({
      files: await files.listAttachments(
        { kind: 'staff', scope: scope(req) },
        uuidParam(req, 'id'),
      ),
    });
  });
  t.post(
    '/complaints/:id/attachments',
    perm('support.manage'),
    limit('staff-attach', 10),
    rawFile,
    async (req, res) => {
      res
        .status(201)
        .json(
          await files.uploadAttachment(
            { kind: 'staff', scope: scope(req) },
            uuidParam(req, 'id'),
            bodyOf(req),
            nameHeader(req),
            req.id,
          ),
        );
    },
  );
  t.get('/complaints/:id/attachments/:fileId/link', perm('support.manage'), async (req, res) => {
    noStore(res);
    res.json(
      await files.attachmentLink(
        { kind: 'staff', scope: scope(req) },
        uuidParam(req, 'id'),
        uuidParam(req, 'fileId'),
      ),
    );
  });

  // ---- Applicants and passengers ------------------------------------------------------------------
  const r = Router();
  r.use('/tenants/:tenantId', t);
  const id = (req: Request, name = 'id') => z.uuid().parse(req.params[name]);

  r.post(
    '/applicant/applications/:id/cv',
    requireAuth,
    limit('cv', 10),
    rawFile,
    async (req, res) => {
      res
        .status(201)
        .json(await files.uploadCv(userId(req), id(req), bodyOf(req), nameHeader(req), req.id));
    },
  );
  r.get('/applicant/applications/:id/cv', requireAuth, async (req, res) => {
    noStore(res);
    res.json(await files.cvLinkForApplicant(userId(req), id(req)));
  });
  r.get('/passenger/complaints/:id/attachments', requireAuth, async (req, res) => {
    noStore(res);
    res.json({
      files: await files.listAttachments({ kind: 'passenger', userId: userId(req) }, id(req)),
    });
  });
  r.post(
    '/passenger/complaints/:id/attachments',
    requireAuth,
    limit('attach', 10),
    rawFile,
    async (req, res) => {
      res
        .status(201)
        .json(
          await files.uploadAttachment(
            { kind: 'passenger', userId: userId(req) },
            id(req),
            bodyOf(req),
            nameHeader(req),
            req.id,
          ),
        );
    },
  );
  r.get('/passenger/complaints/:id/attachments/:fileId/link', requireAuth, async (req, res) => {
    noStore(res);
    res.json(
      await files.attachmentLink(
        { kind: 'passenger', userId: userId(req) },
        id(req),
        id(req, 'fileId'),
      ),
    );
  });
  return r;
}

/**
 * Development only: serves files written by LocalDiskStorage through a signed URL. The link is
 * verified (key, expiry, name and type are all part of the signature) and the file is always sent
 * as a download with sniffing disabled.
 */
export function devFilesRouter(storage: LocalDiskStorage): ExpressRouter {
  const r = Router();
  r.get('/dev-files', async (req, res) => {
    const q = z
      .object({
        key: z.string().max(400),
        exp: z.coerce.number(),
        fn: z.string().max(200),
        ct: z.string().max(60),
        sig: z.string().max(100),
      })
      .safeParse(req.query);
    if (!q.success || !storage.verify(q.data.key, q.data.exp, q.data.fn, q.data.ct, q.data.sig)) {
      throw AppError.notFound();
    }
    let bytes: Buffer;
    try {
      bytes = await storage.read(q.data.key);
    } catch {
      throw AppError.notFound();
    }
    res.setHeader('Content-Type', q.data.ct);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${q.data.fn.replace(/["\\\r\n]/g, '')}"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(bytes);
  });
  return r;
}

export const requestSchemas = {};
