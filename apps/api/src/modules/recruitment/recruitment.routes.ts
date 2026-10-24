import type { Permission } from '@nts/shared';
import type { Request, Response, Router as ExpressRouter } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import type { RateLimitStoreFactory } from '../../platform/redis.js';
import { Router } from '../../platform/router.js';
import { requireAuth } from '../authentication/session.middleware.js';
import { parseDate } from '../catalog/time.js';
import { createDenialAuditor } from '../tenants/tenant.audit.js';
import {
  requireTenantPermission,
  tenantScope,
  uuidParam,
  type TenantScope,
} from '../tenants/tenant.guards.js';
import { pageQuery } from '../tenants/tenant.routes.js';
import type { RecruitmentService } from './recruitment.service.js';

const trim = z.string().trim();
const today = () => new Date().toISOString().slice(0, 10);
const futureDate = z
  .string()
  .refine((v) => {
    try {
      parseDate(v);
      return true;
    } catch {
      return false;
    }
  }, 'Use a valid YYYY-MM-DD date')
  .refine((v) => v >= today(), 'The closing date cannot be in the past');
const jobRole = z.enum(['DRIVER', 'CONDUCTOR', 'DISPATCHER', 'MECHANIC', 'OTHER']);

const jobBase = z.object({
  title: trim.min(3).max(120),
  jobRole,
  description: trim.min(20).max(8000),
  location: trim.min(2).max(120).optional(),
  closesOn: futureDate.optional(),
});
const jobCreate = jobBase.strict();
const jobPatch = jobBase.partial().strict();
const statusBody = z
  .object({
    status: z.enum(['SHORTLISTED', 'INTERVIEW', 'OFFERED', 'REJECTED']),
    note: trim.min(1).max(2000).optional(),
  })
  .strict();
const noteBody = z.object({ note: trim.min(1).max(2000) }).strict();
const hireBody = z
  .object({
    employeeNumber: trim.min(1).max(40),
    hiredOn: z
      .string()
      .refine((v) => {
        try {
          parseDate(v);
          return true;
        } catch {
          return false;
        }
      }, 'Use a valid YYYY-MM-DD date')
      .optional(),
  })
  .strict();
const applyBody = z
  .object({
    tenantId: z.uuid(),
    jobId: z.uuid(),
    fullName: trim.min(2).max(120),
    phone: trim.regex(/^\+?[0-9 ()-]{6,20}$/, 'Enter a valid phone number'),
    experience: trim.min(10).max(4000),
    licenceNumber: trim.min(3).max(40).optional(),
  })
  .strict();
const listQuery = z.object({
  status: z.enum(['DRAFT', 'OPEN', 'CLOSED']).optional(),
});
const appQuery = z.object({
  jobId: z.uuid().optional(),
  status: z
    .enum(['SUBMITTED', 'SHORTLISTED', 'INTERVIEW', 'OFFERED', 'HIRED', 'REJECTED', 'WITHDRAWN'])
    .optional(),
});

export interface RecruitmentRouterDeps {
  db: Db;
  recruitment: RecruitmentService;
  env: Pick<Env, 'RATE_LIMIT_SCALE'>;
  rateLimitStores?: RateLimitStoreFactory | undefined;
}

