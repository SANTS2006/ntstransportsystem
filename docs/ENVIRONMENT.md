# Environment variables

All variables are read from a single `.env` at the repository root (never committed). Blank values count as unset. In production the API refuses to start if a required value is missing or unsafe.

| Variable                           | Required in prod | Purpose                                                                                                         |
| ---------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                         | yes              | `development`, `test` or `production`                                                                           |
| `PORT`, `LOG_LEVEL`                | no               | HTTP port (default 4000), pino level                                                                            |
| `APP_URL`                          | yes (https)      | Public web URL, used in email links                                                                             |
| `API_URL`                          | no               | Public API URL                                                                                                  |
| `CORS_ORIGINS`                     | yes              | Comma-separated allowlist; `*` is rejected in production                                                        |
| `DATABASE_URL`                     | yes              | **Pooled** Neon URL, connecting as the restricted `nts_app` role                                                |
| `DIRECT_DATABASE_URL`              | for migrations   | **Direct** (non-pooled) Neon URL as the owner role. Add `&connect_timeout=120` on slow links                    |
| `TEST_DATABASE_URL`                | tests            | A separate Neon branch, as `nts_app`. Never production                                                          |
| `REDIS_URL`                        | yes              | Shared rate-limit counters (and future job queue)                                                               |
| `SESSION_SECRET`                   | yes              | >= 32 chars                                                                                                     |
| `MFA_ENCRYPTION_KEY`               | yes              | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts TOTP seeds; keep it out of DB backups             |
| `BREVO_API_KEY`, `MAIL_FROM_EMAIL` | yes              | Brevo transactional email; the sender must be verified in Brevo. `MAIL_FROM_NAME` optional                      |
| `GOOGLE_CLIENT_ID`                 | no               | Enables Google sign-in on the API                                                                               |
| `API_DOCS_ENABLED`                 | no               | Serve `/api/v1/openapi.json` and `/api/v1/docs` (Swagger UI). Default: on outside production, off in production |
| `PAYMENTS_SANDBOX`                 | must be false    | Startup fails if true in production                                                                             |
| `RATE_LIMIT_SCALE`                 | must be 1        | Test-only multiplier; startup fails in production if not 1                                                      |

Web (`apps/web`, Vite): `VITE_GOOGLE_CLIENT_ID` shows the Google button (same client ID as the API).

## Web hosting notes

- The SPA calls `/api/v1` on its own origin (dev: Vite proxy). Put the API behind the same host or a reverse proxy so the HttpOnly session cookie and CSRF cookie are first-party.
- If you set a Content-Security-Policy on the web host, Google sign-in needs `script-src https://accounts.google.com/gsi/client`, `frame-src https://accounts.google.com/gsi/`, `connect-src https://accounts.google.com/gsi/`, and `style-src https://accounts.google.com/gsi/style`.

## Performance budget (web)

Initial route JS <= 200 kB gzip. Measured 2026-10-20: entry chunk 81 kB gz, shared zod chunk 36 kB gz, router/query chunk 34 kB gz; each page chunk 1-12 kB gz; fonts: 4 Latin Poppins files only.

## Provider status

| Provider               | Status                                                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neon PostgreSQL        | Verified (test branch, restricted role, RLS)                                                                                                                                                         |
| Brevo                  | Adapter + templates unit-tested against injected HTTP only. **Live send unverified** (no key). The reference page does not document 429/Retry-After/idempotency; retries use standard HTTP semantics |
| Redis                  | Rate-limit store written; **unverified against a real Redis** (none available). Falls back to in-memory when `REDIS_URL` is unset; limiter fails open if Redis errors                                |
| Google                 | Server verification via `google-auth-library`; real tokens untestable offline, tests use a verifier double. **Live sign-in unverified**                                                              |
| Monime, Cloudinary, R2 | Not started                                                                                                                                                                                          |

## Test database and payments

| Variable                                                                 | Purpose                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEST_DATABASE_URL`                                                      | Restricted `nts_app` role on a separate Neon branch, used by the DB test suites. Never the owner role.                                                                                                                                                         |
| `TEST_OWNER_DATABASE_URL`                                                | Owner role on the same branch, used only to apply migrations to it (`prisma migrate deploy` with `DIRECT_DATABASE_URL` set to this value). Add `connect_timeout=120`; omit `channel_binding`.                                                                  |
| `MFA_ENCRYPTION_KEY`                                                     | 32-byte base64 key. Also encrypts each company's Monime credentials; without it payment routes are not mounted.                                                                                                                                                |
| `MONIME_API_BASE`                                                        | Defaults to `https://api.monime.io/v1`. Override only for a mock.                                                                                                                                                                                              |
| `DB_TX_TIMEOUT_MS`                                                       | Transaction timeout in ms (1000-120000, default 15000). Raise on a slow or distant database link. The test helpers set 60000.                                                                                                                                  |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Cloudflare R2 for uploaded documents (CVs, complaint attachments). All four or none; uploads are off without them.                                                                                                                                             |
| `STORAGE_DEV_DIR`                                                        | Development only: keep uploads in this directory instead of R2 (refused in production). Needs `MFA_ENCRYPTION_KEY`.                                                                                                                                            |
| `WEB_DIST_DIR`                                                           | Serve the built web app (`apps/web/dist`) from the API process, so one origin hosts both. Relative paths resolve against the working directory (`../web/dist` when started with `npm run start -w @nts/api`). Unset: the API serves only `/api` and `/health`. |
| `ALLOW_DEV_MAILER`                                                       | **Test deployments only.** In production mode, allow running without Brevo; e-mails (and their links) are written to the logs instead of sent. All other production rules still apply.                                                                         |
| `RENDER_EXTERNAL_URL`                                                    | Set by Render itself. When present, `APP_URL`, `API_URL` and `CORS_ORIGINS` default to it. See `RENDER.md`.                                                                                                                                                    |
