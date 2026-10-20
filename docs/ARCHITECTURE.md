# NTS Platform: Architecture Assessment and Plan

## Phase 0 findings (2026-10-20)

- Repository was empty (no files, not a git repo). Greenfield build; nothing to preserve.
- Toolchain: Node 24, npm 11, git 2.56. **Not installed:** pnpm, PostgreSQL (`psql`), Redis. Docker is not a requirement.
- Consequence: DB-backed integration tests need either a Neon test branch (`TEST_DATABASE_URL`) or a native/embedded PostgreSQL. Until one is configured, DB tests are marked **pending**, not passing.

## Stack

npm workspaces monorepo:

- `packages/shared` — Zod schemas, permission catalog, error codes, money helpers (integer minor units).
- `apps/api` — Node + Express + TypeScript (strict), Prisma + PostgreSQL (Neon), BullMQ/Redis, pino logging. REST under `/api/v1`.
- `apps/web` — React + Vite + TypeScript (strict), React Router, TanStack Query, RHF + Zod, Tailwind, Poppins.

## Backend layout (modular monolith)

`src/config` (env schema, fail-fast) · `src/platform` (logger, errors, http middleware, db, redis) · `src/modules/<module>/{routes,controller,service,repository,policy}` · `src/jobs` · `src/integrations/<provider>` adapters.
Modules from the spec are added phase by phase; each stays small (no giant route files).

## Tenancy design (summary; full threat model lands in Phase 2)

- Tenant derived only from verified membership, never client input.
- Every tenant table carries `tenant_id`; composite FKs `(tenant_id, id)` prevent cross-tenant links.
- PostgreSQL RLS on sensitive tables; tenant context set with `set_config(..., true)` (transaction-local) inside a transaction, so pooled connections cannot leak it.
- Platform admin is a separate principal type with audited, MFA-enforced access, not a tenant membership.

## Security plan (foundation)

helmet, strict CORS allowlist, request-ID correlation, pino redaction, uniform error envelope with no stack traces, Argon2id, HttpOnly SameSite cookies + CSRF, Redis-backed rate limits, env validation that refuses to boot in production on missing config.

## External prerequisites (production, all pending)

Neon project + pooled/direct URLs · Redis · Google OAuth client · Monime merchant account (API must be verified against official docs before coding the adapter) · Brevo key + verified sender · Cloudinary · Cloudflare R2 + backup key · error monitoring DSN.

## Phases

See `docs/CHECKLIST.md`.
