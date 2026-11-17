import type { Permission } from '@nts/shared';
import type { Request, Router as ExpressRouter } from 'express';
import { z } from 'zod';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { Router } from '../../platform/router.js';
import { requireAuth } from '../authentication/session.middleware.js';
import { createDenialAuditor } from '../tenants/tenant.audit.js';
import {
  requireTenantPermission,
  tenantScope,
  uuidParam,
  type TenantScope,
} from '../tenants/tenant.guards.js';
import type { SalaryService } from './salary.service.js';

const trim = z.string().trim();
const minor = z.number().int().min(0).max(2_000_000_000);

const structureBody = z
  .object({
    name: trim.min(2).max(80),
    baseMinor: minor,
    description: trim.max(300).optional(),
    allowances: z
      .array(z.object({ name: trim.min(2).max(80), amountMinor: minor }).strict())
      .max(30)
      .default([]),
  })
  .strict();
const deductionBody = z
  .object({
    name: trim.min(2).max(80),
    kind: z.enum(['FIXED', 'PERCENT']),
    value: z.number().int().min(0).max(2_000_000_000),
    description: trim.max(300).optional(),
  })
  .strict()
  .refine((d) => d.kind === 'FIXED' || d.value <= 10_000, {
    message: 'A percentage is at most 100%',
    path: ['value'],
  });
const assignBody = z
  .object({
    structureId: z.uuid().nullable(),
    deductionIds: z.array(z.uuid()).max(50).default([]),
  })
  .strict();

export interface SalaryRouterDeps {
  db: Db;
  salary: SalaryService;
}

/** Salary structures, deductions and assignments under /tenants/:tenantId (finance), plus "mine". */
export function salaryRouter({ db, salary }: SalaryRouterDeps): ExpressRouter {
  const t = Router({ mergeParams: true });
  t.use(requireAuth, tenantScope(db));
  const audit = createDenialAuditor(db);
  const perm = (p: Permission) => requireTenantPermission(p, audit.permissionDenied);
  const scope = (req: Request): TenantScope => {
    if (!req.tenant) throw AppError.unauthenticated();
    return req.tenant;
  };
  const manage = perm('salary.manage');

  // Any staff member: only their own breakdown, never anyone else's.
  t.get('/salary/mine', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await salary.mine(scope(req)));
  });

  t.get('/salary/structures', manage, async (req, res) => {
    res.json(await salary.listStructures(scope(req)));
  });
  t.post('/salary/structures', manage, async (req, res) => {
    res
      .status(201)
      .json(await salary.createStructure(scope(req), structureBody.parse(req.body), req.id));
  });
  t.put('/salary/structures/:id', manage, async (req, res) => {
    res.json(
      await salary.updateStructure(
        scope(req),
        uuidParam(req, 'id'),
        structureBody.parse(req.body),
        req.id,
      ),
    );
  });
  t.delete('/salary/structures/:id', manage, async (req, res) => {
    await salary.deleteStructure(scope(req), uuidParam(req, 'id'), req.id);
    res.status(204).end();
  });

  t.get('/salary/deductions', manage, async (req, res) => {
    res.json(await salary.listDeductions(scope(req)));
  });
  t.post('/salary/deductions', manage, async (req, res) => {
    res
      .status(201)
      .json(await salary.createDeduction(scope(req), deductionBody.parse(req.body), req.id));
  });
  t.put('/salary/deductions/:id', manage, async (req, res) => {
    await salary.updateDeduction(
      scope(req),
      uuidParam(req, 'id'),
      deductionBody.parse(req.body),
      req.id,
    );
    res.status(204).end();
  });
  t.delete('/salary/deductions/:id', manage, async (req, res) => {
    await salary.deleteDeduction(scope(req), uuidParam(req, 'id'), req.id);
    res.status(204).end();
  });

  t.get('/salary/staff', manage, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await salary.listStaff(scope(req)));
  });
  t.get('/salary/staff/:staffId', manage, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await salary.staffBreakdown(scope(req), uuidParam(req, 'staffId')));
  });
  t.put('/salary/staff/:staffId', manage, async (req, res) => {
    await salary.assign(scope(req), uuidParam(req, 'staffId'), assignBody.parse(req.body), req.id);
    res.status(204).end();
  });

  const r = Router();
  r.use('/tenants/:tenantId', t);
  return r;
}

export const requestSchemas = { structureBody, deductionBody, assignBody };
