import type { Request, Router as ExpressRouter } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import type { RateLimitStoreFactory } from '../../platform/redis.js';
import { Router } from '../../platform/router.js';
import { requireAuth } from '../authentication/session.middleware.js';
import { parseDate } from '../catalog/time.js';
import { platformGuard, uuidParam } from '../tenants/tenant.guards.js';
import { pageQuery } from '../tenants/tenant.routes.js';
import type { InquiryService } from './inquiry.service.js';

const trim = z.string().trim();
const validDate = (v: string) => {
  try {
    parseDate(v);
    return true;
  } catch {
    return false;
  }
};

const inquiryBody = z
  .object({
    kind: z.enum(['CONTACT', 'DEMO']),
    name: trim.min(2).max(120),
    email: trim.toLowerCase().pipe(z.email().max(254)),
    phone: trim.regex(/^\+?[0-9 ()-]{6,20}$/, 'Enter a valid phone number').optional(),
    company: trim.min(2).max(120).optional(),
    message: trim.min(5).max(4000).optional(),
    topic: trim.max(80).optional(),
    fleetSize: z.enum(['1-5', '6-20', '21-50', '51+']).optional(),
    role: trim.max(80).optional(),
    preferredDate: z.string().refine(validDate, 'Use a valid YYYY-MM-DD date').optional(),
    preferredTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a valid HH:MM time')
      .optional(),
    /** A trap for robots: people never see this field, so a filled one is discarded. */
    website: z.string().max(200).optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.kind === 'CONTACT' && (b.message?.length ?? 0) < 10)
      ctx.addIssue({ code: 'custom', path: ['message'], message: 'Please write a short message' });
    if (b.kind === 'DEMO' && !b.company)
      ctx.addIssue({ code: 'custom', path: ['company'], message: 'Tell us your company name' });
  });
const listQuery = z.object({ status: z.enum(['NEW', 'HANDLED']).optional() });
const handledBody = z.object({ handled: z.boolean() }).strict();

/** The optional answers of the demo form, without the empty ones. */
function details(b: z.infer<typeof inquiryBody>): Record<string, string> {
  const out: Record<string, string> = {};
  if (b.topic) out.topic = b.topic;
  if (b.fleetSize) out.fleetSize = b.fleetSize;
  if (b.role) out.role = b.role;
  if (b.preferredDate) out.preferredDate = b.preferredDate;
  if (b.preferredTime) out.preferredTime = b.preferredTime;
  return out;
}

export interface InquiryRouterDeps {
  db: Db;
  inquiries: InquiryService;
  env: Pick<Env, 'RATE_LIMIT_SCALE'>;
  rateLimitStores?: RateLimitStoreFactory | undefined;
}

/** The website's contact and demo forms (public), and the platform administrators' inbox for them. */
export function inquiryRouter({
  db,
  inquiries,
  env,
  rateLimitStores,
}: InquiryRouterDeps): ExpressRouter {
  const limit = (name: string, windowMs: number, max: number) =>
    rateLimit({
      windowMs,
      limit: max * env.RATE_LIMIT_SCALE,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      ...(rateLimitStores ? { store: rateLimitStores(`inquiry:${name}`) } : {}),
      passOnStoreError: true,
      handler: (_req, _res, next) =>
        next(new AppError(429, 'RATE_LIMITED', 'Too many messages. Please try again later.')),
    });
  const guard = platformGuard(db, ['SUPER_ADMIN', 'OPERATIONS', 'SUPPORT']);
  const actor = (req: Request) => {
    if (!req.platform) throw AppError.unauthenticated();
    return req.platform.userId;
  };

  const r = Router();
  r.post(
    '/public/inquiries',
    limit('minute', 60_000, 4),
    limit('hour', 3_600_000, 20),
    async (req, res) => {
      const b = inquiryBody.parse(req.body);
      // A robot filled the hidden field: answer as if it worked, and keep nothing.
      if (b.website) {
        res.status(201).json({ ok: true });
        return;
      }
      await inquiries.create({
        kind: b.kind,
        name: b.name,
        email: b.email,
        phone: b.phone,
        company: b.company,
        message: b.message,
        details: details(b),
      });
      res.status(201).json({ ok: true });
    },
  );

  r.get('/platform/inquiries', requireAuth, guard, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      inquiries: await inquiries.list(listQuery.parse(req.query).status, pageQuery(req)),
    });
  });
  r.post('/platform/inquiries/:id/handled', requireAuth, guard, async (req, res) => {
    await inquiries.setHandled(
      actor(req),
      uuidParam(req, 'id'),
      handledBody.parse(req.body).handled,
      req.id,
    );
    res.status(204).end();
  });
  return r;
}

export const requestSchemas = { inquiryBody, handledBody };