export function recruitmentRouter({
  db,
  recruitment,
  env,
  rateLimitStores,
}: RecruitmentRouterDeps): ExpressRouter {
  const limit = (name: string, max: number) =>
    rateLimit({
      windowMs: 60_000,
      limit: max * env.RATE_LIMIT_SCALE,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      ...(rateLimitStores ? { store: rateLimitStores(`recruit:${name}`) } : {}),
      passOnStoreError: true,
      handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests')),
    });
  const userId = (req: Request) => {
    if (!req.auth) throw AppError.unauthenticated();
    return req.auth.userId;
  };

  // ---- HR, under /tenants/:tenantId ------------------------------------------------------------
  const t = Router({ mergeParams: true });
  t.use(requireAuth, tenantScope(db));
  const audit = createDenialAuditor(db);
  const perm = (p: Permission) => requireTenantPermission(p, audit.permissionDenied);
  const scope = (req: Request): TenantScope => {
    if (!req.tenant) throw AppError.unauthenticated();
    return req.tenant;
  };
  const noStore = (res: Response) => res.setHeader('Cache-Control', 'private, no-store');
  const hr = perm('recruitment.manage');

  t.get('/jobs', hr, async (req, res) => {
    res.json({
      jobs: await recruitment.listJobs(
        scope(req),
        pageQuery(req),
        listQuery.parse(req.query).status,
      ),
    });
  });
  t.post('/jobs', hr, async (req, res) => {
    res
      .status(201)
      .json(await recruitment.createJob(scope(req), jobCreate.parse(req.body), req.id));
  });
  t.get('/jobs/:id', hr, async (req, res) => {
    res.json(await recruitment.getJob(scope(req), uuidParam(req, 'id')));
  });
  t.patch('/jobs/:id', hr, async (req, res) => {
    res.json(
      await recruitment.updateJob(
        scope(req),
        uuidParam(req, 'id'),
        jobPatch.parse(req.body),
        req.id,
      ),
    );
  });
  t.post('/jobs/:id/open', hr, async (req, res) => {
    res.json(await recruitment.setJobStatus(scope(req), uuidParam(req, 'id'), 'OPEN', req.id));
  });
  t.post('/jobs/:id/close', hr, async (req, res) => {
    res.json(await recruitment.setJobStatus(scope(req), uuidParam(req, 'id'), 'CLOSED', req.id));
  });

  // Applicant details are personal data: never cached.
  t.get('/applications', hr, async (req, res) => {
    noStore(res);
    res.json({
      applications: await recruitment.listApplications(
        scope(req),
        pageQuery(req),
        appQuery.parse(req.query),
      ),
    });
  });
  t.get('/applications/:id', hr, async (req, res) => {
    noStore(res);
    res.json(await recruitment.getApplication(scope(req), uuidParam(req, 'id')));
  });
  t.post('/applications/:id/status', hr, async (req, res) => {
    const b = statusBody.parse(req.body);
    await recruitment.transition(scope(req), uuidParam(req, 'id'), b.status, b.note, req.id);
    res.status(204).end();
  });
  t.post('/applications/:id/notes', hr, async (req, res) => {
    await recruitment.addNote(
      scope(req),
      uuidParam(req, 'id'),
      noteBody.parse(req.body).note,
      req.id,
    );
    res.status(201).end();
  });
  t.post('/applications/:id/hire', hr, async (req, res) => {
    res
      .status(201)
      .json(
        await recruitment.hire(scope(req), uuidParam(req, 'id'), hireBody.parse(req.body), req.id),
      );
  });

  // ---- Public and applicants -------------------------------------------------------------------
  const r = Router();
  r.use('/tenants/:tenantId', t);
  r.get('/public/jobs', limit('list', 60), async (req, res) => {
    const q = z
      .object({ q: trim.max(60).optional(), tenantId: z.uuid().optional() })
      .parse(req.query);
    res.json({ jobs: await recruitment.listOpen(q.q, q.tenantId) });
  });
  r.get('/public/jobs/:tenantId/:id', limit('detail', 60), async (req, res) => {
    const ids = z.object({ tenantId: z.uuid(), id: z.uuid() }).safeParse(req.params);
    if (!ids.success) throw AppError.notFound();
    res.json(await recruitment.getOpen(ids.data.tenantId, ids.data.id));
  });
  r.post('/applicant/applications', requireAuth, limit('apply', 10), async (req, res) => {
    res.status(201).json(await recruitment.apply(userId(req), applyBody.parse(req.body), req.id));
  });
  r.get('/applicant/applications', requireAuth, async (req, res) => {
    noStore(res);
    res.json({ applications: await recruitment.listOwn(userId(req)) });
  });
  r.post(
    '/applicant/applications/:id/withdraw',
    requireAuth,
    limit('withdraw', 10),
    async (req, res) => {
      await recruitment.withdraw(userId(req), z.uuid().parse(req.params.id), req.id);
      res.status(204).end();
    },
  );
  return r;
}

export const requestSchemas = { jobCreate, jobPatch, statusBody, noteBody, hireBody, applyBody };
