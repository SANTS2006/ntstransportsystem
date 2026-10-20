# Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:

| Step                                                          | Why                                                                                                              |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                      | Installs exactly the lockfile                                                                                    |
| Prettier check, ESLint, TypeScript                            | Style and strict type safety                                                                                     |
| Create the restricted `nts_app` role, `prisma migrate deploy` | Proves migrations apply to an empty database; tests then connect as a role that cannot bypass row-level security |
| `prisma migrate diff --exit-code`                             | Fails if `schema.prisma` and the migrations disagree                                                             |
| `npm test`                                                    | Unit tests plus the database-backed suites (auth, tenant isolation, RBAC, catalog, crew) against the CI Postgres |
| `npm run build` and a start-up probe                          | The compiled API must boot and answer `/health/live`                                                             |
| `npm audit --omit=dev --audit-level=high`                     | Production dependency vulnerabilities                                                                            |
| Gitleaks (separate job)                                       | Secrets in history                                                                                               |

Dependabot (`.github/dependabot.yml`) opens weekly updates for npm packages and GitHub Actions.

## Status

**Not yet executed on GitHub** (no remote exists). The YAML parses and every command in it was checked to exist locally, and the non-database steps pass locally, but the first real run may need adjustments (for example `psql` availability or action versions). Recommended hardening once it runs: pin actions to commit SHAs and require the workflow on the protected branch.
