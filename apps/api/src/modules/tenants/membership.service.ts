import { randomBytes } from 'node:crypto';
import { hashPassword } from '../../platform/crypto.js';
import { withDb, type Db, type Tx } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../audit/audit.js';
import type { Mailer } from '../notifications/mailer.js';
import { defaultAdminPassword } from './admin-password.js';
import { assertCanGrant } from './delegation.js';
import type { TenantScope } from './tenant.guards.js';

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
        include: {
          user: { select: { email: true, displayName: true, phone: true } },
          role: true,
          roles: { include: { role: { select: { id: true, key: true, name: true } } } },
        },
        orderBy: { createdAt: 'asc' },
        take: page.limit,
        skip: page.offset,
      }),
    );
    // HR details (staff number, job, licence) only for people who may see them.
    const employees = s.permissions.has('hr.read')
      ? await withDb(this.db, this.ctx(s), (tx) =>
          tx.employee.findMany({
            where: { tenantId: s.tenantId, userId: { in: rows.map((m) => m.userId) } },
            include: { licences: { select: { expiresOn: true } } },
          }),
        )
      : [];
    const byUser = new Map(employees.map((e) => [e.userId, e]));
    return rows.map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      phone: m.user.phone,
      employee: byUser.get(m.userId)
        ? {
            id: byUser.get(m.userId)!.id,
            employeeNumber: byUser.get(m.userId)!.employeeNumber,
            job: byUser.get(m.userId)!.role,
            status: byUser.get(m.userId)!.status,
            hiredOn: byUser.get(m.userId)!.hiredOn?.toISOString().slice(0, 10) ?? null,
            licenceExpiresOn:
              byUser
                .get(m.userId)!
                .licences.map((l) => l.expiresOn)
                .sort((a, b) => b.getTime() - a.getTime())[0]
                ?.toISOString()
                .slice(0, 10) ?? null,
          }
        : null,
      displayName: m.user.displayName,
      status: m.status,
      roles: m.roles.map((r) => r.role).sort((a, b) => a.name.localeCompare(b.name)),
      passengerMode: m.passengerMode,
      role: { id: m.role.id, key: m.role.key, name: m.role.name },
      createdAt: m.createdAt,
    }));
  }

  /**
   * Makes the first administrator of a company a platform administrator has just registered. A new
   * person gets an account with a generated first password that must be changed at first sign-in; an
   * existing account is simply made owner and keeps its own password. Either way the person is
   * e-mailed the company's sign-in address.
   */
  async provisionAdmin(
    actorUserId: string,
    input: {
      tenantId: string;
      companyName: string;
      slug: string;
      name: string;
      email: string;
      ownerRoleId: string;
    },
    requestId?: string,
  ) {
    const year = this.now().getFullYear();
    const generated = defaultAdminPassword(input.companyName, year);
    const result = await withDb(this.db, { platform: true, userId: actorUserId }, async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: input.email } });
      let userId: string;
      if (existing) {
        userId = existing.id;
      } else {
        userId = (
          await tx.user.create({
            data: {
              email: input.email,
              displayName: input.name,
              // The platform vouches for this address, so no confirmation step is needed.
              emailVerifiedAt: this.now(),
              passwordHash: await hashPassword(generated),
              mustChangePassword: true,
              homeTenantId: input.tenantId,
            },
          })
        ).id;
      }
      await tx.membership.create({
        data: {
          tenantId: input.tenantId,
          userId,
          roleId: input.ownerRoleId,
          status: 'ACTIVE',
        },
      });
      await writeAudit(tx, {
        action: 'platform.admin_provisioned',
        outcome: 'SUCCESS',
        tenantId: input.tenantId,
        actorUserId,
        targetType: 'user',
        targetId: userId,
        requestId,
        summary: { newAccount: !existing },
      });
      return { isNew: !existing };
    });
    await this.mailer.send({
      to: input.email,
      tenantId: input.tenantId,
      template: 'company-admin-created',
      data: {
        company: input.companyName,
        name: input.name,
        link: `${this.appUrl.replace(/\/$/, '')}/${input.slug}/login`,
        email: input.email,
        password: result.isNew ? generated : '',
      },
    });
    return { email: input.email, newAccount: result.isNew };
  }

  /**
   * Gives a newly added employee a sign-in: a new account with a random first password (changed at
   * first sign-in) or, when the e-mail already has one, a membership on that account. The person is
   * e-mailed their details and the company's sign-in address. Returns the account's id.
   */
  async provisionStaff(
    s: TenantScope,
    input: {
      email: string;
      name: string;
      phone?: string | undefined;
      employeeNumber: string;
      job: string;
      roleKey: string;
    },
    requestId?: string,
  ): Promise<{ userId: string; newAccount: boolean }> {
    const email = input.email.trim().toLowerCase();
    const password = randomBytes(10).toString('base64url');
    const out = await withDb(this.db, { platform: true, userId: s.userId }, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: s.tenantId },
        select: { name: true, slug: true },
      });
      if (!tenant) throw AppError.notFound('Company not found');
      const role = await this.roleWithPermissions(tx, s.tenantId, { key: input.roleKey });
      // The same rule as everywhere: you can only give a role whose permissions you hold.
      this.assertMayAssign(s, role);
      const existing = await tx.user.findUnique({ where: { email } });
      let userId: string;
      if (existing) {
        const already = await tx.membership.findFirst({
          where: { tenantId: s.tenantId, userId: existing.id, status: { not: 'REVOKED' } },
        });
        if (already)
          throw AppError.conflict('This e-mail already belongs to a member of the company');
        userId = existing.id;
      } else {
        const phone = input.phone && /^\+\d{8,15}$/.test(input.phone) ? input.phone : null;
        const phoneTaken = phone ? await tx.user.findUnique({ where: { phone } }) : null;
        userId = (
          await tx.user.create({
            data: {
              email,
              displayName: input.name,
              emailVerifiedAt: this.now(),
              passwordHash: await hashPassword(password),
              mustChangePassword: true,
              homeTenantId: s.tenantId,
              ...(phone && !phoneTaken ? { phone } : {}),
            },
          })
        ).id;
      }
      await tx.membership.upsert({
        where: { tenantId_userId: { tenantId: s.tenantId, userId } },
        update: { roleId: role.id, status: 'ACTIVE' },
        create: { tenantId: s.tenantId, userId, roleId: role.id, status: 'ACTIVE' },
      });
      await writeAudit(tx, {
        action: 'hr.staff_account_created',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'user',
        targetId: userId,
        requestId,
        summary: { newAccount: !existing },
      });
      return { userId, newAccount: !existing, company: tenant.name, slug: tenant.slug };
    });
    await this.mailer.send({
      to: email,
      tenantId: s.tenantId,
      template: 'staff-added',
      data: {
        company: out.company,
        name: input.name,
        email,
        phone: input.phone ?? '',
        employeeNumber: input.employeeNumber,
        job: input.job,
        password: out.newAccount ? password : '',
        link: `${this.appUrl.replace(/\/$/, '')}/${out.slug}/login`,
      },
    });
    return { userId: out.userId, newAccount: out.newAccount };
  }

  /** Holders of the owner role cannot be left with none. */
  private async assertOwnerRemains(tx: Tx, tenantId: string, membershipId: string) {
    const others = await tx.membership.count({
      where: {
        tenantId,
        status: 'ACTIVE',
        id: { not: membershipId },
        roles: { some: { role: { key: 'owner' } } },
      },
    });
    if (others < 1) throw AppError.conflict('A company must keep at least one owner');
  }

  /** Gives a staff member one more role. They keep what they hold and can switch to it. */
  async addRole(s: TenantScope, membershipId: string, roleId: string, requestId?: string) {
    await withDb(this.db, this.ctx(s), async (tx) => {
      const target = await tx.membership.findFirst({
        where: { id: membershipId, tenantId: s.tenantId, status: 'ACTIVE' },
        include: { roles: { include: { role: { include: { permissions: true } } } } },
      });
      if (!target) throw AppError.notFound();
      if (target.userId === s.userId) throw AppError.forbidden('You cannot change your own roles');
      // Someone who holds a role above yours cannot be edited by you.
      for (const held of target.roles) {
        assertCanGrant(
          s,
          held.role.permissions.map((p) => p.permission),
        );
        if (held.role.key === 'owner' && s.roleKey !== 'owner') throw AppError.forbidden();
      }
      const role = await this.roleWithPermissions(tx, s.tenantId, { id: roleId });
      this.assertMayAssign(s, role);
      if (target.roles.some((r) => r.roleId === role.id)) {
        throw AppError.conflict('They already hold this role');
      }
      await tx.membershipRole.create({
        data: { membershipId: target.id, roleId: role.id, tenantId: s.tenantId },
      });
      await writeAudit(tx, {
        action: 'membership.role_added',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'membership',
        targetId: target.id,
        requestId,
        summary: { role: role.key },
      });
    });
  }

  /** Takes one role away. They must keep at least one, and a company must keep an owner. */
  async removeRole(s: TenantScope, membershipId: string, roleId: string, requestId?: string) {
    await withDb(this.db, this.ctx(s), async (tx) => {
      const target = await tx.membership.findFirst({
        where: { id: membershipId, tenantId: s.tenantId, status: 'ACTIVE' },
        include: { roles: { include: { role: { include: { permissions: true } } } } },
      });
      if (!target) throw AppError.notFound();
      if (target.userId === s.userId) throw AppError.forbidden('You cannot change your own roles');
      for (const held of target.roles) {
        assertCanGrant(
          s,
          held.role.permissions.map((p) => p.permission),
        );
        if (held.role.key === 'owner' && s.roleKey !== 'owner') throw AppError.forbidden();
      }
      const going = target.roles.find((r) => r.roleId === roleId);
      if (!going) throw AppError.notFound();
      if (target.roles.length <= 1) {
        throw AppError.conflict('A staff member must keep at least one role');
      }
      if (going.role.key === 'owner') await this.assertOwnerRemains(tx, s.tenantId, target.id);
      // If it is the role they are acting as, they carry on as another one they hold.
      if (target.roleId === roleId) {
        const next = target.roles.find((r) => r.roleId !== roleId)!;
        await tx.membership.update({ where: { id: target.id }, data: { roleId: next.roleId } });
      }
      await tx.membershipRole.delete({
        where: { membershipId_roleId: { membershipId: target.id, roleId } },
      });
      await writeAudit(tx, {
        action: 'membership.role_removed',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'membership',
        targetId: target.id,
        requestId,
        summary: { role: going.role.key },
      });
    });
  }

  /**
   * The person switches which role they are acting as: the Passenger role, or one of the staff
   * roles they hold. From the next request only that role's permissions apply.
   */
  async switchRole(
    userId: string,
    tenantId: string,
    target: 'passenger' | { roleId: string },
    requestId?: string,
  ) {
    return withDb(this.db, { userId, tenantId }, async (tx) => {
      const m = await tx.membership.findFirst({
        where: { tenantId, userId, status: 'ACTIVE' },
        include: { roles: true },
      });
      if (!m) throw AppError.notFound();
      if (target === 'passenger') {
        await tx.membership.update({ where: { id: m.id }, data: { passengerMode: true } });
      } else {
        if (!m.roles.some((r) => r.roleId === target.roleId)) {
          throw AppError.forbidden('You do not hold that role');
        }
        await tx.membership.update({
          where: { id: m.id },
          data: { roleId: target.roleId, passengerMode: false },
        });
      }
      await writeAudit(tx, {
        action: 'membership.role_switched',
        outcome: 'SUCCESS',
        tenantId,
        actorUserId: userId,
        targetType: 'membership',
        targetId: m.id,
        requestId,
        summary: { to: target === 'passenger' ? 'passenger' : target.roleId },
      });
    });
  }

  /** Everyone who signed up on this company's page (its passengers), staff included. */
  async listUsers(s: TenantScope, q: string | undefined, page: { limit: number; offset: number }) {
    const where = {
      homeTenantId: s.tenantId,
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: 'insensitive' as const } },
              { email: { contains: q, mode: 'insensitive' as const } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: page.limit,
        skip: page.offset,
        select: {
          id: true,
          displayName: true,
          email: true,
          phone: true,
          status: true,
          createdAt: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
        },
      }),
      this.db.user.count({ where }),
    ]);
    const staff = await withDb(this.db, this.ctx(s), (tx) =>
      tx.membership.findMany({
        where: { tenantId: s.tenantId, status: 'ACTIVE', userId: { in: rows.map((r) => r.id) } },
        select: { userId: true },
      }),
    );
    const staffIds = new Set(staff.map((m) => m.userId));
    return {
      total,
      users: rows.map((u) => ({
        id: u.id,
        name: u.displayName,
        email: u.email,
        phone: u.phone,
        status: u.status,
        verified: Boolean(u.emailVerifiedAt ?? u.phoneVerifiedAt),
        joinedAt: u.createdAt,
        isStaff: staffIds.has(u.id),
      })),
    };
  }

  private async activeOwnerCount(tx: Tx, tenantId: string) {
    return tx.membership.count({
      where: { tenantId, status: 'ACTIVE', roles: { some: { role: { key: 'owner' } } } },
    });
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
      await tx.membership.update({
        where: { id: target.id },
        data: { roleId: next.id, passengerMode: false },
      });
      // "Change role" replaces everything they held with this one role.
      await tx.membershipRole.deleteMany({
        where: { membershipId: target.id, NOT: { roleId: next.id } },
      });
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
