import { withDb, type Db } from '../../platform/db.js';
import type { MailBrand, MailMessage, Mailer } from './mailer.js';
import { systemBrand } from './templates.js';

const TTL_MS = 60_000;

/**
 * Puts the right look on every message before it goes out: a message about a company is sent in
 * that company's name, logo and colours (its web page as the address); everything else, and
 * anything from platform staff, is sent as the system.
 */
export class BrandedMailer implements Mailer {
  private readonly cache = new Map<string, { at: number; brand: MailBrand }>();
  constructor(
    private readonly inner: Mailer,
    private readonly db: Db,
    private readonly appUrl: string,
    private readonly now: () => number = Date.now,
  ) {}

  private origin() {
    return this.appUrl.replace(/\/$/, '');
  }

  system(): MailBrand {
    return systemBrand(this.origin());
  }

  async brandFor(tenantId: string | undefined): Promise<MailBrand> {
    if (!tenantId) return this.system();
    const hit = this.cache.get(tenantId);
    if (hit && this.now() - hit.at < TTL_MS) return hit.brand;
    const row = await withDb(this.db, { platform: true }, async (tx) => {
      const t = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, slug: true },
      });
      if (!t) return null;
      const b = await tx.tenantBranding.findUnique({
        where: { tenantId },
        select: { primaryColor: true, accentColor: true, logoType: true, updatedAt: true },
      });
      return { t, b };
    });
    const base = this.system();
    const brand: MailBrand = row
      ? {
          name: row.t.name,
          logoUrl: row.b?.logoType
            ? `${this.origin()}/api/v1/public/companies/${row.t.slug}/logo?v=${row.b.updatedAt.getTime()}`
            : null,
          primary: row.b?.primaryColor ?? base.primary,
          accent: row.b?.accentColor ?? base.accent,
          siteUrl: `${this.origin()}/${row.t.slug}`,
        }
      : base;
    this.cache.set(tenantId, { at: this.now(), brand });
    return brand;
  }

  async send(msg: MailMessage): Promise<void> {
    const brand = msg.brand ?? (await this.brandFor(msg.tenantId));
    await this.inner.send({ ...msg, brand });
  }
}
