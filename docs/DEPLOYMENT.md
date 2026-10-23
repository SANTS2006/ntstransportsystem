# Deployment and operations

**Status: written, not yet executed.** No Docker is installed on the development machine, so the
images in `deploy/` have not been built or run, and no production environment exists. What was
checked: the API and web builds the images run (`npm run build`), and that the web app renders and
loads its fonts under the Content-Security-Policy in `deploy/nginx.conf.template` (checked with a
small static server that sent the same header, not with nginx itself). Treat the first real
deployment as the verification.

## Shape

```
browser ──► web (nginx: static app, /api/ proxied) ──► api (Node, port 4000) ──► Neon Postgres
                                                          │                  ├─► Redis (rate limits)
                                                          │                  ├─► Brevo (e-mail)
                                                          │                  ├─► Cloudflare R2 (uploads)
                                                          └──────────────────└─► Monime (payments)
```

The browser must see **one origin**: the web app calls `/api/v1/...` and relies on same-origin
cookies, so the edge (nginx here, or any CDN/load balancer) routes `/api/` to the API and
everything else to the static app. `APP_URL` is that public origin and must be `https`.

## Images

| Image | Build (from the repository root)                     | Notes                                                                                   |
| ----- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| API   | `docker build -f deploy/api.Dockerfile -t nts-api .` | Runs as the non-root `node` user, health check on `/health/live`, `node dist/server.js` |
| Web   | `docker build -f deploy/web.Dockerfile -t nts-web .` | Set `API_UPSTREAM` (default `http://api:4000`); build arg `VITE_GOOGLE_CLIENT_ID`       |

The API process also runs the background workers (expire unpaid bookings every 60 s, deliver the
notification outbox every 10 s). Several API instances may run at once: the outbox claims events
with `FOR UPDATE SKIP LOCKED` and leases, and the expiry sweep works one booking per transaction.

## Environment

See `ENVIRONMENT.md` for every variable. In production the API refuses to start unless the
required ones are set, `APP_URL` is https, `PAYMENTS_SANDBOX` is off, rate limits are unscaled and
`STORAGE_DEV_DIR` is unset. Two things are easy to miss:

- `MFA_ENCRYPTION_KEY` is required in production. Without it the API runs but the payment, ticket,
  complaint, report, recruitment and file routes are **not mounted**. The same key encrypts
  TOTP seeds and each company's Monime credentials, and tickets/links derive sub-keys from it.
- The database URLs differ by purpose: the app connects with the **pooled** URL as the restricted
  `nts_app` role; migrations use the **direct** URL as the owner role.

## First deployment

1. Create the Neon project and the restricted role (see `TENANCY.md` for why): `nts_app`,
   `NOSUPERUSER NOBYPASSRLS`, a long random password, `CONNECT` on the database, `USAGE` on the
   schema. Migrations then grant it table privileges (and revoke what must not exist, such as
   `DELETE` on record tables).
2. Run the migrations as the owner: `DIRECT_DATABASE_URL=<owner direct url> npx prisma migrate deploy`
   from `apps/api`. Do this **before** starting a new API version.
3. Set the environment, start the API, check `GET /health/ready` (database and Redis) and
   `GET /api/v1/features`.
4. Start the web image behind TLS. Confirm in a browser that sign-in works (same-origin cookies,
   CSRF header) and that `/api/v1/docs` is **not** served unless `API_DOCS_ENABLED=true`.
5. Create the first platform operator: the person registers, verifies their e-mail and enrols MFA,
   then someone with the owner database URL runs
   `npm run platform:grant -w @nts/api -- someone@example.com SUPER_ADMIN`. There is deliberately
   no default admin and no HTTP path to the first platform role. Never ship demo data:
   `npm run seed:dev` and `scripts/dev-demo.ts` are development only.
6. Per company: the owner enters its Monime space id, API token and webhook secret in the payment
   settings page; the webhook URL to register in Monime is shown there
   (`/api/v1/webhooks/monime/<tenantId>`).

## Releasing

1. CI green (`CI.md`), including the migration-vs-schema drift check.
2. Apply migrations first. Keep each migration compatible with the previous API version for one
   release (add before you use, remove after you stop using) so a rolling restart does not break
   requests in flight. This is a rule for future migrations; it has not been audited for the
   existing ones.
3. Roll the API, then the web. The API drains on `SIGTERM` (it stops the workers, closes the
   server, and exits after 10 s at the latest).
4. Watch the logs for `outbox events dead-lettered` and for 5xx rates for a few minutes.

**Rollback**: redeploy the previous image. Do not roll a migration back by hand on a live database;
write a new forward migration. Maintenance mode (platform admin page) gives a clean 503 with a
message while you work; sign-in for platform staff, the status endpoint and webhooks stay up.

## Backups and restore

Neon keeps history for point-in-time restore; **how far back depends on the plan, and has not been
checked for this project**. Before launch:

- [ ] Confirm the retention window on the production plan and that it meets the business need.
- [ ] Do one restore drill: restore to a new branch at a chosen timestamp, point a staging API at
      it, sign in, open a booking and a ticket. Record how long it took.
- [ ] Decide whether the uploaded documents in R2 need versioning or a second copy (the database
      only holds an index; deleting an object cannot be undone by a database restore).
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
| `PAID_UNFULFILLED` bookings, `payment.refund_required` | A customer paid after their seats were released: the company must refund in Monime.                         |
| 503 `MAINTENANCE`                                      | Maintenance mode is on; turn it off from the platform admin page.                                           |
| 429                                                    | Rate limits; counters live in Redis, so they are shared across instances.                                   |

Not built yet: metrics and alerting, error tracking, log shipping, an uptime check, and a
data-retention job (old notifications, applicant data, audit log). Add them before real traffic.
