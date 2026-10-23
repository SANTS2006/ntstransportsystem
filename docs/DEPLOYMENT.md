# Deployment and operations

For a first online trial, follow `RENDER.md`. This document is the longer reference: how the pieces
fit, what to set, how to release and recover.

**Status: written, not yet executed.** Nothing has been deployed anywhere yet. What was checked
locally: the production build starts and serves the app and the API from one address, and the web
app renders and loads its fonts under the Content-Security-Policy the API sends. Treat the first
real deployment as the verification.

## Shape

```
browser ──► one Node service (API + built web app) ──► Neon Postgres
                          │                          ├─► Redis (rate limits)
                          │                          ├─► Brevo (e-mail)
                          │                          ├─► Cloudinary (uploaded files)
                          └──────────────────────────└─► Monime (payments)
```

The browser sees **one address**: the API process also serves the built web app (`WEB_DIST_DIR`),
because the app relies on same-origin cookies. `APP_URL` is that public address and must be
`https`. There is nothing else to run.

The same process runs the background jobs (expire unpaid bookings every 60 s, deliver the
notification outbox every 10 s). Several copies may run at once: the outbox claims events with
`FOR UPDATE SKIP LOCKED` and leases, and the expiry sweep works one booking per transaction.

## Build and start

```bash
npm ci --include=dev
npm run build            # shared package, API, web app, in that order
npm run start -w @nts/api
```

`render.yaml` holds exactly these commands for Render. Any host that can run Node 22 works the
same way.

## Environment

See `ENVIRONMENT.md` for every variable. In production the API refuses to start unless the
required ones are set, `APP_URL` is https, `PAYMENTS_SANDBOX` is off, rate limits are unscaled and
`STORAGE_DEV_DIR` is unset. Two things are easy to miss:

- `MFA_ENCRYPTION_KEY` is required in production. Without it the API runs but the payment, ticket,
  complaint, report, recruitment and file routes are **not mounted**. The same key encrypts
  TOTP seeds and each company's Monime credentials, and tickets and file links derive sub-keys from it.
- The database URLs differ by purpose: the app connects with the **pooled** URL as the restricted
  `nts_app` role; migrations use the **direct** URL as the owner role.

## First deployment

1. Prepare the database with `npm run db:provision -w @nts/api` (creates the restricted `nts_app`
   role, applies every migration, checks the role cannot bypass row-level security, prints the
   app's `DATABASE_URL`). See `TENANCY.md` for why the restricted role matters.
2. Set the environment, start the service, check `GET /health/ready` (database and Redis) and
   `GET /api/v1/features`.
3. Confirm in a browser that sign-in works and that `/api/v1/docs` is **not** served unless
   `API_DOCS_ENABLED=true`.
4. Create the first platform operator: the person registers, verifies their e-mail and enrols MFA,
   then someone with the owner database URL runs
   `npm run platform:grant -w @nts/api -- someone@example.com SUPER_ADMIN`. There is deliberately
   no default admin and no HTTP path to the first platform role. Never ship demo data:
   `npm run seed:dev` and `scripts/dev-demo.ts` are development only.
5. Per company: the owner enters its Monime space id, API token and webhook secret in the payment
   settings page; the webhook URL to register in Monime is shown there
   (`/api/v1/webhooks/monime/<tenantId>`). Companies can also take payments at the desk.

## Releasing

1. CI green (`CI.md`), including the migration-vs-schema drift check.
2. Apply migrations first (`npm run db:provision -w @nts/api` is safe to repeat). Keep each
   migration compatible with the previous version for one release (add before you use, remove after
   you stop using) so a restart does not break requests in flight. This is a rule for future
   migrations; it has not been audited for the existing ones.
3. Deploy. The service drains on `SIGTERM` (it stops the jobs, closes the server, and exits after
   10 s at the latest).
4. Watch the logs for `outbox events dead-lettered` and for 5xx rates for a few minutes.

**Rollback**: redeploy the previous version. Do not roll a migration back by hand on a live
database; write a new forward migration. Maintenance mode (platform admin page) gives a clean 503
with a message while you work; sign-in for platform staff, the status endpoint and webhooks stay up.

## Backups and restore

Neon keeps history for point-in-time restore; **how far back depends on the plan, and has not been
checked for this project**. Before launch:

- [ ] Confirm the retention window on the production plan and that it meets the business need.
- [ ] Do one restore drill: restore to a new branch at a chosen timestamp, point a staging copy at
      it, sign in, open a booking and a ticket. Record how long it took.
- [ ] Decide whether the uploaded files in Cloudinary need a second copy (the database only holds
      an index; deleting a file there cannot be undone by a database restore).
- [ ] Keep `MFA_ENCRYPTION_KEY` and `SESSION_SECRET` in a secret manager **separate from** database
      backups: a restored database without the key cannot decrypt TOTP seeds or payment credentials.

Key rotation (`MFA_ENCRYPTION_KEY`) is **not built**: changing the key makes existing TOTP seeds
and stored company payment credentials unreadable. Plan it as a re-encryption job before it is
ever needed.

## Operating

| Signal                                                 | Meaning / action                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `GET /health/live`, `/health/ready`                    | Process up / database and Redis reachable. Use ready for load-balancer checks.                              |
| log `outbox events dead-lettered`                      | An event failed 5 times (e-mail provider down, bad data). Inspect `outbox_events` where `failed_at` is set. |
| `PAID_UNFULFILLED` payments, `payment.refund_required` | A customer paid twice or after their seats were released: the company must refund them.                     |
| 503 `MAINTENANCE`                                      | Maintenance mode is on; turn it off from the platform admin page.                                           |
| 429                                                    | Rate limits; counters live in Redis, so they are shared across copies.                                      |

Not built yet: metrics and alerting, error tracking, log shipping, an uptime check, and a
data-retention job (old notifications, applicant data, audit log). Add them before real traffic.
