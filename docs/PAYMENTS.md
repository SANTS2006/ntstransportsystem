# Payments (Monime)

Checked against the public Monime documentation on 2026-10-21. **Nothing here has been run against a live or test Monime account**: the automated tests use a fake gateway and locally computed signatures.

## What was verified, and where from

| Fact                                                                                                                                                                                                                                                         | Source                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Base URL `https://api.monime.io/v1`; `POST /checkout-sessions`, `GET /checkout-sessions/{id}`                                                                                                                                                                | docs.monime.io API reference (caph-2025-08-23) |
| Headers: `Authorization: Bearer`, `Monime-Space-Id` (`spc-…`), `Monime-Version: caph.2025-08-23`, `Idempotency-Key` (required on create; 25-64 chars; replay returns the original result for 24 h; same key + different body = 409 `idempotency_key_in_use`) | API reference + idempotency page               |
| Amounts: integer minor units, currency `SLE` only; 1 SLE = 100                                                                                                                                                                                               | create-checkout-session reference              |
| Session `status`: `pending`, `completed`, `cancelled`, `expired`; response carries `redirectUrl`, `expireTime`, `reference`, `metadata`                                                                                                                      | API reference                                  |
| Test tokens start `mon_test_`, live tokens `mon_`                                                                                                                                                                                                            | API basics                                     |
| Webhook payload `{apiVersion, event{id,name,timestamp}, object{id,type}, data{...}}`; `event.id` is stable across retries                                                                                                                                    | webhook structure page                         |
| **Signature**: header `Monime-Signature: t=<unix>,v1=<base64>`; `v1 = base64(HMAC-SHA256(secret, "<t>_<raw body>"))`; reject if `                                                                                                                            | now - t                                        | > 300 s`; HS256 webhook `secret` is 32-256 chars | **Monime's own WordPress plugin source** (`Wp-Monime/src/Monime/core/webhook.php`) and the create-webhook reference |
| Events used: `checkout_session.completed`, `checkout_session.expired` (the official plugin handles both)                                                                                                                                                     | plugin source                                  |

## Gaps and risks (be aware)

- The docs page "HMAC Verification" is an empty stub, so the signature scheme above comes from the vendor's plugin code, not from documentation. Re-check it against a real delivery before going live.
- The docs list `checkout_session.*` events as "coming soon", although the official plugin relies on them. We do not trust the webhook alone: on a verified `completed` event we **re-fetch the session** with the API token and require `status = completed` and our `reference` before confirming a booking.
- The session object does not expose the amount actually paid, so we rely on the line items we created ourselves (server-side, from the booking snapshot). Never from the redirect or from client input.
- The success redirect is **never** treated as proof of payment (the official WooCommerce plugin does this; we deliberately do not).
- Default session lifetime is undocumented. Our seat hold is 15 minutes. If a payment completes after the hold lapsed and the seats were resold, the payment becomes `PAID_UNFULFILLED` and a `payment.refund_required` outbox event is raised. **No public refund endpoint was found in the docs, so refunds are a manual action by the company.**
- Sandbox page is empty; we only know about the `mon_test_` token prefix.

## Our design

- Each company stores its own Monime credentials (token, space id, webhook secret) encrypted with AES-256-GCM (`MFA_ENCRYPTION_KEY`); money goes to the company's own Monime space.
- Webhook URL per company: `POST /api/v1/webhooks/monime/{tenantId}`. The tenant id only selects which secret to verify with; nothing is processed unless the signature is valid.
- Replay protection: the signed timestamp window plus a unique `(tenant, event id)` record.
- Booking confirmation happens only inside `BookingService.markPaid`, called after the verified re-fetch.
