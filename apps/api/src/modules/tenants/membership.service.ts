import { generateToken, hashToken } from '../../platform/crypto.js';
import { withDb, type Db, type Tx } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../audit/audit.js';
import type { Mailer } from '../notifications/mailer.js';
import { assertCanGrant } from './delegation.js';
import type { TenantScope } from './tenant.guards.js';

const INVITE_TTL_MS = 7 * 24 * 3600_000;

export class MembershipService {
  constructor(
    private readonly db: Db,
    private readonly mailer: Mailer,
    private readonly appUrl: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private ctx(s: TenantScope) {
    return { tenantId: s.tenantId, userId: s.userId };
  }

  private async roleWithPermissions(
    tx: Tx,
    tenantId: string,
    where: { id?: string; key?: string },
  ) {
    const role = await tx.role.findFirst({
      where: { tenantId, ...where },
      include: { permissions: true },
    });
    if (!role) throw AppError.notFound('Role not found');
    return role;
  }

  /**
   * A caller may only assign a role whose permissions they all hold; the owner role can only be
   * assigned by an owner (defense in depth on top of the subset rule).
   */
  private assertMayAssign(
    s: TenantScope,
    role: { key: string; permissions: { permission: string }[] },
  ) {
    if (role.key === 'owner' && s.roleKey !== 'owner') {
      throw AppError.forbidden('Only a company owner can assign the owner role');
    }
    assertCanGrant(
      s,
      role.permissions.map((p) => p.permission),
    );
  }

  async list(s: TenantScope, page: { limit: number; offset: number }) {
    const rows = await withDb(this.db, this.ctx(s), (tx) =>
      tx.membership.findMany({
        where: { tenantId: s.tenantId },
        include: { user: { select: { email: true, displayName: true } }, role: true },
        orderBy: { createdAt: 'asc' },
        take: page.limit,
        skip: page.offset,
      }),
    );
    return rows.map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      displayName: m.user.displayName,
      status: m.status,
      role: { id: m.role.id, key: m.role.key, name: m.role.name },
      createdAt: m.createdAt,
    }));
  }

  async invite(s: TenantScope, input: { email: string; roleKey: string }, requestId?: string) {
    const token = generateToken();
    const email = input.email;
    const result = await withDb(this.db, this.ctx(s), async (tx) => {
      const role = await this.roleWithPermissions(tx, s.tenantId, { key: input.roleKey });
      this.assertMayAssign(s, role);

      const existingUser = await this.db.user.findUnique({ where: { email } });
      if (existingUser) {
        const already = await tx.membership.findFirst({
          where: { tenantId: s.tenantId, userId: existingUser.id, status: 'ACTIVE' },
        });
        if (already) throw AppError.conflict('This person is already a member');
      }
      // One live invitation per email: revoke any earlier ones.
      await tx.invitation.updateMany({
        where: { tenantId: s.tenantId, email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: this.now() },
      });
      const invitation = await tx.invitation.create({
        data: {
          tenantId: s.tenantId,
          email,
          roleId: role.id,
          tokenHash: hashToken(token),
          invitedBy: s.userId,
          expiresAt: new Date(this.now().getTime() + INVITE_TTL_MS),
        },
      });
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: s.tenantId } });
      await writeAudit(tx, {
        action: 'membership.invited',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'invitation',
        targetId: invitation.id,
        requestId,
        summary: { role: role.key },
      });
      return { id: invitation.id, tenantName: tenant.name, role: role.key };
    });
    // Sent after commit. The email states the company name but carries no other tenant data.
    await this.mailer.send({
      to: email,
      template: 'tenant-invitation',
      data: { company: result.tenantName, link: `${this.appUrl}/accept-invitation?token=${token}` },
    });
    return { id: result.id, email, role: result.role };
  }

  async listInvitations(s: TenantScope) {
    const rows = await withDb(this.db, this.ctx(s), (tx) =>
      tx.invitation.findMany({
        where: {
          tenantId: s.tenantId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: this.now() },
        },
        include: { role: { select: { key: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return rows.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt }));
  }

  async revokeInvitation(s: TenantScope, invitationId: string, requestId?: string) {
    await withDb(this.db, this.ctx(s), async (tx) => {
      const res = await tx.invitation.updateMany({
        where: { id: invitationId, tenantId: s.tenantId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: this.now() },
      });
      if (res.count !== 1) throw AppError.notFound();
      await writeAudit(tx, {
        action: 'membership.invitation_revoked',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'invitation',
        targetId: invitationId,
        requestId,
      });
    });
  }

  /**
   * The invited person accepts while signed in. Lookup by token hash needs platform scope (the
   * caller has no tenant context yet), so this method is deliberately narrow: it only ever acts on
   * the single invitation whose secret the caller presented, and only if the caller's VERIFIED
   * account email matches the invited address.
   */
  async accept(userId: string, token: string, requestId?: string) {
    const invalid = () => AppError.validation('This invitation is invalid or has expired');
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    return withDb(this.db, { platform: true, userId }, async (tx) => {
      const inv = await tx.invitation.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { tenant: true },
      });
      if (
        !inv ||
        inv.acceptedAt ||
        inv.revokedAt ||
        inv.expiresAt <= this.now() ||
        inv.email !== user.email ||
        !user.emailVerifiedAt ||
        user.status !== 'ACTIVE' ||
        inv.tenant.status !== 'ACTIVE'
      ) {
        throw invalid();
      }
      const claimed = await tx.invitation.updateMany({
        where: { id: inv.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: this.now() },
      });
      if (claimed.count !== 1) throw invalid();
      await tx.membership.upsert({
        where: { tenantId_userId: { tenantId: inv.tenantId, userId } },
        create: {
          tenantId: inv.tenantId,
          userId,
          roleId: inv.roleId,
          status: 'ACTIVE',
          invitedBy: inv.invitedBy,
        },
        update: { roleId: inv.roleId, status: 'ACTIVE' },
      });
      await writeAudit(tx, {
        action: 'membership.invitation_accepted',
        outcome: 'SUCCESS',
        tenantId: inv.tenantId,
        actorUserId: userId,
        targetType: 'invitation',
        targetId: inv.id,
        requestId,
      });
      return { tenantId: inv.tenantId, name: inv.tenant.name };
    });
  }

  private async activeOwnerCount(tx: Tx, tenantId: string) {
    return tx.membership.count({ where: { tenantId, status: 'ACTIVE', role: { key: 'owner' } } });
  }

  async changeRole(s: TenantScope, membershipId: string, roleKey: string, requestId?: string) {
    await withDb(this.db, this.ctx(s), async (tx) => {
      const target = await tx.membership.findFirst({
        where: { id: membershipId, tenantId: s.tenantId, status: 'ACTIVE' },
        include: { role: { include: { permissions: true } } },
      });
      if (!target) throw AppError.notFound();
      if (target.userId === s.userId) throw AppError.forbidden('You cannot change your own role');
      // Modifying an owner is itself an owner-only act.
      if (target.role.key === 'owner' && s.roleKey !== 'owner') throw AppError.forbidden();
      // Cannot touch someone who holds permissions you lack (would let you demote your superiors).
      assertCanGrant(
        s,
        target.role.permissions.map((p) => p.permission),
      );

      const next = await this.roleWithPermissions(tx, s.tenantId, { key: roleKey });
      this.assertMayAssign(s, next);
      if (
        target.role.key === 'owner' &&
        next.key !== 'owner' &&
        (await this.activeOwnerCount(tx, s.tenantId)) <= 1
      ) {
        throw AppError.conflict('A company must keep at least one owner');
      }
      await tx.membership.update({ where: { id: target.id }, data: { roleId: next.id } });
      await writeAudit(tx, {
        action: 'membership.role_changed',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'membership',
        targetId: target.id,
        requestId,
        summary: { from: target.role.key, to: next.key },
      });
    });
  }

  /** Revocation takes effect on the very next request: tenantScope re-reads membership each time. */
  async revoke(s: TenantScope, membershipId: string, requestId?: string) {
    await withDb(this.db, this.ctx(s), async (tx) => {
      const target = await tx.membership.findFirst({
        where: { id: membershipId, tenantId: s.tenantId, status: 'ACTIVE' },
        include: { role: { include: { permissions: true } } },
      });
      if (!target) throw AppError.notFound();
      if (target.role.key === 'owner' && s.roleKey !== 'owner') throw AppError.forbidden();
      assertCanGrant(
        s,
        target.role.permissions.map((p) => p.permission),
      );
      if (target.role.key === 'owner' && (await this.activeOwnerCount(tx, s.tenantId)) <= 1) {
        throw AppError.conflict('A company must keep at least one owner');
      }
      await tx.membership.update({ where: { id: target.id }, data: { status: 'REVOKED' } });
      await writeAudit(tx, {
        action: 'membership.revoked',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'membership',
        targetId: target.id,
        requestId,
        summary: { role: target.role.key, self: target.userId === s.userId },
      });
    });
  }
}
