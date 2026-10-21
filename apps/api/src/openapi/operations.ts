import type { ZodType } from 'zod';
import { requestSchemas as authBodies } from '../modules/authentication/auth.routes.js';
import {
  changePasswordSchema,
  forgotSchema,
  loginSchema,
  registerSchema,
  resetSchema,
  tokenSchema,
} from '../modules/authentication/auth.schemas.js';
import { requestSchemas as catalog } from '../modules/catalog/catalog.routes.js';
import { requestSchemas as booking } from '../modules/booking/booking.routes.js';
import { requestSchemas as dispatch } from '../modules/catalog/dispatch.routes.js';
import { requestSchemas as crew } from '../modules/crew/crew.routes.js';
import { requestSchemas as platform } from '../modules/tenants/platform.routes.js';
import { requestSchemas as tenant } from '../modules/tenants/tenant.routes.js';

export type Access = 'public' | 'session' | 'tenant' | 'platform';

export interface QueryParam {
  name: string;
  description: string;
  enum?: readonly string[];
  format?: 'date' | 'uuid';
}

export interface Operation {
  summary: string;
  description?: string;
  tag: string;
  /** public: no sign-in. session: signed-in user. tenant: member of :tenantId. platform: platform staff + MFA. */
  access: Access;
  /** Tenant permission the caller must hold (tenant routes), or platform roles (platform routes). */
  permission?: string;
  body?: ZodType;
  query?: QueryParam[];
  paged?: boolean;
  ok: number;
  okDescription?: string;
  /** Registered only when a feature is configured (Google sign-in, MFA, docs). Omitted from the served spec when absent. */
  optional?: true;
}

const date = (name: string, description: string): QueryParam => ({
  name,
  description,
  format: 'date',
});
const T = 'tenant' as const;

/**
 * One entry per route, keyed "METHOD /full/path". A test fails if a registered route has no entry
 * here, or an entry has no route, so this table stays in step with the code.
 */
