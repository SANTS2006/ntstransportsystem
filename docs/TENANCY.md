# Tenancy and Database Setup

## Isolation layers

1. **Application:** tenant is derived from the verified session and membership, never from request input.
2. **Database (RLS):** `tenants`, `roles`, `role_permissions`, `memberships`, `invitations`, `audit_logs` have `FORCE ROW LEVEL SECURITY`. Policies read transaction-local settings `app.tenant_id`, `app.user_id`, `app.platform`, set by `withDb()` (`apps/api/src/platform/db.ts`) with `set_config(..., true)` so pooled connections cannot leak context.
3. **Constraints:** `memberships(tenant_id, role_id)` has a composite FK to `roles(tenant_id, id)`, so a membership cannot reference another tenant's role.

**Guarantee (once the DB tests pass):** an app-role query without matching context returns no tenant rows; cross-tenant reads, updates, deletes and inserts on RLS tables are rejected by the database. **Not yet claimed:** isolation for tables added in later phases; each new tenant table must add RLS and tests.

## Required: a restricted application role

Neon's default owner role bypasses RLS. Create a separate role and use it in `DATABASE_URL` (pooled) and `TEST_DATABASE_URL`. Run migrations with `DIRECT_DATABASE_URL` as the owner.

```sql
CREATE ROLE nts_app LOGIN PASSWORD '<generate-a-strong-password>' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE <dbname> TO nts_app;
```

Run that **before** `prisma migrate deploy` (the second migration grants table access to `nts_app` if it exists), or re-run the grant block afterwards. The isolation test asserts the connected role is neither superuser nor `BYPASSRLS`.

## Setup

1. Copy `.env.example` to `.env` at the repo root; set `DATABASE_URL` (pooled, `nts_app`), `DIRECT_DATABASE_URL` (direct, owner), `TEST_DATABASE_URL` (a separate Neon branch; never production).
2. `npm run prisma:deploy -w @nts/api` against the test branch, then `npm test`.

## Known limits

- Platform scope (`app.platform = 'on'`) is set by server code only; it is an audited capability, not a membership.
- Rate-limit counters are in memory until the Redis store is wired in.

## Access model (implemented)

- **Tenant routes** (`/api/v1/tenants/:tenantId/...`): the URL ID is only a _selector_. `tenantScope` loads the caller's own ACTIVE membership under RLS and derives permissions from the role. Non-members, revoked members and nonexistent tenants all receive an identical 404 (no existence disclosure). A non-ACTIVE company is 403 (PENDING may read its own profile only).
- **Platform routes** (`/api/v1/platform/...`): require a platform role (separate table from memberships) **and** enrolled MFA. Callers without any platform role get 404; denials are audited. Lifecycle changes (approve/reject/suspend/reactivate/deactivate) need OPERATIONS or SUPER_ADMIN, follow an explicit transition table, use compare-and-set, and require a reason for reject/suspend/deactivate. A DB trigger also forbids non-platform scope from changing `tenants.status`.
- **Escalation rules:** you can only grant permissions you hold; only an owner can assign or modify the owner role; you cannot change your own role; a company always keeps at least one owner; the owner role is immutable; unknown keys in request bodies are rejected (mass assignment).
- **First platform admin:** no default admin exists. An operator runs `npm run platform:grant -w @nts/api -- <email> SUPER_ADMIN` with the owner DB URL; the person must have a verified account and enroll MFA.
- **Audit-log writes** use `createMany` (no `RETURNING`) because platform-scope rows are intentionally unreadable to the app role.

## Operational notes

- Slow or distant database: Prisma's migration engine gives up after ~5 s. Add `&connect_timeout=120` to the direct URL when running `prisma migrate deploy`.
- The test database must be owned by the migrating owner role, not by `nts_app`; otherwise the app role could disable RLS on its own tables.
- Required app role grants are covered by migrations (including default privileges for future tables).

## Not yet verified / out of scope here

- Re-authentication for critical actions, approval workflows, and Redis-backed rate limits.
- Emails for tenant approval/suspension (Phase 7 notifications).
