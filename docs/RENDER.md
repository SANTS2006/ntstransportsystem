# Try the system online on Render

This puts the whole system (API and web app, one service on one URL) online so you can use it from
any browser. It is a **test deployment**: free plan, e-mails written to the logs, throwaway data.

**Status:** the pieces were verified locally (the production build starts and serves the app and
API from one origin, the settings rules are unit tested, the database script is tested for its
helpers). **Nothing has been run on Render itself yet**, so expect to fix small things on the first
attempt, and tell me what Render's build log or service log says if it fails.

## What you need (all have free tiers)

| Account                 | For                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------ |
| GitHub                  | Render deploys from a GitHub repository. This project has no remote yet (step 1).    |
| Neon                    | A **new, empty** database for the test (step 2). Do not reuse your development data. |
| Upstash                 | Redis. You already have it; use the `rediss://default:...@...:6379` URL.             |
| Render                  | Hosting.                                                                             |
| Monime (test, optional) | Taking payments. Without it, bookings can be made and held but not paid (see below). |

## 1. Put the code on GitHub

Create an empty **private** repository on GitHub, then from the project folder:

```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin master
```

`.env` is git-ignored and is not pushed. (Render's Blueprint looks for `render.yaml` at the
repository root; it is there. If you push the `master` branch, pick `master` when Render asks.)

## 2. Create the test database

1. In Neon, create a **new project** (for example `nts-render-test`). Copy its **direct** (not
   pooled) connection string: in the connection dialog, turn "Connection pooling" **off**. It looks
   like `postgresql://neondb_owner:...@ep-xxxx.<region>.aws.neon.tech/neondb?sslmode=require`.
2. Run the setup script from your machine. It creates the restricted `nts_app` role, applies all
   migrations, checks that the role cannot bypass row-level security, and prints the connection
   string the app must use. The owner string stays on your machine.

PowerShell:

```powershell
$env:OWNER_DATABASE_URL = "<the direct owner string>"
npm run db:provision -w @nts/api
Remove-Item Env:OWNER_DATABASE_URL
```

bash:

```bash
OWNER_DATABASE_URL="<the direct owner string>" npm run db:provision -w @nts/api
```

3. Copy the `postgresql://nts_app:...-pooler...` line it prints at the end. That is the app's
   `DATABASE_URL`. It is shown once and not saved; if you lose it, run the script again with
   `NTS_APP_PASSWORD=<16+ letters/digits>` to set a new password.

## 3. Make the encryption key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Keep this value (a password manager is right). It encrypts two-factor secrets and company payment
credentials. **Do not change it later** or those become unreadable.

## 4. Create the service on Render

1. Render dashboard, **New**, **Blueprint**, connect GitHub, pick the repository (and the
   `master` branch). Render reads `render.yaml`.
2. It asks for the values marked `sync: false`:
   - `MFA_ENCRYPTION_KEY`: from step 3.
   - `DATABASE_URL`: from step 2.
   - `REDIS_URL`: your Upstash `rediss://` URL.
3. Apply. The first build takes several minutes. The service is healthy when
   `https://<name>.onrender.com/health/live` answers `{"status":"ok"}` (or similar).

`APP_URL`, `API_URL` and the allowed origin are set automatically from the service's own URL.
Sign-in cookies are same-origin because the API also serves the web app.

## 5. Use it

1. Open the service URL, **Create account**, then find the verification link: Render dashboard,
   your service, **Logs**, search for `DEV mail`. The line contains the `link` to open. (E-mail
   is not sent in this test setup.)
2. **Make yourself a platform operator** (to approve companies and see the platform pages). Sign
   in, open **Security**, and set up two-factor. Then on your machine:

   ```powershell
   $env:DIRECT_DATABASE_URL = "<the direct owner string>"
   npm run platform:grant -w @nts/api -- you@example.com SUPER_ADMIN
   Remove-Item Env:DIRECT_DATABASE_URL
   ```

   Sign out and in again; **Platform admin** appears in the menu.

3. **Register a company** (menu: Register a company), approve it under Platform admin, and set up
   its locations, vehicles, routes and trips in the company workspace.
4. **Quick demo data instead:** to get a ready-made company, trips and demo accounts, run the dev
   seed against the new database from your machine (it never prints passwords; they are written
   to `.dev-seed.json`, which is git-ignored):

   ```powershell
   $env:DATABASE_URL = "<the nts_app URL from step 2>"
   $env:MFA_ENCRYPTION_KEY = "<the same key as on Render>"
   npm run seed:dev -w @nts/api
   ```

## What will and will not work

- **Works:** accounts, two-factor, companies and approval, fleet/routes/trips, seat maps, staff and
  roles, booking holds, payment at the desk, tickets and QR codes (after a paid booking), boarding, complaints,
  recruitment, voice messages and photos on complaints (with Cloudinary set), reports, in-app notifications, maintenance mode.
- **Payments:** staff can take payment at the desk (**Bookings**, then **Take payment**: cash, mobile money shown at the counter, or bank transfer), which confirms the booking and issues the tickets, so you can test the whole flow without Monime. Online payment by passengers needs a Monime account: a **test** one (token starts `mon_test_`) whose space id, token and webhook secret the company owner enters under **Payments**, with the webhook URL shown there registered in Monime. That online flow has only been tested against a mock, never against real Monime.
- **No uploads** (CVs, complaint photos, videos and voice messages) until you set `CLOUDINARY_URL`. Create a free Cloudinary account, copy the API environment variable (it looks like `cloudinary://<key>:<secret>@<cloud>`) from Settings, API Keys, and add it to the service's environment on Render. Check in Cloudinary's security settings that delivery of PDF files is allowed, or PDFs may not open. This has not been run against a real Cloudinary account yet.
- **No Google sign-in** until `GOOGLE_CLIENT_ID` is set on the service and
  `VITE_GOOGLE_CLIENT_ID` is available at build time (add both as environment variables, then
  redeploy), and your Render URL is an allowed origin in the Google console.
- **Free plan sleeps** after 15 minutes without visitors; the first request afterwards takes about
  a minute. While asleep, nothing expires unpaid bookings and no notifications are processed;
  they catch up when it wakes. Use a paid plan to keep it running.
- **Rate limiting** uses the visitor's address as Render forwards it. The setting that reads it
  (`trust proxy` = 1) has not been checked against Render's proxy chain; with it wrong, visitors
  could share one limit. Fine for a test; verify before real use.
- **E-mail links are in the logs.** Anyone who can read your Render logs can use verification and
  reset links. Use throwaway accounts. For real mail, delete `ALLOW_DEV_MAILER`, add
  `BREVO_API_KEY` and `MAIL_FROM_EMAIL`, and redeploy.

## Changing things later

- **New code:** push to GitHub; Render redeploys.
- **New database migrations:** run `npm run db:provision -w @nts/api` again (safe to repeat) with
  your owner string **before** the new code goes live.
- **Reset everything:** delete the Neon project and create a new one (step 2).
