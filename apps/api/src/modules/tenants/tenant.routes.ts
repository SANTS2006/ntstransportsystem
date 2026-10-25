import type { Request } from 'express';
import type { Router as ExpressRouter } from 'express';
import { Router } from '../../platform/router.js';
import { z } from 'zod';
import { AppError } from '../../platform/errors.js';
import { requireAuth } from '../authentication/session.middleware.js';
import type { MembershipService } from './membership.service.js';
import type { RoleService } from './role.service.js';
import {
  requireTenantPermission,
  tenantScope,
  uuidParam,
  type TenantScope,
} from './tenant.guards.js';
import { createDenialAuditor } from './tenant.audit.js';
import type { TenantService } from './tenant.service.js';
import type { Permission } from '@nts/shared';
import type { Db } from '../../platform/db.js';

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

const profileSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    timezone: timezone.optional(),
    defaultCurrency: currency.optional(),
    crewMinRestMinutes: z.number().int().min(0).max(1440).optional(),
  })
  .strict(); // unknown keys (e.g. status, slug) are rejected, not ignored
const roleKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Lowercase letters, digits, underscores');
const inviteSchema = z
  .object({ email: z.string().trim().toLowerCase().pipe(z.email().max(254)), roleKey })
  .strict();
const changeRoleSchema = z.object({ roleKey }).strict();
const addRoleSchema = z.object({ roleId: z.uuid() }).strict();
const switchRoleSchema = z.object({ role: z.union([z.literal('passenger'), z.uuid()]) }).strict();
const createRoleSchema = z
  .object({
    key: roleKey,
    name: z.string().trim().min(2).max(80),
    permissions: z.array(z.string().max(80)).max(100),
  })
  .strict();
const setPermissionsSchema = z
  .object({ permissions: z.array(z.string().max(80)).max(100) })
  .strict();
const acceptSchema = z.object({ token: z.string().min(20).max(200) }).strict();

export const pageQuery = (req: Request) => {
  const q = z
    .object({
      limit: z.coerce.number().int().min(1).max(100).default(25),
      offset: z.coerce.number().int().min(0).max(100_000).default(0),
    })
    .parse(req.query);
  return { limit: q.limit, offset: q.offset };
};

export interface TenantRouterDeps {
  db: Db;
  tenants: TenantService;
  members: MembershipService;
  roles: RoleService;
}

