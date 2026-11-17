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
import { formFieldsSchema } from './form-fields.js';
import { SIMPLE_TRANSITIONS, type RecruitmentService } from './recruitment.service.js';

const trim = z.string().trim();
const today = () => new Date().toISOString().slice(0, 10);
const validDate = (v: string) => {
  try {
    parseDate(v);
    return true;
  } catch {
    return false;
  }
};
const dateStr = z.string().refine(validDate, 'Use a valid YYYY-MM-DD date');
const futureDate = dateStr.refine((v) => v >= today(), 'The closing date cannot be in the past');
const roleKey = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Choose a role');

const jobBase = z.object({
  title: trim.min(3).max(120),
  roleKey,
  description: trim.min(20).max(8000),
  location: trim.min(2).max(120).optional(),
  closesOn: futureDate.optional(),
  formFields: formFieldsSchema.optional(),
});
const jobCreate = jobBase.strict();
const jobPatch = jobBase.partial().strict();
const statusBody = z
  .object({
    status: z.enum(SIMPLE_TRANSITIONS),
    note: trim.min(1).max(2000).optional(),
  })
  .strict();
const noteBody = z.object({ note: trim.min(1).max(2000) }).strict();
const interviewBody = z
  .object({
    date: dateStr,
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a valid HH:MM time'),
    mode: z.enum(['IN_PERSON', 'PHONE', 'VIDEO']),
    location: trim.min(2).max(300),
    contactPerson: trim.min(2).max(120).optional(),
    contactPhone: trim.min(5).max(30).optional(),
    instructions: trim.min(1).max(2000).optional(),
  })
  .strict();
const hireBody = z
  .object({
    staffNumber: trim.min(1).max(30),
    jobTitle: trim.min(2).max(120),
    employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY']),
    startDate: dateStr,
    reportingTo: trim.min(2).max(120).optional(),
    workLocation: trim.min(2).max(200).optional(),
    notes: trim.min(1).max(2000).optional(),
  })
  .strict();
const applyBody = z
  .object({
    tenantId: z.uuid(),
    jobId: z.uuid(),
    fullName: trim.min(2).max(120),
    phoneNumber: trim.regex(/^\+?[0-9 ()-]{6,20}$/, 'Enter a valid phone number'),
    yearsExperience: z.number().int().min(0).max(70),
    experience: trim.min(10).max(4000),
    licenceNumber: trim.min(3).max(40).optional(),
    /** Answers to the posting's own questions, by field key (files are uploaded afterwards). */
    answers: z
      .record(z.string().max(40), z.union([z.string().max(4000), z.number(), z.boolean()]))
      .optional(),
  })
  .strict();
const listQuery = z.object({
  status: z.enum(['DRAFT', 'OPEN', 'CLOSED']).optional(),
});
const appQuery = z.object({
  jobId: z.uuid().optional(),
  status: z
    .enum(['SUBMITTED', 'SHORTLISTED', 'INTERVIEW', 'HIRED', 'REJECTED', 'WITHDRAWN'])
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

  // The roles a posting can recruit for: everything registered in the company except the owner.
  t.get('/jobs/roles', hr, async (req, res) => {
    res.json({ roles: await recruitment.listRoles(scope(req)) });
  });
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
    res.json(
      await recruitment.transition(scope(req), uuidParam(req, 'id'), b.status, b.note, req.id),
    );
  });
  t.post('/applications/:id/interview', hr, async (req, res) => {
    res.json(
      await recruitment.invite(
        scope(req),
        uuidParam(req, 'id'),
        interviewBody.parse(req.body),
        req.id,
      ),
    );
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

export const requestSchemas = {
  jobCreate,
  jobPatch,
  statusBody,
  noteBody,
  interviewBody,
  hireBody,
  applyBody,
};
