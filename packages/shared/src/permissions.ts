/** Central permission catalog. Roles are sets of these strings; checks are server-side only. */
export const PERMISSIONS = [
  'tenant.profile.read',
  'tenant.profile.update',
  'membership.read',
  'membership.invite',
  'membership.revoke',
  'role.read',
  'role.manage',
  'audit.read',
  'route.read',
  'route.manage',
  'trip.read',
  'trip.manage',
  'fleet.read',
  'fleet.manage',
  'booking.read',
  'booking.manage',
  'ticket.validate',
  'payment.read',
  'payment.manage',
  'finance.report.read',
  'hr.read',
  'hr.manage',
  'recruitment.manage',
  'support.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Default tenant roles seeded per company. `owner` is a system role and cannot be edited away. */
export const DEFAULT_TENANT_ROLES: Record<string, { name: string; permissions: Permission[] }> = {
  owner: { name: 'Company Owner', permissions: [...PERMISSIONS] },
  admin: {
    name: 'Company Administrator',
    permissions: PERMISSIONS.filter((p) => p !== 'finance.report.read' && p !== 'hr.read'),
  },
  dispatcher: {
    name: 'Dispatcher',
    permissions: ['route.read', 'trip.read', 'trip.manage', 'fleet.read'],
  },
  sales_agent: {
    name: 'Ticketing/Sales Agent',
    permissions: ['route.read', 'trip.read', 'booking.read', 'booking.manage'],
  },
  driver: { name: 'Driver', permissions: ['trip.read', 'ticket.validate'] },
  finance_officer: {
    name: 'Finance Officer',
    permissions: ['payment.read', 'finance.report.read', 'booking.read'],
  },
  hr_manager: { name: 'HR Manager', permissions: ['hr.read', 'hr.manage', 'recruitment.manage'] },
  auditor: {
    name: 'Read-only Auditor',
    permissions: ['audit.read', 'route.read', 'trip.read', 'booking.read'],
  },
};

export const isPermission = (v: string): v is Permission =>
  (PERMISSIONS as readonly string[]).includes(v);
