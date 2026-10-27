# Persistent Google Calendar connection

Calendar access tokens expire after roughly one hour. ZEN OS now keeps the Google **provider refresh token** in a private server-side Supabase table and obtains fresh access tokens automatically. This is separate from the Supabase session refresh token; never send the Supabase `refresh_token` to the Google endpoint.

## Setup

1. Enable Google Calendar API in your Google Cloud project. Configure a Web application OAuth client and the consent screen, adding Calendar scopes and your production domains. Use the same OAuth client configured for the Google provider in Supabase Auth. The Google authorized redirect URI remains the Supabase Auth callback (`https://<project>.supabase.co/auth/v1/callback`); allow your app's `/calendar` redirect in Supabase's redirect URL configuration.
2. Apply `supabase-schema.sql`, then `supabase-schema-update.sql`. The new idempotent `google_tokens` table has an `auth.users` foreign key with `ON DELETE CASCADE`. RLS is enabled, with all access revoked from `PUBLIC`, `anon` and `authenticated`; only the service role can read or mutate it. Do not add browser-facing policies or include it in account JSON exports.
3. Configure these **server-only** variables in your deployment secret store, and restart the server:

   | Variable | Purpose |
   | --- | --- |
   | `GOOGLE_CLIENT_ID` | OAuth Web client ID matching Supabase's Google provider |
   | `GOOGLE_CLIENT_SECRET` | Secret for that same OAuth client |
   | `SUPABASE_SERVICE_ROLE_KEY` | Private database access for token storage; shared with other server features |
   | `SUPABASE_URL` | Supabase project URL (`VITE_SUPABASE_URL` is an existing fallback) |
   | `SUPABASE_ANON_KEY` | Existing server authentication configuration used to verify Supabase bearer tokens |

   Never prefix private Google settings or the service-role key with `VITE_`, commit real values, or include them in browser runtime config. Client ID/secret must belong to the Google account/project that issued the refresh token. Local/demo mode does not need these variables and cannot connect Calendar.
4. Allow outbound HTTPS to `oauth2.googleapis.com` from the server and to your Supabase project. The browser continues to call `www.googleapis.com` for Calendar reads and meeting creation. Serve production over HTTPS. Exclude token endpoint bodies/responses and Authorization headers from reverse-proxy/APM logging and caching.
5. In Calendar, choose **Connect** and approve Calendar permissions. The consent request includes `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`, and the Calendar scopes. Supabase returns `provider_refresh_token` as part of the OAuth session; the client transfers it over authenticated HTTPS to `/api/google/connect`. The application does not add Google credentials to its localStorage data keys. Supabase itself manages its OAuth session storage.

Existing installations must reconnect once after deploying this migration to provide offline consent; the old one-hour access token cannot be converted into a refresh token. Google may omit refresh tokens from a plain Google sign-in. The dedicated Connect action deliberately requests consent again. For external Google apps left in **Testing**, Calendar refresh tokens generally expire after seven days; publish/verify the consent app as required for durable production access. Revoked consent, password/security changes, inactive grants and Google's token limits can also require reconnecting.

## Endpoints and behavior

All endpoints use `requireUser` and additionally reject local/anonymous identities. The account ID comes from the verified Supabase token only; request-body user IDs are ignored.

- `POST /api/google/connect`: accepts `{ "provider_refresh_token": "…" }` from explicit Calendar consent, validates it with Google and checks Calendar scope before storing it with the service role. Missing or rejected credentials never overwrite an existing valid connection. Returns only `{ access_token, expires_in }`, with `Cache-Control: no-store`.
- `POST /api/google/token`: reads that account's stored refresh token, sends the OAuth refresh grant to Google's fixed HTTPS endpoint using the server client ID/secret, and returns only a fresh access token and its lifetime. The request does not accept another account's token/ID. Rotated refresh tokens are saved privately. A conditional UPDATE cannot recreate a row deleted or replaced while refresh is running. The server serializes same-account uploads, refreshes and deletes within one process; conditional writes also protect refreshes across server replicas.
- `DELETE /api/google/token`: deletes only that account's stored credential and returns 204; repeated deletion is safe. It remains available when Google client configuration is removed, as long as Supabase service access still works. The client clears cached Google access, events and in-flight read results. It does not delete Google events or sign the user out of ZEN OS. This removes the app's stored connection; it does not revoke the OAuth grant at Google or invalidate already issued access tokens. Users can revoke the grant in their Google account's third-party access settings as well.

The client restores a stored connection automatically after login/reload, shares concurrent refresh requests, caches access only in memory and refreshes with a one-minute expiry margin. Calendar reads and meeting creation request a valid token on demand. A Google 401 triggers one fresh-token retry; failed writes are not retried on network errors or 5xx responses, to avoid duplicate meetings. Expired cached tokens refresh on browser focus as well. Account/local-mode switches and disconnects invalidate late responses. Connect/Disconnect controls use the existing design system and responsive layout.

A missing connection returns 404; revoked/invalid offline consent returns 401 with `reconnect:true`. Invalid stored consent is removed conditionally, without deleting another concurrent connection. Transient Google/database errors return a generic 503 and retain stored credentials. Provider bodies, access/refresh tokens and client secrets are never logged or echoed in error messages. Existing per-minute API rate limiting applies to connect/refresh requests.

## Validation

Run `npm run typecheck`, `npm test`, and `npm run build`. Tests exercise API ownership, no-secret error responses, token rotation and expiry, invalid consent, concurrent refresh/disconnect, private-table grants and account-deletion cascade, StrictMode/reload behavior, expired-token retry for reads and meeting creation, account switches, local mode and disconnect controls without real Google credentials.

For live verification, configure a Google test account and the matching server credentials, connect once, and reload the app to verify server restoration. Keep the app open past the one-hour access-token lifetime and check Calendar navigation/meeting creation still work. Disconnect and confirm the private row is removed and events disappear; reconnect and revoke consent at Google to check the reconnect path. Live Google OAuth is not covered by mocked tests.
