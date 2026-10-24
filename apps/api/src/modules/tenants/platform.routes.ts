import type { Request } from 'express';
import type { Router as ExpressRouter } from 'express';
import { Router } from '../../platform/router.js';
import { z } from 'zod';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { requireAuth } from '../authentication/session.middleware.js';
import { platformGuard, uuidParam } from './tenant.guards.js';
import { pageQuery } from './tenant.routes.js';
import { parseDate } from '../catalog/time.js';
import type { PlatformReportService } from '../report/platform-report.service.js';
import type { PlatformAuditService } from '../audit/platform-audit.service.js';
import type { MembershipService } from './membership.service.js';
import { TENANT_TRANSITIONS, type TenantAction, type TenantService } from './tenant.service.js';

const statusQuery = z
  .enum(['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'DEACTIVATED'])
  .optional();
const dateStr = z.string().refine((v) => {
  try {
    parseDate(v);
    return true;
  } catch {
    return false;
  }
}, 'Use a valid YYYY-MM-DD date');
const overviewQuery = z.object({ from: dateStr.optional(), to: dateStr.optional() });
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
const optionalReason = z.object({ reason: z.string().trim().max(300).optional() }).strict();

/** Actions that must carry a recorded justification. */
const REASON_REQUIRED: readonly TenantAction[] = ['reject', 'suspend', 'deactivate'];

const currency = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code');
const timezone = z
  .string()
  .trim()
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown timezone');
const colour = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, 'Use a colour like #0075df');
const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: z.string().trim().toLowerCase().min(3).max(40),
    timezone: timezone.default('UTC'),
    defaultCurrency: currency.default('SLE'),
    adminName: z.string().trim().min(2).max(100),
    adminEmail: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    primaryColor: colour.optional(),
    accentColor: colour.optional(),
  })
  .strict();
const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    slug: z.string().trim().toLowerCase().min(3).max(40).optional(),
    timezone: timezone.optional(),
    defaultCurrency: currency.optional(),
    primaryColor: colour.nullable().optional(),
    accentColor: colour.nullable().optional(),
  })
  .strict();
const auditQuery = z.object({
  action: z.string().trim().max(80).optional(),
  outcome: z.enum(['SUCCESS', 'FAILURE', 'DENIED']).optional(),
  tenantId: z.uuid().optional(),
  actorUserId: z.uuid().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
});

export function platformRouter(
  db: Db,
  tenants: TenantService,
  reports?: PlatformReportService,
  members?: MembershipService,
  audit?: PlatformAuditService,
): ExpressRouter {
  const r = Router();
  // Lifecycle changes need OPERATIONS or SUPER_ADMIN; reads are open to support staff too.
  const readGuard = platformGuard(db, ['SUPER_ADMIN', 'OPERATIONS', 'SUPPORT']);
  const writeGuard = platformGuard(db, ['SUPER_ADMIN', 'OPERATIONS']);
  const actor = (req: Request) => {
    if (!req.platform) throw AppError.unauthenticated();
    return req.platform.userId;
  };

  r.get('/tenants', requireAuth, readGuard, async (req, res) => {
    const status = statusQuery.parse(req.query.status);
    const q = z.string().trim().max(80).optional().parse(req.query.q);
    res.json({ tenants: await tenants.listForPlatform(status, pageQuery(req), q || undefined) });
  });

  r.patch('/tenants/:id', requireAuth, writeGuard, async (req, res) => {
    await tenants.updateByPlatform(
      actor(req),
      uuidParam(req, 'id'),
      updateSchema.parse(req.body),
      req.id,
    );
    res.status(204).end();
  });

  if (members) {
    r.post('/tenants', requireAuth, writeGuard, async (req, res) => {
      const body = registerSchema.parse(req.body);
      const created = await tenants.register(actor(req), body, req.id);
      const admin = await members.provisionAdmin(
        actor(req),
        {
          tenantId: created.id,
          companyName: created.name,
          slug: created.slug,
          name: body.adminName,
          email: body.adminEmail,
          ownerRoleId: created.ownerRoleId,
        },
        req.id,
      );
      res.status(201).json({
        id: created.id,
        name: created.name,
        slug: created.slug,
        status: created.status,
        adminEmail: admin.email,
        adminAccountCreated: admin.newAccount,
      });
    });
  }

  if (audit) {
    // Everything that happened on the platform, across all companies. Security-audit staff read
    // this too, which is why its guard differs from the company lists above.
    const auditGuard = platformGuard(db, ['SUPER_ADMIN', 'SECURITY_AUDIT']);
    r.get('/audit', requireAuth, auditGuard, async (req, res) => {
      const q = auditQuery.parse(req.query);
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(await audit.list(q, pageQuery(req)));
    });
  }

  if (reports) {
    r.get('/overview', requireAuth, readGuard, async (req, res) => {
      const q = overviewQuery.parse(req.query);
      const to = q.to ?? isoDay(new Date());
      const from = q.from ?? isoDay(new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000));
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(await reports.overview({ from, to }));
    });
  }

  for (const action of Object.keys(TENANT_TRANSITIONS) as TenantAction[]) {
    r.post(`/tenants/:id/${action}`, requireAuth, writeGuard, async (req, res) => {
      const body = REASON_REQUIRED.includes(action)
        ? reasonSchema.parse(req.body)
        : optionalReason.parse(req.body ?? {});
      res.json(
        await tenants.transition(actor(req), uuidParam(req, 'id'), action, body.reason, req.id),
      );
    });
  }
  return r;
}

/** Exposed so the OpenAPI document is generated from the exact schemas used for validation. */
export const requestSchemas = { reasonSchema, optionalReason, registerSchema, updateSchema };
