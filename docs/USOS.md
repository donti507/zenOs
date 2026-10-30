# USOS university login

USOS login is optional. Local/demo mode and existing Google/email login continue to work without it. The login button is hidden unless the server has all six valid settings below and the browser has its existing public Supabase configuration.

## Before deployment

1. In Supabase SQL Editor, run the **complete** repository [supabase-schema-update.sql](../supabase-schema-update.sql), as a single script, using the project database owner. It is safe to rerun. For a new database, apply `supabase-schema.sql` first. Do not copy a fragment from inside a SQL function.
2. Register an OAuth consumer with your university's **USOS API** developer registration service or university USOS administrator. Obtain a consumer key and secret for the institution you will use. Request `email`, `studies` and `offline_access` scopes. Availability/approval and email visibility depend on the institution. This is an OAuth 1.0a integration, not a Google OAuth client.
3. Register this callback exactly: `https://zenose.tech/api/auth/usos/callback`. For development, register `http://localhost:3000/api/auth/usos/callback` if your institution permits it. The application accepts only the request hosts `zenose.tech` and `localhost:3000`; forwarded host/protocol headers cannot choose a callback. Your reverse proxy must preserve the correct Host header.
4. Set these **server-only** environment variables in your hosting service, then restart/redeploy:

   | Variable | Value |
   | --- | --- |
   | `USOS_BASE_URL` | Institution API base, e.g. `https://apps.usos.pwr.edu.pl/` (HTTPS required) |
   | `USOS_CONSUMER_KEY` | Registered USOS consumer key |
   | `USOS_CONSUMER_SECRET` | Registered USOS consumer secret |
   | `USOS_TOKEN_KEY` | Stable base64-encoded 32-byte encryption key |
   | `SUPABASE_URL` | Existing project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Existing project service-role secret |

   Generate the encryption key once with:

   ```sh
   openssl rand -base64 32
   ```

   Keep it backed up with your other server secrets. Never use a `VITE_` prefix, commit a key, paste it into a SQL script, or put it in browser runtime configuration. Existing `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` or runtime public equivalents are still needed by browser login. They do not replace these server credentials.
5. In Supabase **Authentication → URL Configuration**, allow `https://zenose.tech/auth/usos` (and `http://localhost:3000/auth/usos` for development). Set the site URL appropriately. Under **Authentication → Email provider**, set **Email OTP Expiration to 300 seconds or less**. Supabase's generated token is single-use and its native expiry is controlled by this project setting; `generateLink` does not offer a per-call expiry. The app additionally requires a one-use, same-browser completion grant that expires after **60 seconds**.
6. Check `/api/dante/status`: it should contain `"usos":true`, never keys or institution tokens. Verify real sign-in and explicit connection with a test university account before announcing availability. Mock tests do not establish provider registration or live credentials.

The server calls `services/oauth/request_token`, `services/oauth/authorize`, `services/oauth/access_token` and `services/users/user` beneath the configured base URL. The requested profile fields are `id|first_name|last_name|email|student_number`; student numbers are not saved.

## Sign-in and connection

The login page offers **Log in with USOS** below Google, in English or Polish. A first login creates a Supabase account with the university email and name. If USOS has no email, it uses `usos-<id>@users.zenose.tech`; this is a synthetic address, **not an inbox**. Existing linked identities always use their canonical Supabase account.

An email matching an existing Supabase account never links automatically from a signed-out flow. Sign in to that account first, then choose **Connect USOS** in the account menu. An email collision may link only to that same, verified-email account. The connect request uses the verified bearer identity; no client-supplied user ID is accepted. Connection preserves the current session. Only one USOS identity per Supabase account is supported.

**Disconnect USOS** removes the encrypted link after confirmation. Establish another working sign-in method first, especially if your account uses a synthetic address. Otherwise disconnecting your only provider can leave you unable to return to the same account. The app does not migrate tasks between accounts.

Denial, expired/reused requests, provider failures and linking conflicts return a fixed friendly message on Login. Start a new flow after expiry. Multiple simultaneous starts in the same browser replace its active binding, so finish one flow at a time.

## Security and operations

- OAuth uses HMAC-SHA1 signatures, random nonces, a random HttpOnly/SameSite=Lax browser binding, ten-minute request-state expiry and consume-once checks. Production cookies are Secure and host-only. Start/callback and account routes have per-IP rate limits and authentication responses use `Cache-Control: no-store`.
- The final token hash travels only in `/auth/usos#...`, never a query parameter. The return page immediately clears the fragment and checks the browser-bound completion grant before calling Supabase `verifyOtp`. Automatic URL-session detection is disabled on that return route. Never add analytics, request-body logging or fragment logging to authentication flows.
- Request secrets and completion grants are held in memory. Use one Node process, or sticky routing that keeps start, callback and completion on the same process. A restart expires pending logins; the user can retry. Multiple independent replicas without sticky routing need a shared service-only state store before use.
- `usos_accounts` stores AES-256-GCM envelopes with distinct random IVs and authenticated identity/provider/owner context. The browser can SELECT only its own `id`, `user_id`, `usos_user_id` and `created_at`; secret columns are not granted. Only the service role writes. Anonymous access is revoked. Account export includes the USOS ID and safe metadata only; account deletion cascades.
- Keep one institution configured per deployment. Stored institution bases prevent unrelated universities with overlapping user IDs from taking over existing links. Changing institutions requires an explicit migration plan.
- Changing `USOS_TOKEN_KEY` does not re-encrypt existing rows. Keep the old key until a controlled server-side rotation can decrypt and re-encrypt them; fresh successful authorizations replace saved credentials. Do not expose ciphertexts as public account data.
- Disable access/body logging for these routes in hosting/proxy tooling; OAuth request tokens and callback verifiers appear in provider protocol URLs. The application never logs provider responses, credentials, cookies or OTP hashes. Auth errors use fixed public codes.

## Verification

Run `npm run typecheck`, `npm test`, and `npm run build`. Tests mock USOS and Supabase administration, verify a published OAuth signature vector, AES-GCM tamper rejection, browser binding/expiry/replay, email-linking rules, safe fragment completion, account export and SQL column/RLS isolation. Real deployment validation requires your institution's approved consumer and a test account.