export const operations: Record<string, Operation> = {
  // ---- System ---------------------------------------------------------------------------------
  'GET /health/live': {
    summary: 'Liveness probe',
    description: 'Returns 200 while the process is running. No internal detail is exposed.',
    tag: 'System',
    access: 'public',
    ok: 200,
  },
  'GET /health/ready': {
    summary: 'Readiness probe',
    description:
      'Returns 200 when dependencies (database, Redis) answer within 3 seconds, otherwise 503 with no detail.',
    tag: 'System',
    access: 'public',
    ok: 200,
  },
  'GET /api/v1/openapi.json': {
    optional: true,
    summary: 'OpenAPI document',
    description:
      'This document. Only served when API documentation is enabled. Only served when API_DOCS_ENABLED is on (default: off in production).',
    tag: 'System',
    access: 'public',
    ok: 200,
  },
  'GET /api/v1/docs': {
    description: 'Only served when API_DOCS_ENABLED is on (default: off in production).',
    optional: true,
    summary: 'Interactive API documentation (Swagger UI)',
    tag: 'System',
    access: 'public',
    ok: 200,
  },
  'GET /api/v1/docs/init.js': {
    description: 'Only served when API_DOCS_ENABLED is on (default: off in production).',
    optional: true,
    summary: 'Swagger UI bootstrap script',
    tag: 'System',
    access: 'public',
    ok: 200,
  },

  // ---- Authentication ---------------------------------------------------------------------------
  'POST /api/v1/auth/register': {
    summary: 'Register with email and password',
    description:
      'Always answers 202 with the same message whether or not the address is already registered, to avoid account enumeration. Sends a verification email.',
    tag: 'Auth',
    access: 'public',
    body: registerSchema,
    ok: 202,
  },
  'POST /api/v1/auth/verify-email': {
    summary: 'Confirm an email address',
    description: 'Consumes a single-use, expiring token from the verification email.',
    tag: 'Auth',
    access: 'public',
    body: tokenSchema,
    ok: 200,
  },
  'POST /api/v1/auth/login': {
    summary: 'Sign in with email and password',
    description:
      'On success sets the HttpOnly `sid` session cookie and a readable `csrf` cookie. If the account has two-step verification the response is `{ mfaRequired: true, challengeToken }` and no session is created yet. Failures never reveal whether the account exists; repeated failures lock the account progressively.',
    tag: 'Auth',
    access: 'public',
    body: loginSchema,
    ok: 200,
  },
  'POST /api/v1/auth/mfa/verify': {
    summary: 'Complete sign-in with a TOTP or recovery code',
    description:
      'Exchanges a short-lived, single-use challenge plus a 6-digit code (or a one-time recovery code) for a session. Limited attempts per challenge.',
    tag: 'Auth',
    access: 'public',
    body: authBodies.mfaVerifySchema,
    ok: 200,
  },
  'POST /api/v1/auth/google': {
    optional: true,
    summary: 'Sign in or sign up with Google',
    description:
      "The client sends the Google Identity Services ID token (`credential`); the server verifies signature, audience, issuer and expiry and keys the identity on Google's `sub`. Existing verified email accounts are never auto-linked (409). Disabled (404) unless a Google client ID is configured. Only available when GOOGLE_CLIENT_ID is configured.",
    tag: 'Auth',
    access: 'public',
    body: authBodies.credentialSchema,
    ok: 200,
  },
  'POST /api/v1/auth/google/link': {
    optional: true,
    summary: 'Link a Google account to the signed-in user',
    description:
      'Accounts that have a password must re-enter it. Only available when GOOGLE_CLIENT_ID is configured.',
    tag: 'Auth',
    access: 'session',
    body: authBodies.googleLinkSchema,
    ok: 200,
  },
  'POST /api/v1/auth/logout': {
    summary: 'Sign out',
    description: 'Revokes the current session and clears the cookies. Always 204.',
    tag: 'Auth',
    access: 'public',
    ok: 204,
  },
  'POST /api/v1/auth/forgot-password': {
    summary: 'Request a password reset email',
    description:
      'Always answers 202 with the same message. Tokens expire after 30 minutes and are single use.',
    tag: 'Auth',
    access: 'public',
    body: forgotSchema,
    ok: 202,
  },
  'POST /api/v1/auth/reset-password': {
    summary: 'Set a new password with a reset token',
    description: 'Revokes every session of the account and sends a notification email.',
    tag: 'Auth',
    access: 'public',
    body: resetSchema,
    ok: 200,
  },
  'POST /api/v1/auth/change-password': {
    summary: 'Change password',
    description: 'Revokes all other sessions; the caller stays signed in.',
    tag: 'Auth',
    access: 'session',
    body: changePasswordSchema,
    ok: 200,
  },
  'GET /api/v1/auth/me': {
    summary: 'Current user',
    description:
      'Profile, whether MFA is on, linked identities and platform role names (names only).',
    tag: 'Auth',
    access: 'session',
    ok: 200,
  },
  'GET /api/v1/auth/sessions': {
    summary: 'List my active sessions',
    tag: 'Auth',
    access: 'session',
    ok: 200,
  },
  'DELETE /api/v1/auth/sessions/{id}': {
    summary: 'Sign out one of my sessions',
    description: "Only the owner's own sessions; anything else is 404.",
    tag: 'Auth',
    access: 'session',
    ok: 204,
  },
  'POST /api/v1/auth/mfa/enroll': {
    optional: true,
    summary: 'Begin two-step verification setup',
    description:
      'Returns the TOTP secret and an otpauth URI exactly once. MFA is not active until confirmed. Only available when MFA_ENCRYPTION_KEY is configured.',
    tag: 'Auth',
    access: 'session',
    ok: 200,
  },
  'POST /api/v1/auth/mfa/enroll/confirm': {
    optional: true,
    summary: 'Confirm setup and receive recovery codes',
    description:
      'Returns 10 single-use recovery codes, shown only once. Only available when MFA_ENCRYPTION_KEY is configured.',
    tag: 'Auth',
    access: 'session',
    body: authBodies.codeOnlySchema,
    ok: 200,
  },
  'POST /api/v1/auth/mfa/recovery-codes': {
    description: 'Only available when MFA_ENCRYPTION_KEY is configured.',
    optional: true,
    summary: 'Regenerate recovery codes',
    tag: 'Auth',
    access: 'session',
    body: authBodies.codeOnlySchema,
    ok: 200,
  },
  'POST /api/v1/auth/mfa/disable': {
    optional: true,
    summary: 'Turn off two-step verification',
    description:
      'Needs the password (if any) and a valid code. Platform administrators cannot disable MFA (403). Only available when MFA_ENCRYPTION_KEY is configured.',
    tag: 'Auth',
    access: 'session',
    body: authBodies.disableMfaSchema,
    ok: 204,
  },

  // ---- Companies ------------------------------------------------------------------------------
  'GET /api/v1/tenants/mine': {
    summary: 'My companies',
    tag: 'Companies',
    access: 'session',
    ok: 200,
  },
  'POST /api/v1/tenants': {
    summary: 'Apply to register a company',
    description:
      'Creates a PENDING company with the caller as owner. Nothing operational is possible until a platform administrator approves it.',
    tag: 'Companies',
    access: 'session',
    body: tenant.applySchema,
    ok: 201,
  },
  'POST /api/v1/invitations/accept': {
    summary: 'Accept a company invitation',
    description: "The signed-in account's verified email must match the invited address.",
    tag: 'Companies',
    access: 'session',
    body: tenant.acceptSchema,
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/me': {
    summary: 'My role and permissions in this company',
    description:
      'For showing/hiding navigation only; every endpoint enforces permissions on the server.',
    tag: 'Companies',
    access: T,
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/profile': {
    summary: 'Company profile',
    description: 'A company that is still PENDING can read its own profile.',
    tag: 'Companies',
    access: T,
    ok: 200,
  },
  'PATCH /api/v1/tenants/{tenantId}/profile': {
    summary: 'Update company profile',
    description:
      'Whitelisted fields only; status and slug cannot be set (unknown keys are rejected).',
    tag: 'Companies',
    access: T,
    permission: 'tenant.profile.update',
    body: tenant.profileSchema,
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/audit': {
    summary: 'Company audit trail',
    tag: 'Companies',
    access: T,
    permission: 'audit.read',
    paged: true,
    ok: 200,
  },

  // ---- Team & roles ---------------------------------------------------------------------------
  'GET /api/v1/tenants/{tenantId}/memberships': {
    summary: 'List members',
    tag: 'Team and roles',
    access: T,
    permission: 'membership.read',
    paged: true,
    ok: 200,
  },
  'PATCH /api/v1/tenants/{tenantId}/memberships/{id}': {
    summary: "Change a member's role",
    description:
      'You can only grant permissions you hold; you cannot change your own role; only an owner may modify an owner; a company always keeps one owner.',
    tag: 'Team and roles',
    access: T,
    permission: 'membership.invite',
    body: tenant.changeRoleSchema,
    ok: 204,
  },
  'DELETE /api/v1/tenants/{tenantId}/memberships/{id}': {
    summary: 'Remove a member',
    description: "Takes effect on the member's next request.",
    tag: 'Team and roles',
    access: T,
    permission: 'membership.revoke',
    ok: 204,
  },
  'GET /api/v1/tenants/{tenantId}/invitations': {
    summary: 'List pending invitations',
    tag: 'Team and roles',
    access: T,
    permission: 'membership.read',
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/invitations': {
    summary: 'Invite someone',
    description:
      "Single-use, expiring (7 days). The role must not exceed the inviter's own permissions.",
    tag: 'Team and roles',
    access: T,
    permission: 'membership.invite',
    body: tenant.inviteSchema,
    ok: 201,
  },
  'DELETE /api/v1/tenants/{tenantId}/invitations/{id}': {
    summary: 'Cancel an invitation',
    tag: 'Team and roles',
    access: T,
    permission: 'membership.invite',
    ok: 204,
  },
  'GET /api/v1/tenants/{tenantId}/roles': {
    summary: 'List roles and the permission catalog',
    tag: 'Team and roles',
    access: T,
    permission: 'role.read',
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/roles': {
    summary: 'Create a custom role',
    tag: 'Team and roles',
    access: T,
    permission: 'role.manage',
    body: tenant.createRoleSchema,
    ok: 201,
  },
  'PUT /api/v1/tenants/{tenantId}/roles/{id}/permissions': {
    summary: "Replace a custom role's permissions",
    description:
      'System roles (owner) are immutable. You cannot grant permissions you lack or edit your own role.',
    tag: 'Team and roles',
    access: T,
    permission: 'role.manage',
    body: tenant.setPermissionsSchema,
    ok: 204,
  },
  'DELETE /api/v1/tenants/{tenantId}/roles/{id}': {
    summary: 'Delete a custom role',
    description: '409 while the role is assigned or referenced.',
    tag: 'Team and roles',
    access: T,
    permission: 'role.manage',
    ok: 204,
  },

  // ---- Platform administration ----------------------------------------------------------------
  'GET /api/v1/platform/tenants': {
    summary: 'List companies (platform)',
    description:
      'Requires a platform role and enrolled MFA; callers without any platform role get 404.',
    tag: 'Platform',
    access: 'platform',
    permission: 'SUPER_ADMIN | OPERATIONS | SUPPORT',
    paged: true,
    query: [
      {
        name: 'status',
        description: 'Filter by company status',
        enum: ['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'DEACTIVATED'],
      },
    ],
    ok: 200,
  },
  'POST /api/v1/platform/tenants/{id}/approve': {
    summary: 'Approve a pending company',
    tag: 'Platform',
    access: 'platform',
    permission: 'SUPER_ADMIN | OPERATIONS',
    body: platform.optionalReason,
    ok: 200,
  },
  'POST /api/v1/platform/tenants/{id}/reject': {
    summary: 'Reject a pending company',
    description: 'A reason is required and recorded in the audit log.',
    tag: 'Platform',
    access: 'platform',
    permission: 'SUPER_ADMIN | OPERATIONS',
    body: platform.reasonSchema,
    ok: 200,
  },
  'POST /api/v1/platform/tenants/{id}/suspend': {
    summary: 'Suspend an active company',
    description: 'A reason is required. The company is locked out immediately.',
    tag: 'Platform',
    access: 'platform',
    permission: 'SUPER_ADMIN | OPERATIONS',
    body: platform.reasonSchema,
    ok: 200,
  },
  'POST /api/v1/platform/tenants/{id}/reactivate': {
    summary: 'Reactivate a suspended company',
    tag: 'Platform',
    access: 'platform',
    permission: 'SUPER_ADMIN | OPERATIONS',
    body: platform.optionalReason,
    ok: 200,
  },
  'POST /api/v1/platform/tenants/{id}/deactivate': {
    summary: 'Deactivate a company',
    description: 'A reason is required.',
    tag: 'Platform',
    access: 'platform',
    permission: 'SUPER_ADMIN | OPERATIONS',
    body: platform.reasonSchema,
    ok: 200,
  },

  // ---- Catalog --------------------------------------------------------------------------------
  'GET /api/v1/tenants/{tenantId}/locations': {
    summary: 'List locations',
    tag: 'Catalog',
    access: T,
    permission: 'route.read',
    paged: true,
    query: [{ name: 'q', description: 'Name contains' }],
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/locations': {
    summary: 'Create a location',
    tag: 'Catalog',
    access: T,
    permission: 'route.manage',
    body: catalog.locationCreate,
    ok: 201,
  },
  'PATCH /api/v1/tenants/{tenantId}/locations/{id}': {
    summary: 'Update a location',
    tag: 'Catalog',
    access: T,
    permission: 'route.manage',
    body: catalog.locationPatch,
    ok: 200,
  },
  'DELETE /api/v1/tenants/{tenantId}/locations/{id}': {
    summary: 'Delete a location',
    description: '409 if a route uses it; deactivate instead.',
    tag: 'Catalog',
    access: T,
    permission: 'route.manage',
    ok: 204,
  },
  'GET /api/v1/tenants/{tenantId}/routes': {
    summary: 'List routes',
    tag: 'Catalog',
    access: T,
    permission: 'route.read',
    paged: true,
    query: [
      { name: 'status', description: 'Filter by status', enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] },
    ],
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/routes': {
    summary: 'Create a draft route',
    description:
      'Stops are intermediate, in order, with strictly increasing minutes-after-departure that all fall before the route ends.',
    tag: 'Catalog',
    access: T,
    permission: 'route.manage',
    body: catalog.routeCreate,
    ok: 201,
  },
  'GET /api/v1/tenants/{tenantId}/routes/{id}': {
    summary: 'Route with ordered stops',
    tag: 'Catalog',
    access: T,
    permission: 'route.read',
    ok: 200,
  },
  'PATCH /api/v1/tenants/{tenantId}/routes/{id}': {
    summary: 'Edit a draft route',
    description: 'Published routes are immutable (409): archive and replace.',
    tag: 'Catalog',
    access: T,
    permission: 'route.manage',
    body: catalog.routePatch,
    ok: 204,
  },
  'POST /api/v1/tenants/{tenantId}/routes/{id}/publish': {
    summary: 'Publish a draft route',
    tag: 'Catalog',
    access: T,
    permission: 'route.manage',
    ok: 204,
  },
  'POST /api/v1/tenants/{tenantId}/routes/{id}/archive': {
    summary: 'Archive a route',
    description: '409 while it has active schedules.',
    tag: 'Catalog',
    access: T,
    permission: 'route.manage',
    ok: 204,
  },
  'DELETE /api/v1/tenants/{tenantId}/routes/{id}': {
    summary: 'Delete a draft route',
    tag: 'Catalog',
    access: T,
    permission: 'route.manage',
    ok: 204,
  },
  'GET /api/v1/tenants/{tenantId}/schedules': {
    summary: 'List schedules',
    tag: 'Catalog',
    access: T,
    permission: 'route.read',
    paged: true,
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/schedules': {
    summary: 'Create a schedule',
    description:
      'Departure is a local wall-clock time in the company timezone; days of week is a bitmask (Mon=1 … Sun=64). Only published routes.',
    tag: 'Catalog',
    access: T,
    permission: 'route.manage',
    body: catalog.scheduleCreate,
    ok: 201,
  },
  'POST /api/v1/tenants/{tenantId}/schedules/{id}/pause': {
    summary: 'Pause a schedule',
    tag: 'Catalog',
    access: T,
    permission: 'route.manage',
    ok: 204,
  },
  'POST /api/v1/tenants/{tenantId}/schedules/{id}/resume': {
    summary: 'Resume a schedule',
    tag: 'Catalog',
    access: T,
    permission: 'route.manage',
    ok: 204,
  },
  'POST /api/v1/tenants/{tenantId}/schedules/{id}/generate': {
    summary: 'Generate trips for a date range',
    description:
      'Idempotent, at most 62 days, DST-correct. The default vehicle is attached only where free; clashing dates are created unassigned and returned in `unassignedVehicle`.',
    tag: 'Catalog',
    access: T,
    permission: 'trip.manage',
    body: catalog.generateBody,
    ok: 200,
  },

  // ---- Fleet ----------------------------------------------------------------------------------
  'GET /api/v1/tenants/{tenantId}/vehicles': {
    summary: 'List vehicles',
    tag: 'Fleet',
    access: T,
    permission: 'fleet.read',
    paged: true,
    query: [
      {
        name: 'status',
        description: 'Filter by status',
        enum: ['ACTIVE', 'MAINTENANCE', 'RETIRED'],
      },
      { name: 'q', description: 'Registration contains' },
    ],
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/vehicles': {
    summary: 'Add a vehicle',
    description: 'Registration is normalised to upper case and unique per company.',
    tag: 'Fleet',
    access: T,
    permission: 'fleet.manage',
    body: catalog.vehicleCreate,
    ok: 201,
  },
  'GET /api/v1/tenants/{tenantId}/vehicles/{id}': {
    summary: 'Vehicle detail',
    tag: 'Fleet',
    access: T,
    permission: 'fleet.read',
    ok: 200,
  },
  'PATCH /api/v1/tenants/{tenantId}/vehicles/{id}': {
    summary: 'Update a vehicle',
    description:
      'The odometer only moves forward; a vehicle cannot leave service while assigned to upcoming trips; retired vehicles cannot return to service.',
    tag: 'Fleet',
    access: T,
    permission: 'fleet.manage',
    body: catalog.vehiclePatch,
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/vehicles/{id}/documents': {
    summary: 'Vehicle documents',
    tag: 'Fleet',
    access: T,
    permission: 'fleet.read',
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/vehicle-documents': {
    summary: 'Record a vehicle document',
    tag: 'Fleet',
    access: T,
    permission: 'fleet.manage',
    body: crew.documentBody,
    ok: 201,
  },
  'DELETE /api/v1/tenants/{tenantId}/vehicle-documents/{id}': {
    summary: 'Remove a vehicle document',
    tag: 'Fleet',
    access: T,
    permission: 'fleet.manage',
    ok: 204,
  },
  'GET /api/v1/tenants/{tenantId}/fleet/alerts': {
    summary: 'Expiring documents, overdue maintenance and (HR only) licences',
    description:
      'Evaluated in the company timezone. Driver licence expiries are included only for callers with `hr.read`.',
    tag: 'Fleet',
    access: T,
    permission: 'fleet.read',
    query: [{ name: 'days', description: 'Look-ahead window, 1-365 (default 30)' }],
    ok: 200,
  },

  // ---- Maintenance ----------------------------------------------------------------------------
  'GET /api/v1/tenants/{tenantId}/maintenance': {
    summary: 'List maintenance jobs',
    tag: 'Maintenance',
    access: T,
    permission: 'fleet.read',
    paged: true,
    query: [
      { name: 'vehicleId', description: 'Filter by vehicle', format: 'uuid' },
      {
        name: 'status',
        description: 'Filter by status',
        enum: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
      },
    ],
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/maintenance': {
    summary: 'Schedule a maintenance job',
    tag: 'Maintenance',
    access: T,
    permission: 'fleet.manage',
    body: crew.maintenanceCreate,
    ok: 201,
  },
  'POST /api/v1/tenants/{tenantId}/maintenance/{id}/start': {
    summary: 'Start work',
    description:
      'Takes the vehicle out of service (409 if it has upcoming trips). Only one job per vehicle can be in progress.',
    tag: 'Maintenance',
    access: T,
    permission: 'fleet.manage',
    ok: 204,
  },
  'POST /api/v1/tenants/{tenantId}/maintenance/{id}/complete': {
    summary: 'Complete a job',
    description:
      'Optionally records odometer (cannot go backwards) and cost in minor units; returns the vehicle to service.',
    tag: 'Maintenance',
    access: T,
    permission: 'fleet.manage',
    body: crew.completeBody,
    ok: 204,
  },
  'POST /api/v1/tenants/{tenantId}/maintenance/{id}/cancel': {
    summary: 'Cancel a scheduled job',
    tag: 'Maintenance',
    access: T,
    permission: 'fleet.manage',
    ok: 204,
  },

  // ---- Trips ----------------------------------------------------------------------------------
  'GET /api/v1/tenants/{tenantId}/trips': {
    summary: 'List trips',
    tag: 'Trips',
    access: T,
    permission: 'trip.read',
    paged: true,
    query: [
      date('from', 'First service date'),
      date('to', 'Last service date'),
      { name: 'routeId', description: 'Filter by route', format: 'uuid' },
      { name: 'vehicleId', description: 'Filter by vehicle', format: 'uuid' },
      {
        name: 'status',
        description: 'Filter by status',
        enum: ['SCHEDULED', 'BOARDING', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED'],
      },
    ],
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/trips/{id}/vehicle': {
    summary: "Assign or clear a trip's vehicle",
    description:
      'In-service vehicles only. Overlapping assignments are rejected by the database (409), including under concurrent requests.',
    tag: 'Trips',
    access: T,
    permission: 'trip.manage',
    body: catalog.assignBody,
    ok: 204,
  },
  'POST /api/v1/tenants/{tenantId}/trips/{id}/status': {
    summary: "Advance a trip's status",
    description:
      'Legal transitions: SCHEDULED→BOARDING→IN_TRANSIT→COMPLETED; SCHEDULED/BOARDING→CANCELLED. Cancelling releases the crew.',
    tag: 'Trips',
    access: T,
    permission: 'trip.manage',
    body: catalog.statusBody,
    ok: 204,
  },
  'POST /api/v1/tenants/{tenantId}/trips/{id}/delay': {
    summary: 'Record a delay in minutes',
    tag: 'Trips',
    access: T,
    permission: 'trip.manage',
    body: catalog.delayBody,
    ok: 204,
  },

  'POST /api/v1/tenants/{tenantId}/trips/{id}/replace-vehicle': {
    summary: 'Replace the vehicle on an open trip (breakdown or swap)',
    description:
      'Records the reason on the trip timeline, can take the old vehicle out of service and queues a passenger notice. Overlaps and route compatibility are enforced.',
    tag: 'Trips',
    access: T,
    permission: 'trip.manage',
    body: catalog.replaceBody,
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/trips/{id}/events': {
    summary: "A trip's operational timeline",
    tag: 'Trips',
    access: T,
    permission: 'trip.read',
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/dispatch/board': {
    summary: "The dispatcher's board for one service date, with items needing attention",
    tag: 'Dispatch',
    access: T,
    permission: 'trip.read',
    query: [date('date', 'Service date (YYYY-MM-DD)')],
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/calendar/blackouts': {
    summary: 'List service blackouts',
    tag: 'Dispatch',
    access: T,
    permission: 'route.read',
    query: [date('from', 'Range start'), date('to', 'Range end')],
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/calendar/blackouts': {
    summary: 'Add a service blackout (company-wide or for one route)',
    description:
      'Reports how many open trips fall inside the range; none are cancelled automatically.',
    tag: 'Dispatch',
    access: T,
    permission: 'route.manage',
    body: dispatch.blackoutCreate,
    ok: 201,
  },
  'DELETE /api/v1/tenants/{tenantId}/calendar/blackouts/{id}': {
    summary: 'Remove a service blackout',
    tag: 'Dispatch',
    access: T,
    permission: 'route.manage',
    ok: 204,
  },
  'GET /api/v1/tenants/{tenantId}/seat-layouts': {
    summary: 'List seat layouts',
    tag: 'Fleet',
    access: T,
    permission: 'fleet.read',
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/seat-layouts': {
    summary: 'Create a seat layout (rows x columns grid)',
    tag: 'Fleet',
    access: T,
    permission: 'fleet.manage',
    body: dispatch.seatLayoutCreate,
    ok: 201,
  },
  'GET /api/v1/tenants/{tenantId}/seat-layouts/{id}': {
    summary: 'Get a seat layout with its seats',
    tag: 'Fleet',
    access: T,
    permission: 'fleet.read',
    ok: 200,
  },
  'DELETE /api/v1/tenants/{tenantId}/seat-layouts/{id}': {
    summary: 'Delete an unused seat layout',
    tag: 'Fleet',
    access: T,
    permission: 'fleet.manage',
    ok: 204,
  },

  // ---- Bookings -------------------------------------------------------------------------------
  'GET /api/v1/tenants/{tenantId}/routes/{id}/fares': {
    summary: 'List fares for a route',
    tag: 'Bookings',
    access: T,
    permission: 'route.read',
    ok: 200,
  },
  'PUT /api/v1/tenants/{tenantId}/routes/{id}/fares/{serviceClass}': {
    summary: 'Set the fare for a route and service class',
    description:
      'Amounts are integer minor units. Existing bookings keep the price they were sold at.',
    tag: 'Bookings',
    access: T,
    permission: 'route.manage',
    body: booking.fareBody,
    ok: 204,
  },
  'GET /api/v1/tenants/{tenantId}/trips/{id}/seats': {
    summary: 'Seat map and availability for a trip',
    tag: 'Bookings',
    access: T,
    permission: 'booking.read',
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/bookings': {
    summary: 'Create a booking and hold its seats',
    description:
      'Seats are held for 15 minutes pending payment. Send an Idempotency-Key header (8-100 chars) so a retry returns the original booking (200) instead of creating another. A seat taken by someone else returns 409.',
    tag: 'Bookings',
    access: T,
    permission: 'booking.manage',
    body: booking.bookingCreate,
    ok: 201,
  },
  'GET /api/v1/tenants/{tenantId}/bookings': {
    summary: 'List bookings',
    tag: 'Bookings',
    access: T,
    permission: 'booking.read',
    paged: true,
    query: [
      {
        name: 'status',
        description: 'Filter by status',
        enum: ['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED'],
      },
      { name: 'tripId', description: 'Filter by trip', format: 'uuid' },
      { name: 'q', description: 'Booking reference or phone number' },
    ],
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/bookings/{id}': {
    summary: 'Get a booking with its status history',
    tag: 'Bookings',
    access: T,
    permission: 'booking.read',
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/bookings/{id}/cancel': {
    summary: 'Cancel a booking and release its seats',
    description: 'Reports whether a refund is required; refunds are handled by payments.',
    tag: 'Bookings',
    access: T,
    permission: 'booking.manage',
    body: booking.cancelBody,
    ok: 200,
  },

  // ---- Crew and HR ----------------------------------------------------------------------------
  'GET /api/v1/tenants/{tenantId}/employees': {
    summary: 'List employees (HR)',
    tag: 'Crew and HR',
    access: T,
    permission: 'hr.read',
    paged: true,
    query: [
      {
        name: 'role',
        description: 'Filter by job role',
        enum: ['DRIVER', 'CONDUCTOR', 'DISPATCHER', 'MECHANIC', 'OTHER'],
      },
      {
        name: 'status',
        description: 'Filter by status',
        enum: ['ACTIVE', 'ON_LEAVE', 'TERMINATED'],
      },
      { name: 'q', description: 'Name contains' },
    ],
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/employees': {
    summary: 'Add an employee',
    tag: 'Crew and HR',
    access: T,
    permission: 'hr.manage',
    body: crew.employeeCreate,
    ok: 201,
  },
  'PATCH /api/v1/tenants/{tenantId}/employees/{id}': {
    summary: 'Update an employee',
    description:
      'Termination or leave is refused (409) while the person has upcoming crew duty; terminated employees cannot be reinstated.',
    tag: 'Crew and HR',
    access: T,
    permission: 'hr.manage',
    body: crew.employeePatch,
    ok: 204,
  },
  'GET /api/v1/tenants/{tenantId}/employees/{id}/licences': {
    summary: 'Driver licences',
    tag: 'Crew and HR',
    access: T,
    permission: 'hr.read',
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/employees/{id}/licences': {
    summary: 'Record a driver licence',
    description: 'Drivers only; licence numbers are unique per company (case-insensitive).',
    tag: 'Crew and HR',
    access: T,
    permission: 'hr.manage',
    body: crew.licenceBody,
    ok: 201,
  },
  'GET /api/v1/tenants/{tenantId}/crew/roster': {
    summary: 'Dispatcher roster',
    description:
      'Active drivers and conductors only, with no phone, HR dates or staff numbers, so dispatchers can assign crew without HR access.',
    tag: 'Crew and HR',
    access: T,
    permission: 'trip.read',
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/trips/{id}/crew': {
    summary: 'Crew on a trip',
    tag: 'Crew and HR',
    access: T,
    permission: 'trip.read',
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/trips/{id}/crew': {
    summary: 'Assign crew to a trip',
    description:
      "Rules: open trip; active employee whose job matches the position; drivers need a licence valid on the service date; no overlapping duty; at least the company's minimum rest between trips. Overlap is also enforced by the database under concurrency.",
    tag: 'Crew and HR',
    access: T,
    permission: 'trip.manage',
    body: crew.crewBody,
    ok: 204,
  },
  'DELETE /api/v1/tenants/{tenantId}/trips/{id}/crew/{employeeId}': {
    summary: 'Remove crew from a trip',
    tag: 'Crew and HR',
    access: T,
    permission: 'trip.manage',
    ok: 204,
  },
};
