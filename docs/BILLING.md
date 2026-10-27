# Stripe subscriptions

Billing is optional. Without all three nonblank server settings `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, and `STRIPE_WEBHOOK_SECRET`, billing endpoints are disabled and the UI keeps Pro unavailable. Local/demo mode continues to use browser storage; it cannot buy a subscription. Never use `VITE_` for Stripe secrets or expose service-role credentials in browser/runtime configuration.

## Supabase and server configuration

1. Apply `supabase-schema.sql`, then `supabase-schema-update.sql` in Supabase SQL Editor. The migration is safe to rerun. `profiles` cascades on account deletion. Authenticated users can SELECT only their own row; writes and the webhook RPC require the service role. `stripe_billing_events` is a private event receipt ledger.
2. Configure existing Supabase authentication (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and matching public `VITE_SUPABASE_*` for development) and server-only `SUPABASE_SERVICE_ROLE_KEY`. Billing also requires a project URL and service-role key; absent either, it remains disabled. Daily quotas use this same service-role binding.
3. Keep `DANTE_ALLOW_ANONYMOUS=false` in public deployments. Billing always rejects anonymous/local identities, even if anonymous Dante is allowed.
4. Set the server-only Stripe variables below, then restart the server. Keep keys in your deployment's secret store, never Git, logs, screenshots or frontend code.

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe API secret for the intended test/live account |
| `STRIPE_PRICE_ID` | Recurring Pro price ID in that same account/mode |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for this endpoint, from Stripe Dashboard (or Stripe CLI during local testing) |
| `BILLING_APP_URL` | Optional trusted return origin; defaults to `https://zenose.tech`. Local testing can use `http://localhost:3000`. Production must use HTTPS. Paths, request Host/Origin headers, and client-supplied redirect URLs are never used. |

## Stripe Dashboard

1. Start in **test mode**. Create a ZEN OS Pro product and a recurring monthly EUR price. The current landing card advertises €5/month, so configure €5/month (and choose consistent tax-inclusive/exclusive presentation). Set `STRIPE_PRICE_ID` to this price. Review that price before enabling billing publicly.
2. In Billing → Customer portal, activate the portal and allow customers to update payment methods and cancel subscriptions. Configure the business information and terms/privacy links. Avoid enabling switches to other prices: only the configured Pro price grants this app's Pro entitlement.
3. In Workbench/Developers → Webhooks, add this HTTPS endpoint:

   `https://zenose.tech/api/stripe/webhook`

   Subscribe to `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`. Copy the endpoint signing secret into `STRIPE_WEBHOOK_SECRET`. Use the endpoint API version matching the installed Stripe SDK's pinned API version; changing Stripe SDK/API versions requires retesting subscription item period fields.
4. Configure your egress policy to allow `api.stripe.com` and your Supabase project's hostname. Browser navigation to `checkout.stripe.com` and `billing.stripe.com` must also be allowed. Permit inbound Stripe HTTPS POSTs to the webhook without a user login gate; Stripe signatures provide authentication. Do not put JSON/body-transform middleware ahead of this route.
5. Confirm `GET /api/billing/status` reports `enabled:true`, then sign in and choose **Upgrade to Pro**. The price and payment consent appear at Stripe Checkout. A successful browser return never grants Pro by itself.
6. After test validation, create the corresponding live product/price, live API key and live endpoint secret together. Never mix test/live IDs. Repeat a small live checkout/refund using your own approved payment workflow.

## Runtime behavior

- `POST /api/billing/checkout` and `/api/billing/portal` use `requireUser` and rate limiting. The account ID comes exclusively from the verified bearer token, and the customer mapping is stored with the service-role client. Client IDs, prices, plan claims, metadata and redirect URLs are ignored. Stripe customer creation uses a per-account idempotency key; repeated checkout clicks reuse open sessions and concurrent requests within a half-hour share an idempotency key. Existing ongoing subscriptions must be managed through the portal.
- `/api/stripe/webhook` is mounted before `express.json`, accepts a bounded raw body, and verifies the Stripe signature and timestamp. It looks up ownership by the server-stored customer mapping, then retrieves current subscriptions directly from Stripe. Only an `active` or `trialing` subscription with the configured price and a future period end grants Pro. Canceled, expired, unpaid, incomplete and past-due subscriptions do not grant Pro. Cancellation at period end retains Pro while Stripe still reports an active paid period.
- The service-role-only SQL RPC atomically records the event ID and changes the profile under a row lock. Duplicate IDs and older event timestamps cannot overwrite the plan. A profile revision check rejects stale concurrent snapshots with a retryable response; Stripe retries and the handler reads fresh state. Storage/Stripe failures return generic 503 responses without logging provider errors or secret data. Unknown customers and unrelated event types are acknowledged without changing accounts.
- Pro is checked on the server from `profiles`, including `current_period_end`, before either daily Dante counter or usage read. Pro skips daily chat/transcription limits; authentication and per-minute rate limits still apply. An unavailable plan store fails closed. With billing disabled, the existing free/local daily-quota behavior is preserved.
- `/api/billing/account` returns only enabled/plan/customer-presence flags for the verified account. It never exposes Stripe IDs or secrets. The UI refreshes on account changes, focus and success-return polling; failures hide purchase controls. Past-due/free customers can still open the portal.
- `/billing/success`, `/billing/cancel`, and `/billing/upgrade` use existing login gating, design-system tokens and responsive cards. The success screen polls the server for activation rather than trusting URL parameters. Payment can take time; Stripe retries failed webhooks. Never manually grant Pro based on a screenshot or browser return.
- **Account deletion:** deleting a ZEN OS account cascades its profile but does not cancel a subscription at Stripe. Cancel the subscription through **Manage subscription** before deleting the app account. Administrators must also handle cancellation/refunds in Stripe for any account deleted directly in Supabase. Stripe billing records are retained independently under Stripe's retention rules.

## Verification

Run `npm run typecheck`, `npm test`, and `npm run build`. Automated tests use signed synthetic Stripe events, mocked Stripe API calls and embedded PostgreSQL; no real payments or external credentials are needed. Tests cover disabled mode, identity boundaries, customer reuse, checkout reuse, portal ownership, raw signature verification, canonical subscription reconciliation, failed-delivery retries, receipt idempotency, stale/concurrent events, RLS and quota enforcement.

For end-to-end testing, use Stripe test mode and `stripe listen --forward-to localhost:3000/api/stripe/webhook`, using that listener's signing secret and `BILLING_APP_URL=http://localhost:3000`. Complete a test Checkout using Stripe's documented test payment methods, verify Pro via the signed-in account endpoint, retry the same event, cancel in the portal, and verify the plan and Dante daily quota change. Also test past-due/unpaid events, delayed delivery and a failed database write followed by Stripe retry. The CLI signing secret differs from the deployed endpoint secret. Real Checkout/portal/webhook delivery needs configured test credentials and is not proven by the offline tests.
