import { withDb, type Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../audit/audit.js';
import type { TenantScope } from '../tenants/tenant.guards.js';

export const MAX_LOGO_BYTES = 600_000;
export const MAX_AVATAR_BYTES = 400_000;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/**
 * What the bytes really are, never what the browser said. SVG is refused on purpose: it can carry
 * script. Returns null for anything that is not a PNG, JPEG or WebP picture.
 */
export function sniffImage(b: Buffer): ImageType | null {
  if (
    b.length > 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length > 12 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function checkImage(b: Buffer, max: number): ImageType {
  if (b.length === 0) throw AppError.validation('Choose a picture to upload');
  if (b.length > max) {
    throw AppError.validation(
      `The picture is too large (the limit is ${Math.round(max / 1000)} KB)`,
    );
  }
  const type = sniffImage(b);
  if (!type) throw AppError.validation('Use a PNG, JPEG or WebP picture');
  return type;
}

/** Words that would collide with the app's own addresses (/login, /app, /platform ...). */
export const RESERVED_SLUGS = new Set([
  'app',
  'api',
  'c',
  'platform',
  'login',
  'register',
  'trips',
  'jobs',
  'pay',
  'verify-email',
  'verify-email-code',
  'verify-phone',
  'forgot-password',
  'reset-password',
  'reset-password-phone',
  'change-password',
  'terms',
  'privacy',
  'dashboard',
  'assets',
  'health',
  'admin',
  'www',
  'static',
]);
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function checkSlug(slug: string): void {
  if (slug.length < 3 || slug.length > 40 || !SLUG_RE.test(slug)) {
    throw AppError.validation(
      'The web address name must be 3 to 40 lower-case letters, digits or hyphens',
    );
  }
  if (RESERVED_SLUGS.has(slug)) throw AppError.conflict('That web address name is reserved');
}

export interface Brand {
  primaryColor: string | null;
  accentColor: string | null;
  hasLogo: boolean;
}

/** Company branding: the two colours and the logo, public for the sign-in pages and editable by the company. */
export class BrandingService {
  constructor(private readonly db: Db) {}

  /** What a sign-in or sign-up page needs to look like the company. Null unless it is live. */
  async publicBySlug(slug: string) {
    return withDb(this.db, { platform: true }, async (tx) => {
      const t = await tx.tenant.findUnique({ where: { slug } });
      if (!t || t.status !== 'ACTIVE') return null;
      const b = await tx.tenantBranding.findUnique({
        where: { tenantId: t.id },
        select: { primaryColor: true, accentColor: true, logoType: true, updatedAt: true },
      });
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        primaryColor: b?.primaryColor ?? null,
        accentColor: b?.accentColor ?? null,
        logoUrl: b?.logoType
          ? `/api/v1/public/companies/${t.slug}/logo?v=${b.updatedAt.getTime()}`
          : null,
      };
    });
  }

  /** Just the name and web address of an open company, from its id (for sign-in links). */
  async summaryById(id: string) {
    return withDb(this.db, { platform: true }, async (tx) => {
      const t = await tx.tenant.findUnique({
        where: { id },
        select: { id: true, name: true, slug: true, status: true },
      });
      return t && t.status === 'ACTIVE' ? { id: t.id, name: t.name, slug: t.slug } : null;
    });
  }

  async logoBySlug(slug: string) {
    return withDb(this.db, { platform: true }, async (tx) => {
      const t = await tx.tenant.findUnique({ where: { slug }, select: { id: true, status: true } });
      if (!t || t.status !== 'ACTIVE') return null;
      const b = await tx.tenantBranding.findUnique({ where: { tenantId: t.id } });
      return b?.logoData && b.logoType ? { data: Buffer.from(b.logoData), type: b.logoType } : null;
    });
  }

  async get(s: TenantScope) {
    return withDb(this.db, { tenantId: s.tenantId, userId: s.userId }, async (tx) => {
      const [t, b] = await Promise.all([
        tx.tenant.findUnique({ where: { id: s.tenantId }, select: { slug: true } }),
        tx.tenantBranding.findUnique({
          where: { tenantId: s.tenantId },
          select: { primaryColor: true, accentColor: true, logoType: true, updatedAt: true },
        }),
      ]);
      return {
        primaryColor: b?.primaryColor ?? null,
        accentColor: b?.accentColor ?? null,
        hasLogo: Boolean(b?.logoType),
        slug: t?.slug ?? null,
        logoUrl:
          b?.logoType && t
            ? `/api/v1/public/companies/${t.slug}/logo?v=${b.updatedAt.getTime()}`
            : null,
      };
    });
  }

  async setColors(
    s: TenantScope,
    colors: { primaryColor: string | null; accentColor: string | null },
    requestId?: string,
  ) {
    await withDb(this.db, { tenantId: s.tenantId, userId: s.userId }, async (tx) => {
      await tx.tenantBranding.upsert({
        where: { tenantId: s.tenantId },
        create: { tenantId: s.tenantId, ...colors },
        update: colors,
      });
      await writeAudit(tx, {
        action: 'tenant.branding_colors',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        requestId,
      });
    });
    return this.get(s);
  }

  async setLogo(s: TenantScope, bytes: Buffer, requestId?: string) {
    const type = checkImage(bytes, MAX_LOGO_BYTES);
    await withDb(this.db, { tenantId: s.tenantId, userId: s.userId }, async (tx) => {
      await tx.tenantBranding.upsert({
        where: { tenantId: s.tenantId },
        create: { tenantId: s.tenantId, logoData: new Uint8Array(bytes), logoType: type },
        update: { logoData: new Uint8Array(bytes), logoType: type },
      });
      await writeAudit(tx, {
        action: 'tenant.branding_logo',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        requestId,
      });
    });
  }

  async clearLogo(s: TenantScope, requestId?: string) {
    await withDb(this.db, { tenantId: s.tenantId, userId: s.userId }, async (tx) => {
      await tx.tenantBranding.updateMany({
        where: { tenantId: s.tenantId },
        data: { logoData: null, logoType: null },
      });
      await writeAudit(tx, {
        action: 'tenant.branding_logo_removed',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        requestId,
      });
    });
  }

  /** Platform staff set a new company's logo right after registering it. */
  async setLogoForTenant(actorUserId: string, tenantId: string, bytes: Buffer, requestId?: string) {
    const type = checkImage(bytes, MAX_LOGO_BYTES);
    await withDb(this.db, { platform: true, userId: actorUserId }, async (tx) => {
      const exists = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
      if (!exists) throw AppError.notFound('Company not found');
      await tx.tenantBranding.upsert({
        where: { tenantId },
        create: { tenantId, logoData: new Uint8Array(bytes), logoType: type },
        update: { logoData: new Uint8Array(bytes), logoType: type },
      });
      await writeAudit(tx, {
        action: 'platform.tenant_logo',
        outcome: 'SUCCESS',
        tenantId,
        actorUserId,
        requestId,
      });
    });
  }
}
