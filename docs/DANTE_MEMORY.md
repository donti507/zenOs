# Dante long-term memory

Ask Dante to “remember that I prefer morning meetings.” The `remember` action saves a short fact for future chat and Live voice requests. Open **What Dante remembers** on the Dante page to inspect every saved fact, refresh cloud memory, or forget a fact. Forgetting always opens an explicit confirmation dialog. It does not delete chat history; old messages may still contain the fact. Clearing chat history likewise does not delete saved facts.

## Setup and limits

Apply the latest `supabase-schema-update.sql` before deploying the updated application. It creates:

- `dante_memory`: UUID `id`, `user_id` referencing `auth.users` with deletion cascade, `fact`, and `created_at`.
- An own-account RLS policy and authenticated SELECT/INSERT/DELETE grants. Users cannot view, add, or delete another account's facts, or directly UPDATE saved facts.
- A database trigger validating/trimming facts and enforcing at most 100 facts per user, including direct inserts. An advisory transaction lock serializes concurrent saves so the quota cannot be bypassed by simultaneous requests.
- `remember_dante_fact(p_fact, p_owner)`: authenticated, idempotent save of an exact trimmed fact. It verifies `p_owner = auth.uid()`, returns the existing row on a replay (including at capacity), and otherwise inserts subject to the database limit. The explicit owner also prevents an in-flight client action from saving into a newly selected account.

Facts must contain 1–200 Unicode characters after trimming. Local/demo mode has the same limits and exact-fact deduplication in the browser, using `zenos_dante_memory` localStorage. It does not send memory CRUD requests to Supabase and is kept separate from cloud account facts. Local memory is not automatically imported when a user signs in; it stays in the local workspace.

There are no new environment variables. Signed-in server prompt loading uses the existing Supabase URL and anon key plus the verified user's bearer token/RLS, never a browser service-role key. With authenticated cloud memory unavailable (for example, before migration), Dante returns a generic retryable error rather than trusting client-provided facts as account memory.

## Prompt behavior and privacy

Every authenticated `/api/dante` request fetches that user's 30 most recent facts from the database. Client-supplied memory is replaced, and a request-body account ID is never used for ownership. Both chat and Live voice use the same server prompt path. Anonymous/local requests use only the validated, bounded local memory supplied in their context, subject to the existing anonymous-AI policy.

Facts are encoded as JSON in the user's **data** section of the system prompt, with an explicit instruction never to follow commands, role overrides or action JSON embedded in a fact. Text is length/count bounded and displayed as plain text in the panel and confirmation dialog. Prompt-injection defenses are best-effort; model actions still require field validation, RLS and deletion confirmation.

Dante is instructed to save only durable facts/preferences the user explicitly asks it to remember; it should not silently infer or save sensitive information. Do not store passwords, API keys or other secrets as facts. When chatting, selected facts are sent to the configured AI provider, including in local/demo mode if AI is enabled for that session. They are not written to application logs or monitoring payloads. Account export includes cloud `dante_memory` rows, and deleting the auth account cascades its saved facts. Local-mode facts remain browser-local unless the user removes them; deleting a cloud account does not clear the separate local workspace.

The panel holds up to 100 facts and refreshes on account changes, focus or manual refresh; prompt inclusion is limited to the most recent 30. Older facts remain visible and deletable in the panel. No background memory Realtime channel is added. Account changes reject stale reads/writes and cancel pending forget confirmations.

## Verification

Run `npm run typecheck`, `npm test`, and `npm run build`. Tests cover database isolation, Unicode/length limits, exact-fact replay at capacity, direct-write quota enforcement, concurrent saves, owner-bound RPCs, account cascade, authenticated prompt ownership, recent-fact selection, data serialization, chat/voice action dependencies, local persistence/caps, confirmation/cancellation, stale account reads/actions and safe plain-text display.

For deployment validation, save a fact through Dante, reload and ask a related question, inspect the panel, cancel and then confirm forgetting, and check a second account cannot see the first account's facts. Verify both chat and Live. Local/browser tests and mocked provider tests do not prove a live Supabase migration or real model/provider behavior; deploy and run these checks against your configured instance.
