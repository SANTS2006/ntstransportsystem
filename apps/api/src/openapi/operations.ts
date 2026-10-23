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
import { requestSchemas as recruit } from '../modules/recruitment/recruitment.routes.js';
import { requestSchemas as complaint } from '../modules/complaint/complaint.routes.js';
import { requestSchemas as maintenance } from '../modules/platform-settings/maintenance.js';
import { requestSchemas as ticket } from '../modules/ticket/ticket.routes.js';
import { requestSchemas as passenger } from '../modules/passenger/passenger.routes.js';
import { requestSchemas as payment } from '../modules/payment/payment.routes.js';
import { requestSchemas as dispatch } from '../modules/catalog/dispatch.routes.js';
import { requestSchemas as crew } from '../modules/crew/crew.routes.js';
import { requestSchemas as platform } from '../modules/tenants/platform.routes.js';
import { requestSchemas as branding } from '../modules/branding/branding.routes.js';
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
  'POST /api/v1/auth/register-phone': {
    optional: true,
    summary: 'Register with a phone number',
    description:
      'Available when text messages can be sent. Any usual way of writing the number is accepted and stored in international form. Always answers 202 with the same message whether or not the number is registered. Texts a 6-digit code that expires after 10 minutes; at most 5 texts per number per hour and 5 tries per code. A number that was never verified is taken over by the newest sign-up.',
    tag: 'Auth',
    access: 'public',
    body: authBodies.registerPhoneSchema,
    ok: 202,
  },
  'POST /api/v1/auth/verify-phone': {
    optional: true,
    summary: 'Confirm a phone number with the code from the text',
    description:
      'Single use, five tries. Afterwards the person signs in with the number and password.',
    tag: 'Auth',
    access: 'public',
    body: authBodies.phoneCodeSchema,
    ok: 200,
  },
  'POST /api/v1/auth/resend-phone-code': {
    optional: true,
    summary: 'Send another code to a number waiting to be verified',
    description: 'Always answers 202 with the same message. Limited per number and per address.',
    tag: 'Auth',
    access: 'public',
    body: authBodies.phoneOnlySchema,
    ok: 202,
  },
  'POST /api/v1/auth/forgot-password-phone': {
    optional: true,
    summary: 'Text a password-reset code',
    description:
      'Always answers 202 with the same message, whether or not the number has an account.',
    tag: 'Auth',
    access: 'public',
    body: authBodies.phoneOnlySchema,
    ok: 202,
  },
  'POST /api/v1/auth/reset-password-phone': {
    optional: true,
    summary: 'Set a new password with the code from the text',
    description: 'Revokes every session of the account.',
    tag: 'Auth',
    access: 'public',
    body: authBodies.resetPhoneSchema,
    ok: 200,
  },
  'POST /api/v1/auth/verify-email': {
    summary: 'Confirm an email address',
    description: 'Consumes a single-use, expiring token from the verification email.',
    tag: 'Auth',
    access: 'public',
    body: tokenSchema,
    ok: 200,
  },
  'PATCH /api/v1/auth/me': {
    summary: 'Change my name',
    tag: 'Auth',
    access: 'session',
    body: authBodies.profileSchema,
    ok: 204,
  },
  'PUT /api/v1/auth/me/avatar': {
    summary: 'Upload my profile picture',
    description:
      'The body is the picture itself (image/png, image/jpeg or image/webp, at most 400 KB). The type is checked from the bytes.',
    tag: 'Auth',
    access: 'session',
    ok: 204,
  },
  'GET /api/v1/auth/me/avatar': {
    summary: 'My profile picture',
    tag: 'Auth',
    access: 'session',
    ok: 200,
  },
  'DELETE /api/v1/auth/me/avatar': {
    summary: 'Remove my profile picture',
    tag: 'Auth',
    access: 'session',
    ok: 204,
  },
  'POST /api/v1/auth/verify-email-code': {
    summary: 'Confirm an email address with a code',
    description:
      'The 6-character code mailed at sign-up. It expires in 10 minutes and allows 5 attempts.',
    tag: 'Auth',
    access: 'public',
    body: authBodies.emailCodeSchema,
    ok: 200,
  },
  'POST /api/v1/auth/resend-email-code': {
    summary: 'Mail a new confirmation code',
    description: 'Answers the same whether or not the address is waiting to be confirmed.',
    tag: 'Auth',
    access: 'public',
    body: authBodies.emailOnlySchema,
    ok: 202,
  },
  'POST /api/v1/auth/login': {
    summary: 'Sign in with email or phone number and password',
    description:
      'On success sets the HttpOnly `sid` session cookie and a readable `csrf` cookie. If the account has two-step verification the response is `{ mfaRequired: true, challengeToken }` and no session is created yet. Send either `email` or `phone`. An account whose phone number or email is not confirmed yet gets 403 `PHONE_NOT_VERIFIED` or `EMAIL_NOT_VERIFIED`. Failures never reveal whether the account exists; repeated failures lock the account progressively.',
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
  'GET /api/v1/public/companies/{slug}': {
    summary: "A company's name, colours and logo address",
    description: "For the company's own sign-in and sign-up pages. 404 unless the company is live.",
    tag: 'Companies',
    access: 'public',
    ok: 200,
  },
  'GET /api/v1/public/companies/{slug}/logo': {
    summary: "A company's logo",
    description: 'The picture itself (PNG, JPEG or WebP).',
    tag: 'Companies',
    access: 'public',
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/branding': {
    summary: "The company's colours and logo",
    tag: 'Companies',
    access: T,
    ok: 200,
  },
  'PATCH /api/v1/tenants/{tenantId}/branding': {
    summary: "Set the company's two colours",
    tag: 'Companies',
    access: T,
    permission: 'tenant.profile.update',
    body: branding.colorsSchema,
    ok: 200,
  },
  'PUT /api/v1/tenants/{tenantId}/branding/logo': {
    summary: "Upload the company's logo",
    description:
      'The body is the picture itself (Content-Type image/png, image/jpeg or image/webp, at most 600 KB). The type is checked from the bytes; SVG is refused.',
    tag: 'Companies',
    access: T,
    permission: 'tenant.profile.update',
    ok: 204,
  },
  'DELETE /api/v1/tenants/{tenantId}/branding/logo': {
    summary: "Remove the company's logo",
    tag: 'Companies',
    access: T,
    permission: 'tenant.profile.update',
    ok: 204,
  },
  'PUT /api/v1/platform/tenants/{id}/logo': {
    summary: "Upload a company's logo (platform)",
    description: "Same body rules as the company's own upload.",
    tag: 'Platform',
    access: 'platform',
    permission: 'SUPER_ADMIN | OPERATIONS',
    ok: 204,
  },
  'GET /api/v1/tenants/mine': {
    summary: 'My companies',
    tag: 'Companies',
    access: 'session',
    ok: 200,
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
  'POST /api/v1/platform/tenants': {
    summary: 'Register a company (platform)',
    description:
      'Only platform staff can register a company; users cannot register one for themselves. The company is ACTIVE at once and the given email is invited as its first owner.',
    tag: 'Platform',
    access: 'platform',
    permission: 'SUPER_ADMIN | OPERATIONS',
    body: platform.registerSchema,
    ok: 201,
  },
  'GET /api/v1/platform/audit': {
    summary: 'Platform audit log',
    description:
      'Every audited event across all companies, newest first. Platform role and enrolled MFA required.',
    tag: 'Platform',
    access: 'platform',
    permission: 'SUPER_ADMIN | SECURITY_AUDIT',
    paged: true,
    query: [
      { name: 'action', description: 'Action name contains this text' },
      { name: 'outcome', description: 'Outcome', enum: ['SUCCESS', 'FAILURE', 'DENIED'] },
      { name: 'tenantId', description: 'Only this company' },
      { name: 'actorUserId', description: 'Only this person' },
      { name: 'from', description: 'First day, YYYY-MM-DD (UTC)' },
      { name: 'to', description: 'Last day, YYYY-MM-DD (UTC)' },
    ],
    ok: 200,
  },
  'GET /api/v1/platform/overview': {
    summary: 'Platform-wide figures',
    description:
      'Companies by status, users, confirmed sales per currency and the ten biggest companies in the date range (default: the last 30 days, UTC days), plus open complaints and the notification backlog.',
    tag: 'Platform',
    access: 'platform',
    permission: 'SUPER_ADMIN | OPERATIONS | SUPPORT',
    query: [
      { name: 'from', description: 'First day, YYYY-MM-DD (UTC)' },
      { name: 'to', description: 'Last day, YYYY-MM-DD (UTC)' },
    ],
    ok: 200,
  },
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
  'GET /api/v1/tenants/{tenantId}/routes/{id}/stop-fares': {
    summary: 'The stops of a route and the price between each pair',
    tag: 'Bookings',
    access: T,
    permission: 'route.read',
    ok: 200,
  },
  'PUT /api/v1/tenants/{tenantId}/routes/{id}/stop-fares': {
    summary: 'Replace the prices set by stop for a route',
    description:
      'Each price is from an earlier stop to a later one (origin, stops and destination count). A booking that names its boarding and alighting stops pays this price; otherwise the route fare applies. Existing bookings keep their price.',
    tag: 'Bookings',
    access: T,
    permission: 'route.manage',
    body: booking.stopFaresBody,
    ok: 204,
  },
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
  'POST /api/v1/tenants/{tenantId}/bookings/{id}/desk-payment': {
    summary: 'Take payment at the desk and confirm the booking',
    description:
      'For cash, mobile money shown at the counter, or bank transfer. The amount is always the booking total. Records the method, an optional receipt reference and who took it, closes any open online checkout for the booking, issues the tickets and is audited. A booking can be paid at the desk once.',
    tag: 'Bookings',
    access: T,
    permission: 'payment.collect',
    body: booking.deskPaymentBody,
    ok: 201,
  },
  'POST /api/v1/tenants/{tenantId}/bookings/{id}/desk-refund': {
    summary: 'Record that a cancelled desk-paid booking was refunded',
    description:
      'The whole amount, once, only for a cancelled booking that was paid at the desk. It records what staff handed back (it does not move money) and needs payment.manage.',
    tag: 'Bookings',
    access: T,
    permission: 'payment.manage',
    body: booking.deskRefundBody,
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

  // ---- Payments -------------------------------------------------------------------------------
  'GET /api/v1/tenants/{tenantId}/payment-settings': {
    optional: true,
    summary: "Show the company's payment setup (never the secrets)",
    tag: 'Payments',
    access: T,
    permission: 'payment.manage',
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/payment-settings/qmoney': {
    optional: true,
    summary: "The company's own QMoney number",
    tag: 'Payments',
    access: T,
    permission: 'payment.read',
    ok: 200,
  },
  'PUT /api/v1/tenants/{tenantId}/payment-settings/qmoney': {
    optional: true,
    summary: "Set or clear the company's QMoney number",
    description:
      'Passengers are shown this number to pay and then send the transaction number. Send number: null to stop offering QMoney.',
    tag: 'Payments',
    access: T,
    permission: 'payment.manage',
    body: payment.qmoneyBody,
    ok: 200,
  },
  'PUT /api/v1/tenants/{tenantId}/payment-settings': {
    optional: true,
    summary: 'Save Monime credentials for the company',
    description:
      'Secrets are encrypted at rest and never returned. On first setup, if no webhook secret is given one is generated and returned once; register it with the webhook URL in the Monime dashboard.',
    tag: 'Payments',
    access: T,
    permission: 'payment.manage',
    body: payment.settingsBody,
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/bookings/{id}/payments': {
    optional: true,
    summary: 'Start a hosted-checkout payment for a booking',
    description:
      'The amount is the price snapshot taken when the booking was made. Returns the Monime checkout URL to send the customer to. Calling it again while a payment is open returns the same checkout.',
    tag: 'Payments',
    access: T,
    permission: 'booking.manage',
    ok: 201,
  },
  'GET /api/v1/tenants/{tenantId}/bookings/{id}/payments': {
    optional: true,
    summary: "List a booking's payment attempts",
    tag: 'Payments',
    access: T,
    permission: 'booking.read',
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/payments/{id}/refresh': {
    optional: true,
    summary: 'Re-check a payment with the provider (covers a missed webhook)',
    tag: 'Payments',
    access: T,
    permission: 'booking.manage',
    ok: 200,
  },
  'POST /api/v1/webhooks/monime/{tenantId}': {
    optional: true,
    summary: 'Monime webhook receiver',
    description:
      'Called by Monime. Authenticated only by the Monime-Signature header (HMAC-SHA256 over timestamp and raw body). A verified completed event is re-checked with Monime before any booking is confirmed.',
    tag: 'Payments',
    access: 'public',
    ok: 200,
  },

  // ---- Passengers -----------------------------------------------------------------------------
  'GET /api/v1/public/trips': {
    optional: true,
    summary: 'Search trips that can be booked online',
    description:
      'Public. Only trips of active companies with online payment enabled, a published route, a vehicle and a fare are returned. "from" and "to" match city names.',
    tag: 'Passengers',
    access: 'public',
    query: [
      { name: 'date', description: 'Service date (company local date)', format: 'date' },
      { name: 'from', description: 'Origin city (partial match)' },
      { name: 'to', description: 'Destination city (partial match)' },
    ],
    ok: 200,
  },
  'GET /api/v1/public/trips/{tenantId}/{tripId}': {
    optional: true,
    summary: 'Seat availability for one bookable trip',
    tag: 'Passengers',
    access: 'public',
    ok: 200,
  },
  'GET /api/v1/me/notifications': {
    summary: "List the caller's in-app notifications",
    description: 'Newest first, at most 30, with the unread total. Add ?unread=1 for unread only.',
    tag: 'Notifications',
    access: 'session',
    ok: 200,
  },
  'GET /api/v1/me/notifications/unread-count': {
    summary: 'Number of unread in-app notifications',
    tag: 'Notifications',
    access: 'session',
    ok: 200,
  },
  'POST /api/v1/me/notifications/read-all': {
    summary: 'Mark all notifications as read',
    tag: 'Notifications',
    access: 'session',
    ok: 200,
  },
  'POST /api/v1/me/notifications/{id}/read': {
    summary: 'Mark one notification as read',
    tag: 'Notifications',
    access: 'session',
    ok: 204,
  },
  'POST /api/v1/passenger/bookings': {
    optional: true,
    summary: 'Book seats as a signed-in passenger',
    description:
      'Holds the seats for 15 minutes. Send an Idempotency-Key header so a retry returns the same booking. At most 3 unpaid bookings per passenger.',
    tag: 'Passengers',
    access: 'session',
    body: passenger.bookingCreate,
    ok: 201,
  },
  'GET /api/v1/passenger/bookings': {
    optional: true,
    summary: "List the caller's own bookings",
    tag: 'Passengers',
    access: 'session',
    ok: 200,
  },
  'GET /api/v1/passenger/bookings/{id}': {
    optional: true,
    summary: "Get one of the caller's bookings",
    tag: 'Passengers',
    access: 'session',
    ok: 200,
  },
  'GET /api/v1/passenger/bookings/{id}/status': {
    optional: true,
    summary: 'Booking status after returning from payment',
    description:
      'Re-checks an open payment with the provider before answering; the redirect back from checkout is never taken as proof of payment.',
    tag: 'Passengers',
    access: 'session',
    ok: 200,
  },
  'GET /api/v1/passenger/bookings/{id}/payment-options': {
    optional: true,
    summary: 'The ways this booking can be paid',
    description:
      "Orange Money, AfriMoney and QMoney through Monime when Monime lists them for the company; one generic online choice otherwise; and QMoney paid to the company's own number (kind MANUAL) when the company has set one and Monime does not offer QMoney. Empty once the booking is no longer waiting for payment.",
    tag: 'Passengers',
    access: 'session',
    ok: 200,
  },
  'POST /api/v1/passenger/bookings/{id}/pay': {
    optional: true,
    summary: 'Start online payment for an unpaid booking',
    description:
      'Optionally name the wallet (ORANGE_MONEY, AFRIMONEY, QMONEY, or ONLINE for whatever the hosted page offers). A wallet is only accepted if Monime lists it for the company; the hosted page then offers just that wallet.',
    tag: 'Passengers',
    access: 'session',
    body: passenger.payBody,
    ok: 201,
  },
  'POST /api/v1/passenger/bookings/{id}/manual-payment': {
    optional: true,
    summary: 'Say a booking was paid by QMoney, with the transaction number',
    description:
      'Confirms nothing. Staff see the number, check their QMoney statement and confirm with "take payment". Holds the seats for two hours, at most three notices per booking, and a transaction number can be used once.',
    tag: 'Passengers',
    access: 'session',
    body: passenger.manualPaymentBody,
    ok: 201,
  },
  'POST /api/v1/passenger/bookings/{id}/cancel': {
    optional: true,
    summary: 'Cancel an unpaid booking',
    tag: 'Passengers',
    access: 'session',
    ok: 204,
  },

  // ---- Tickets and boarding -------------------------------------------------------------------
  'GET /api/v1/tenants/{tenantId}/bookings/{id}/tickets': {
    optional: true,
    summary: 'Tickets of a confirmed booking, with their signed QR tokens',
    tag: 'Tickets',
    access: T,
    permission: 'booking.read',
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/bookings/{id}/tickets.pdf': {
    optional: true,
    summary: 'Ticket PDF (one page per seat, with QR code)',
    description: 'application/pdf download. Only for confirmed bookings.',
    tag: 'Tickets',
    access: T,
    permission: 'booking.read',
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/bookings/{id}/receipt.pdf': {
    optional: true,
    summary: 'Payment receipt PDF',
    description: 'application/pdf download. Only for confirmed bookings.',
    tag: 'Tickets',
    access: T,
    permission: 'booking.read',
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/tickets/scan': {
    optional: true,
    summary: 'Validate a ticket and board the passenger',
    description:
      'Send the QR token (or a typed ticket code) and optionally the trip being boarded. The signature is checked first; a ticket boards exactly once. Refusals return 409 with details.reason (INVALID_CODE, NOT_FOUND, VOID, BOOKING_NOT_CONFIRMED, TRIP_NOT_RUNNING, WRONG_TRIP, TOO_EARLY, TRIP_ENDED, ALREADY_BOARDED); every outcome is audited.',
    tag: 'Tickets',
    access: T,
    permission: 'ticket.validate',
    body: ticket.scanBody,
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/trips/{id}/manifest': {
    optional: true,
    summary: 'Passenger manifest for a trip with boarding status',
    tag: 'Tickets',
    access: T,
    permission: 'ticket.validate',
    ok: 200,
  },
  'GET /api/v1/passenger/bookings/{id}/tickets': {
    optional: true,
    summary: "Tickets (with QR tokens) of the caller's confirmed booking",
    tag: 'Passengers',
    access: 'session',
    ok: 200,
  },
  'GET /api/v1/passenger/bookings/{id}/tickets.pdf': {
    optional: true,
    summary: 'Download ticket PDF for own booking',
    tag: 'Passengers',
    access: 'session',
    ok: 200,
  },
  'GET /api/v1/passenger/bookings/{id}/receipt.pdf': {
    optional: true,
    summary: 'Download payment receipt for own booking',
    tag: 'Passengers',
    access: 'session',
    ok: 200,
  },

  // ---- Platform: maintenance mode -------------------------------------------------------------
  'GET /api/v1/maintenance-status': {
    summary: 'Is the platform in maintenance mode? (public)',
    description:
      'While maintenance is on, every other endpoint except auth, platform admin and payment webhooks answers 503 with code MAINTENANCE and a Retry-After header.',
    tag: 'System',
    access: 'public',
    ok: 200,
  },
  'GET /api/v1/platform/maintenance': {
    summary: 'Maintenance state (platform staff)',
    tag: 'Platform',
    access: 'platform',
    permission: 'SUPER_ADMIN | OPERATIONS | SUPPORT',
    ok: 200,
  },
  'PUT /api/v1/platform/maintenance': {
    summary: 'Turn maintenance mode on or off',
    description: 'A message is required to turn it on. Audited.',
    tag: 'Platform',
    access: 'platform',
    permission: 'SUPER_ADMIN | OPERATIONS',
    body: maintenance.setBody,
    ok: 200,
  },

  // ---- Complaints and ratings -----------------------------------------------------------------
  'GET /api/v1/tenants/{tenantId}/complaints': {
    optional: true,
    summary: 'List complaints',
    tag: 'Complaints',
    access: T,
    permission: 'support.manage',
    paged: true,
    query: [
      {
        name: 'status',
        description: 'Filter by status',
        enum: ['OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED'],
      },
    ],
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/complaints/{id}': {
    optional: true,
    summary: 'A complaint with its conversation',
    tag: 'Complaints',
    access: T,
    permission: 'support.manage',
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/complaints/{id}/messages': {
    optional: true,
    summary: 'Reply to a complaint',
    description:
      'Moves an OPEN complaint to IN_REVIEW and emails the customer that a reply is waiting (the text is not emailed).',
    tag: 'Complaints',
    access: T,
    permission: 'support.manage',
    body: complaint.messageBody,
    ok: 201,
  },
  'POST /api/v1/tenants/{tenantId}/complaints/{id}/status': {
    optional: true,
    summary: 'Change a complaint status',
    description:
      'IN_REVIEW, RESOLVED or CLOSED. A customer reply reopens a RESOLVED complaint; CLOSED is final.',
    tag: 'Complaints',
    access: T,
    permission: 'support.manage',
    body: complaint.statusBody,
    ok: 204,
  },
  'GET /api/v1/tenants/{tenantId}/ratings/summary': {
    optional: true,
    summary: 'Trip rating average, distribution and per-route averages',
    tag: 'Complaints',
    access: T,
    permission: 'booking.read',
    ok: 200,
  },
  'POST /api/v1/passenger/complaints': {
    optional: true,
    summary: 'Report a problem with a paid booking',
    description: 'At most 5 open complaints per passenger.',
    tag: 'Passengers',
    access: 'session',
    body: complaint.createBody,
    ok: 201,
  },
  'GET /api/v1/passenger/complaints': {
    optional: true,
    summary: "The caller's own complaints",
    tag: 'Passengers',
    access: 'session',
    ok: 200,
  },
  'GET /api/v1/passenger/complaints/{id}': {
    optional: true,
    summary: "One of the caller's complaints with its conversation",
    tag: 'Passengers',
    access: 'session',
    ok: 200,
  },
  'POST /api/v1/passenger/complaints/{id}/messages': {
    optional: true,
    summary: 'Add a message to own complaint (reopens a resolved one)',
    tag: 'Passengers',
    access: 'session',
    body: complaint.messageBody,
    ok: 201,
  },
  'GET /api/v1/passenger/bookings/{id}/rating': {
    optional: true,
    summary: 'The rating given for an own booking, if any',
    tag: 'Passengers',
    access: 'session',
    ok: 200,
  },
  'POST /api/v1/passenger/bookings/{id}/rating': {
    optional: true,
    summary: 'Rate a completed trip (once per booking)',
    tag: 'Passengers',
    access: 'session',
    body: complaint.ratingBody,
    ok: 201,
  },

  // ---- Reports --------------------------------------------------------------------------------
  'GET /api/v1/tenants/{tenantId}/reports/summary': {
    optional: true,
    summary: 'Headline figures for a period',
    tag: 'Reports',
    access: T,
    permission: 'finance.report.read',
    query: [
      { name: 'from', description: 'First day (company local date)', format: 'date' },
      { name: 'to', description: 'Last day, inclusive (at most 366 days)', format: 'date' },
    ],
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/reports/sales': {
    optional: true,
    summary: 'Sales by day or by route',
    description:
      'Counted on the day a booking was confirmed (paid), in the company time zone. Also reports bookings cancelled after payment and payments received for seats that had been released.',
    tag: 'Reports',
    access: T,
    permission: 'finance.report.read',
    query: [
      { name: 'from', description: 'First day (company local date)', format: 'date' },
      { name: 'to', description: 'Last day, inclusive (at most 366 days)', format: 'date' },
      { name: 'by', description: 'Grouping', enum: ['day', 'route'] },
    ],
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/reports/sales.csv': {
    optional: true,
    summary: 'Sales report as CSV',
    description:
      'text/csv download. Text cells that could be read as spreadsheet formulas are neutralised.',
    tag: 'Reports',
    access: T,
    permission: 'finance.report.read',
    query: [
      { name: 'from', description: 'First day (company local date)', format: 'date' },
      { name: 'to', description: 'Last day, inclusive (at most 366 days)', format: 'date' },
      { name: 'by', description: 'Grouping', enum: ['day', 'route'] },
    ],
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/reports/occupancy': {
    optional: true,
    summary: 'Seats sold, boarded and occupancy per trip',
    description: 'Up to 500 trips; "truncated" is true when more exist.',
    tag: 'Reports',
    access: T,
    permission: 'finance.report.read',
    query: [
      { name: 'from', description: 'First day (company local date)', format: 'date' },
      { name: 'to', description: 'Last day, inclusive (at most 366 days)', format: 'date' },
    ],
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/reports/occupancy.csv': {
    optional: true,
    summary: 'Occupancy report as CSV',
    tag: 'Reports',
    access: T,
    permission: 'finance.report.read',
    query: [
      { name: 'from', description: 'First day (company local date)', format: 'date' },
      { name: 'to', description: 'Last day, inclusive (at most 366 days)', format: 'date' },
    ],
    ok: 200,
  },

  'GET /api/v1/tenants/{tenantId}/reports/cashup': {
    optional: true,
    summary: 'Desk cash-up by clerk and method, with refunds',
    tag: 'Reports',
    access: T,
    permission: 'finance.report.read',
    query: [
      { name: 'from', description: 'First day (company local date)', format: 'date' },
      { name: 'to', description: 'Last day, inclusive (at most 366 days)', format: 'date' },
    ],
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/reports/cashup.csv': {
    optional: true,
    summary: 'Desk cash-up as CSV',
    tag: 'Reports',
    access: T,
    permission: 'finance.report.read',
    query: [
      { name: 'from', description: 'First day (company local date)', format: 'date' },
      { name: 'to', description: 'Last day, inclusive (at most 366 days)', format: 'date' },
    ],
    ok: 200,
  },

  // ---- Recruitment ----------------------------------------------------------------------------
  'GET /api/v1/tenants/{tenantId}/jobs': {
    summary: 'List job postings',
    tag: 'Recruitment',
    access: T,
    permission: 'recruitment.manage',
    optional: true,
    paged: true,
    query: [{ name: 'status', description: 'Filter by status', enum: ['DRAFT', 'OPEN', 'CLOSED'] }],
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/jobs': {
    summary: 'Create a job posting (draft)',
    tag: 'Recruitment',
    access: T,
    permission: 'recruitment.manage',
    optional: true,
    body: recruit.jobCreate,
    ok: 201,
  },
  'GET /api/v1/tenants/{tenantId}/jobs/{id}': {
    summary: 'Get a job posting',
    tag: 'Recruitment',
    access: T,
    permission: 'recruitment.manage',
    optional: true,
    ok: 200,
  },
  'PATCH /api/v1/tenants/{tenantId}/jobs/{id}': {
    summary: 'Edit a draft or open job posting',
    tag: 'Recruitment',
    access: T,
    permission: 'recruitment.manage',
    optional: true,
    body: recruit.jobPatch,
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/jobs/{id}/open': {
    summary: 'Publish a job posting',
    tag: 'Recruitment',
    access: T,
    permission: 'recruitment.manage',
    optional: true,
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/jobs/{id}/close': {
    summary: 'Close a job posting',
    tag: 'Recruitment',
    access: T,
    permission: 'recruitment.manage',
    optional: true,
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/applications': {
    summary: 'List applications',
    tag: 'Recruitment',
    access: T,
    permission: 'recruitment.manage',
    optional: true,
    paged: true,
    query: [
      { name: 'jobId', description: 'Filter by posting', format: 'uuid' },
      {
        name: 'status',
        description: 'Filter by status',
        enum: [
          'SUBMITTED',
          'SHORTLISTED',
          'INTERVIEW',
          'OFFERED',
          'HIRED',
          'REJECTED',
          'WITHDRAWN',
        ],
      },
    ],
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/applications/{id}': {
    summary: 'An application with its history',
    tag: 'Recruitment',
    access: T,
    permission: 'recruitment.manage',
    optional: true,
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/applications/{id}/status': {
    summary: 'Move an application to the next stage',
    tag: 'Recruitment',
    access: T,
    permission: 'recruitment.manage',
    optional: true,
    description:
      'SUBMITTED to SHORTLISTED or REJECTED, SHORTLISTED to INTERVIEW or REJECTED, INTERVIEW to OFFERED or REJECTED, OFFERED to REJECTED. HIRED only through the hire action. The applicant is emailed.',
    body: recruit.statusBody,
    ok: 204,
  },
  'POST /api/v1/tenants/{tenantId}/applications/{id}/notes': {
    summary: 'Add a private HR note',
    tag: 'Recruitment',
    access: T,
    permission: 'recruitment.manage',
    optional: true,
    body: recruit.noteBody,
    ok: 201,
  },
  'POST /api/v1/tenants/{tenantId}/applications/{id}/hire': {
    summary: 'Hire an applicant with an offer',
    tag: 'Recruitment',
    access: T,
    permission: 'recruitment.manage',
    optional: true,
    description:
      'Creates the employee record (linked to the applicant account) and marks the application HIRED in one transaction.',
    body: recruit.hireBody,
    ok: 201,
  },
  'GET /api/v1/public/jobs': {
    optional: true,
    summary: 'Open job postings of active companies',
    tag: 'Recruitment',
    access: 'public',
    query: [{ name: 'q', description: 'Search in the title' }],
    ok: 200,
  },
  'GET /api/v1/public/jobs/{tenantId}/{id}': {
    optional: true,
    summary: 'One open job posting',
    tag: 'Recruitment',
    access: 'public',
    ok: 200,
  },
  'POST /api/v1/applicant/applications': {
    optional: true,
    summary: 'Apply for an open job',
    description: 'One application per person per posting; at most 20 in progress.',
    tag: 'Recruitment',
    access: 'session',
    body: recruit.applyBody,
    ok: 201,
  },
  'GET /api/v1/applicant/applications': {
    optional: true,
    summary: "The caller's own applications",
    tag: 'Recruitment',
    access: 'session',
    ok: 200,
  },
  'POST /api/v1/applicant/applications/{id}/withdraw': {
    optional: true,
    summary: 'Withdraw an own application',
    tag: 'Recruitment',
    access: 'session',
    ok: 204,
  },

  // ---- Files ----------------------------------------------------------------------------------
  'GET /api/v1/features': {
    optional: true,
    summary: 'Which optional features are available (file uploads)',
    tag: 'System',
    access: 'public',
    ok: 200,
  },
  'POST /api/v1/applicant/applications/{id}/cv': {
    optional: true,
    summary: 'Upload or replace the CV of an own application',
    description:
      'The request body is the file itself (Content-Type application/pdf, image/png or image/jpeg, at most 5 MB; the real type is read from the bytes). Optional X-File-Name header (URL-encoded) for the download name. Replacing retires the previous CV.',
    tag: 'Files',
    access: 'session',
    ok: 201,
  },
  'GET /api/v1/applicant/applications/{id}/cv': {
    optional: true,
    summary: 'A 5-minute download link for the CV of an own application',
    tag: 'Files',
    access: 'session',
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/applications/{id}/cv': {
    optional: true,
    summary: "A 5-minute download link for an applicant's CV (audited)",
    tag: 'Files',
    access: T,
    permission: 'recruitment.manage',
    ok: 200,
  },
  'GET /api/v1/passenger/complaints/{id}/attachments': {
    optional: true,
    summary: 'Attachments of an own complaint',
    tag: 'Files',
    access: 'session',
    ok: 200,
  },
  'POST /api/v1/passenger/complaints/{id}/attachments': {
    optional: true,
    summary: 'Attach a file to an own complaint (at most 3)',
    description: 'Body is the file itself; see the CV upload for the rules.',
    tag: 'Files',
    access: 'session',
    ok: 201,
  },
  'GET /api/v1/passenger/complaints/{id}/attachments/{fileId}/link': {
    optional: true,
    summary: 'A 5-minute download link for an attachment of an own complaint',
    tag: 'Files',
    access: 'session',
    ok: 200,
  },
  'GET /api/v1/tenants/{tenantId}/complaints/{id}/attachments': {
    optional: true,
    summary: 'Attachments of a complaint',
    tag: 'Files',
    access: T,
    permission: 'support.manage',
    ok: 200,
  },
  'POST /api/v1/tenants/{tenantId}/complaints/{id}/attachments': {
    optional: true,
    summary: 'Attach a file to a complaint as staff (at most 3 in total)',
    tag: 'Files',
    access: T,
    permission: 'support.manage',
    ok: 201,
  },
  'GET /api/v1/tenants/{tenantId}/complaints/{id}/attachments/{fileId}/link': {
    optional: true,
    summary: 'A 5-minute download link for a complaint attachment',
    tag: 'Files',
    access: T,
    permission: 'support.manage',
    ok: 200,
  },
  'GET /api/v1/dev-files': {
    optional: true,
    summary: 'Development-only signed file download (local disk storage)',
    description: 'Only mounted when STORAGE_DEV_DIR is used outside production.',
    tag: 'Files',
    access: 'public',
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
