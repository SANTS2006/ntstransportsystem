import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, createTenantWithOwner, TEST_DB_URL } from './helpers.js';
import { withDb, type Db, type Tx } from '../src/platform/db.js';

describe.skipIf(!TEST_DB_URL)('tenant isolation (database)', () => {
  let db: Db;
  let a: Awaited<ReturnType<typeof createTenantWithOwner>>;
  let b: Awaited<ReturnType<typeof createTenantWithOwner>>;

  beforeAll(async () => {
    db = createDb(TEST_DB_URL as string);
    a = await createTenantWithOwner(db, 'iso-a');
    b = await createTenantWithOwner(db, 'iso-b');
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('connects as a role that cannot bypass row-level security', async () => {
    const rows = await db.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(rows[0]?.rolsuper).toBe(false);
    expect(rows[0]?.rolbypassrls).toBe(false);
  });

  it('shows no tenant rows without context', async () => {
    const roles = await withDb(db, {}, (tx) => tx.role.count());
    const members = await withDb(db, {}, (tx) => tx.membership.count());
    expect(roles).toBe(0);
    expect(members).toBe(0);
  });

  it('limits reads to the active tenant', async () => {
    const roles = await withDb(db, { tenantId: a.tenant.id }, (tx) => tx.role.findMany());
    expect(roles.length).toBeGreaterThan(0);
    expect(roles.every((r) => r.tenantId === a.tenant.id)).toBe(true);
    const members = await withDb(db, { tenantId: a.tenant.id }, (tx) => tx.membership.findMany());
    expect(members.map((m) => m.userId)).toEqual([a.user.id]);
  });

  it("cannot read another tenant's object by id", async () => {
    const bRole = await withDb(db, { platform: true }, (tx) =>
      tx.role.findFirstOrThrow({ where: { tenantId: b.tenant.id } }),
    );
    const seen = await withDb(db, { tenantId: a.tenant.id }, (tx) =>
      tx.role.findUnique({ where: { id: bRole.id } }),
    );
    expect(seen).toBeNull();
  });

  it('cannot modify or delete another tenant rows', async () => {
    const bMember = await withDb(db, { platform: true }, (tx) =>
      tx.membership.findFirstOrThrow({ where: { tenantId: b.tenant.id } }),
    );
    const upd = await withDb(db, { tenantId: a.tenant.id }, (tx) =>
      tx.membership.updateMany({ where: { id: bMember.id }, data: { status: 'REVOKED' } }),
    );
    const del = await withDb(db, { tenantId: a.tenant.id }, (tx) =>
      tx.membership.deleteMany({ where: { id: bMember.id } }),
    );
    expect(upd.count).toBe(0);
    expect(del.count).toBe(0);
    const still = await withDb(db, { platform: true }, (tx) =>
      tx.membership.findUnique({ where: { id: bMember.id } }),
    );
    expect(still?.status).toBe('ACTIVE');
  });

  it('rejects inserting rows into another tenant', async () => {
    const bRole = await withDb(db, { platform: true }, (tx) =>
      tx.role.findFirstOrThrow({ where: { tenantId: b.tenant.id } }),
    );
    await expect(
      withDb(db, { tenantId: a.tenant.id }, (tx) =>
        tx.membership.create({
          data: { tenantId: b.tenant.id, userId: a.user.id, roleId: bRole.id, status: 'ACTIVE' },
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects a membership that points at another tenant role (composite FK)', async () => {
    const bRole = await withDb(db, { platform: true }, (tx) =>
      tx.role.findFirstOrThrow({ where: { tenantId: b.tenant.id } }),
    );
    const outsider = await db.user.create({
      data: { email: `outsider-${Date.now()}@example.test`, displayName: 'x' },
    });
    await expect(
      withDb(db, { platform: true }, (tx) =>
        tx.membership.create({
          data: { tenantId: a.tenant.id, userId: outsider.id, roleId: bRole.id },
        }),
      ),
    ).rejects.toThrow();
  });

  it('does not leak context between sequential pooled transactions', async () => {
    const inTenant = await withDb(db, { tenantId: a.tenant.id }, (tx) => tx.role.count());
    const after = await withDb(db, {}, (tx) => tx.role.count());
    expect(inTenant).toBeGreaterThan(0);
    expect(after).toBe(0);
  });

  it('lets a user see only their own memberships via user context', async () => {
    const mine = await withDb(db, { userId: a.user.id }, (tx) => tx.membership.findMany());
    expect(mine.map((m) => m.tenantId)).toEqual([a.tenant.id]);
  });

  it('rejects malformed context identifiers instead of interpolating them', async () => {
    await expect(
      withDb(db, { tenantId: "x'; DROP TABLE roles;--" }, async () => 1),
    ).rejects.toThrow(/Invalid database context/);
  });

  it('keeps the audit log append-only', async () => {
    await db.auditLog.createMany({ data: [{ action: 'test.event', outcome: 'SUCCESS' }] });
    const mutate = (fn: (tx: Tx) => Promise<unknown>) => withDb(db, { platform: true }, fn);
    // Even with full (platform) visibility, the app role cannot rewrite or remove audit rows.
    await expect(
      mutate((tx) =>
        tx.auditLog.updateMany({ where: { action: 'test.event' }, data: { outcome: 'FAILURE' } }),
      ),
    ).rejects.toThrow();
    await expect(
      mutate((tx) => tx.auditLog.deleteMany({ where: { action: 'test.event' } })),
    ).rejects.toThrow();
  });

  it("hides one tenant's audit rows from another tenant", async () => {
    await withDb(db, { tenantId: b.tenant.id }, (tx) =>
      tx.auditLog.createMany({
        data: [{ action: 'iso.b.secret', outcome: 'SUCCESS', tenantId: b.tenant.id }],
      }),
    );
    const seen = await withDb(db, { tenantId: a.tenant.id }, (tx) =>
      tx.auditLog.findMany({ where: { action: 'iso.b.secret' } }),
    );
    expect(seen).toHaveLength(0);
  });
});
