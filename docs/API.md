# API documentation

The API is documented with **OpenAPI 3.1**, generated from the running application:

- `GET /api/v1/openapi.json` — the machine-readable document.
- `GET /api/v1/docs` — interactive Swagger UI (self-hosted, works under the default `script-src 'self'` CSP; "Try it out" attaches the CSRF header from your session cookie).

Both are on by default outside production and **off in production** unless `API_DOCS_ENABLED=true`.

## How it stays accurate

1. Every router is created with `platform/router.ts`, which records each route and mount prefix.
2. `openapi/operations.ts` holds one entry per route (summary, tag, required permission, request schema).
3. Request schemas are the **same zod objects used for validation**, so constraints (min/max, enums, strict mode) in the docs cannot differ from what the server enforces.
4. `openapi/build.ts` throws if a registered route has no entry or an entry has no route. `src/openapi/openapi.test.ts` runs this in CI, validates the output with a real OpenAPI validator, and covers the case where optional features (Google sign-in, MFA, docs) are not configured.

**Adding an endpoint:** register it on a router, add its entry to `operations.ts`, export any new request schema. The test tells you if you forgot.

## Conventions

- Auth: HttpOnly `sid` cookie; echo the `csrf` cookie in `x-csrf-token` on POST/PUT/PATCH/DELETE.
- Company routes: `/tenants/{tenantId}/...`. The ID is only a selector; non-members get the same 404 as a nonexistent company.
- Errors: one envelope `{ "error": { "code", "message", "requestId", "details?" } }`.
- Lists: `limit` (1-100, default 25) and `offset`.

## Known gaps

- Response bodies are documented as generic objects (status codes and the error envelope are precise; success payload schemas are not yet modelled).
- Idempotency keys, webhooks and third-party OAuth do not exist yet.
