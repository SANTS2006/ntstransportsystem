import express, { type Request } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { Router } from '../../platform/router.js';
import { requireAuth } from '../authentication/session.middleware.js';
import { createDenialAuditor } from '../tenants/tenant.audit.js';
import {
  platformGuard,
  requireTenantPermission,
  tenantScope,
  uuidParam,
  type TenantScope,
} from '../tenants/tenant.guards.js';
import { IMAGE_TYPES, MAX_LOGO_BYTES, SLUG_RE, type BrandingService } from './branding.service.js';

const colour = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, 'Use a colour like #0075df');
const colorsSchema = z
  .object({ primaryColor: colour.nullable(), accentColor: colour.nullable() })
  .strict();

const rawImage = express.raw({ type: [...IMAGE_TYPES], limit: MAX_LOGO_BYTES + 1000 });

export function imageBody(req: Request): Buffer {
  if (!Buffer.isBuffer(req.body)) throw AppError.validation('Send a PNG, JPEG or WebP picture');
  return req.body;
}

export function brandingRouter(db: Db, branding: BrandingService): ExpressRouter {
  const r = Router();
  const scope = (req: Request): TenantScope => {
    if (!req.tenant) throw AppError.unauthenticated();
    return req.tenant;
  };

  // --- Public: what a company's sign-in and sign-up pages look like -----------------------------
  r.get('/public/companies/:slug', async (req, res) => {
    const slug = z.string().regex(SLUG_RE).max(40).safeParse(req.params.slug);
    const found = slug.success ? await branding.publicBySlug(slug.data) : null;
    if (!found) throw AppError.notFound('Company not found');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(found);
  });
  r.get('/public/companies/:slug/logo', async (req, res) => {
    const slug = z.string().regex(SLUG_RE).max(40).safeParse(req.params.slug);
    const logo = slug.success ? await branding.logoBySlug(slug.data) : null;
    if (!logo) throw AppError.notFound('Logo not found');
    res.setHeader('Content-Type', logo.type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(logo.data);
  });

  // --- A company's own branding --------------------------------------------------------------
  const t = Router({ mergeParams: true });
  t.use(requireAuth, tenantScope(db));
  const audit = createDenialAuditor(db);
  const perm = requireTenantPermission('tenant.profile.update', audit.permissionDenied);
  t.get('/', async (req, res) => {
    res.json(await branding.get(scope(req)));
  });
  t.patch('/', perm, async (req, res) => {
    res.json(await branding.setColors(scope(req), colorsSchema.parse(req.body), req.id));
  });
  t.put('/logo', perm, rawImage, async (req, res) => {
    await branding.setLogo(scope(req), imageBody(req), req.id);
    res.status(204).end();
  });
  t.delete('/logo', perm, async (req, res) => {
    await branding.clearLogo(scope(req), req.id);
    res.status(204).end();
  });
  r.use('/tenants/:tenantId/branding', t);

  // --- Platform staff set the logo of a company they have just registered ----------------------
  const writeGuard = platformGuard(db, ['SUPER_ADMIN', 'OPERATIONS']);
  r.put('/platform/tenants/:id/logo', requireAuth, writeGuard, rawImage, async (req, res) => {
    if (!req.platform) throw AppError.unauthenticated();
    await branding.setLogoForTenant(
      req.platform.userId,
      uuidParam(req, 'id'),
      imageBody(req),
      req.id,
    );
    res.status(204).end();
  });
  return r;
}

/** Exposed so the OpenAPI document is generated from the exact schemas used for validation. */
export const requestSchemas = { colorsSchema };