export function tenantRouter({ db, tenants, members, roles }: TenantRouterDeps): ExpressRouter {
  const r = Router();
  const scope = (req: Request): TenantScope => {
    if (!req.tenant) throw AppError.unauthenticated();
    return req.tenant;
  };
  const uid = (req: Request) => {
    if (!req.auth) throw AppError.unauthenticated();
    return req.auth.userId;
  };

  // --- Not tenant-scoped: the caller's own companies. Companies are registered by the platform. ---
  r.get('/tenants/mine', requireAuth, async (req, res) => {
    res.json({ tenants: await tenants.listMine(uid(req)) });
  });
  r.post('/invitations/accept', requireAuth, async (req, res) => {
    res.json(await members.accept(uid(req), acceptSchema.parse(req.body).token, req.id));
  });

  // --- Tenant-scoped ---------------------------------------------------------------------------
  // A PENDING company can read its own profile (to see review status) but nothing else.
  // The caller's own role/permissions in this company. Used only to show or hide navigation;
  // every route still enforces permissions on the server.
  r.get(
    '/tenants/:tenantId/me',
    requireAuth,
    tenantScope(db, { allowStatuses: ['ACTIVE', 'PENDING'] }),
    (req, res) => {
      const s = scope(req);
      res.json({
        role: { key: s.roleKey },
        tenantStatus: s.tenantStatus,
        permissions: [...s.permissions].sort(),
      });
    },
  );

  r.post(
    '/tenants/:tenantId/me/switch-role',
    requireAuth,
    tenantScope(db, { allowPassengerMode: true }),
    async (req, res) => {
      const { role } = switchRoleSchema.parse(req.body);
      await members.switchRole(
        scope(req).userId,
        scope(req).tenantId,
        role === 'passenger' ? 'passenger' : { roleId: role },
        req.id,
      );
      res.status(204).end();
    },
  );

  r.get(
    '/tenants/:tenantId/profile',
    requireAuth,
    tenantScope(db, { allowStatuses: ['ACTIVE', 'PENDING'] }),
    async (req, res) => {
      res.json(await tenants.getProfile(scope(req)));
    },
  );

  const t = Router({ mergeParams: true });
  t.use(requireAuth, tenantScope(db));
  // Refused actions are audited: route-level permission failures and service-level refusals
  // (escalation attempts, owner/last-owner rules), each in its own transaction.
  const audit = createDenialAuditor(db);
  const perm = (permission: Permission) =>
    requireTenantPermission(permission, audit.permissionDenied);

  t.patch('/profile', perm('tenant.profile.update'), async (req, res) => {
    res.json(await tenants.updateProfile(scope(req), profileSchema.parse(req.body), req.id));
  });

  t.get('/memberships', perm('membership.read'), async (req, res) => {
    res.json({ memberships: await members.list(scope(req), pageQuery(req)) });
  });
  t.get('/users', perm('membership.read'), async (req, res) => {
    const q = z.string().trim().max(80).optional().parse(req.query.q);
    res.json(await members.listUsers(scope(req), q || undefined, pageQuery(req)));
  });
  t.post('/memberships/:id/roles', perm('membership.invite'), async (req, res) => {
    await members.addRole(
      scope(req),
      uuidParam(req, 'id'),
      addRoleSchema.parse(req.body).roleId,
      req.id,
    );
    res.status(204).end();
  });
  t.delete('/memberships/:id/roles/:roleId', perm('membership.invite'), async (req, res) => {
    await members.removeRole(scope(req), uuidParam(req, 'id'), uuidParam(req, 'roleId'), req.id);
    res.status(204).end();
  });
  t.patch('/memberships/:id', perm('membership.invite'), async (req, res) => {
    await audit.guard(req, 'membership.change_role_denied', () =>
      members.changeRole(
        scope(req),
        uuidParam(req, 'id'),
        changeRoleSchema.parse(req.body).roleKey,
        req.id,
      ),
    );
    res.status(204).end();
  });
  t.delete('/memberships/:id', perm('membership.revoke'), async (req, res) => {
    await audit.guard(req, 'membership.revoke_denied', () =>
      members.revoke(scope(req), uuidParam(req, 'id'), req.id),
    );
    res.status(204).end();
  });

  t.get('/invitations', perm('membership.read'), async (req, res) => {
    res.json({ invitations: await members.listInvitations(scope(req)) });
  });
  t.post('/invitations', perm('membership.invite'), async (req, res) => {
    res
      .status(201)
      .json(
        await audit.guard(req, 'membership.invite_denied', () =>
          members.invite(scope(req), inviteSchema.parse(req.body), req.id),
        ),
      );
  });
  t.delete('/invitations/:id', perm('membership.invite'), async (req, res) => {
    await audit.guard(req, 'membership.invitation_revoke_denied', () =>
      members.revokeInvitation(scope(req), uuidParam(req, 'id'), req.id),
    );
    res.status(204).end();
  });

  t.get('/roles', perm('role.read'), async (req, res) => {
    res.json({ roles: await roles.list(scope(req)), catalog: roles.permissionCatalog() });
  });
  t.post('/roles', perm('role.manage'), async (req, res) => {
    res
      .status(201)
      .json(
        await audit.guard(req, 'role.create_denied', () =>
          roles.create(scope(req), createRoleSchema.parse(req.body), req.id),
        ),
      );
  });
  t.put('/roles/:id/permissions', perm('role.manage'), async (req, res) => {
    await audit.guard(req, 'role.permissions_denied', () =>
      roles.setPermissions(
        scope(req),
        uuidParam(req, 'id'),
        setPermissionsSchema.parse(req.body).permissions,
        req.id,
      ),
    );
    res.status(204).end();
  });
  t.delete('/roles/:id', perm('role.manage'), async (req, res) => {
    await audit.guard(req, 'role.delete_denied', () =>
      roles.remove(scope(req), uuidParam(req, 'id'), req.id),
    );
    res.status(204).end();
  });

  t.get('/audit', perm('audit.read'), async (req, res) => {
    res.json({ events: await tenants.listAuditEvents(scope(req), pageQuery(req)) });
  });

  r.use('/tenants/:tenantId', t);
  return r;
}

/** Exposed so the OpenAPI document is generated from the exact schemas used for validation. */
export const requestSchemas = {
  profileSchema,
  inviteSchema,
  changeRoleSchema,
  addRoleSchema,
  switchRoleSchema,
  createRoleSchema,
  setPermissionsSchema,
  acceptSchema,
};
