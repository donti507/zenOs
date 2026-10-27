# Live workspace sync

Tasks, categories, meetings and vault items sync live between devices signed into the same Supabase account. Local/demo mode does not create a channel, and sign-out, local login, account changes and provider unmount remove the old subscription. Late callbacks and cloud reads from an old account are ignored.

## Setup

1. Apply `supabase-schema.sql` and the latest `supabase-schema-update.sql` in your Supabase project's SQL editor. The Realtime additions are idempotent. They install an AFTER INSERT/UPDATE/DELETE trigger on `tasks`, `categories`, `meetings` and `vault_items`, plus scoped policies on `realtime.messages`.
2. Keep your existing Supabase public URL/anon-key and server auth configuration. This feature needs no new secrets and never uses a service-role key in the browser.
3. Enable the project's Supabase Realtime service and allow authenticated private channels. Permit HTTPS/WebSocket traffic to your Supabase project's hostname through your deployment/browser network policy.
4. Test with two devices or separate browser sessions signed into the same account. Create, edit and delete each workspace type and check the other session updates. A different signed-in account must not receive those rows. Disconnect/reconnect the network and check the workspace catches up. Sign out or enter demo mode and verify the old subscription is removed.

This implementation uses **Realtime Broadcast from database triggers**, rather than a Postgres Changes feed. Supabase cannot filter Postgres Changes DELETE events by `user_id`, so that feed cannot satisfy user-only delete subscriptions. Broadcast sends each full change only to the private `zenos:workspace:<user UUID>` topic. No extra publication membership or `REPLICA IDENTITY FULL` is needed on the workspace tables.

The migration requires Supabase's `realtime.messages`, `realtime.topic()` and `realtime.broadcast_changes(...)` support. Plain PostgreSQL test/development databases without `realtime.messages` skip channel/trigger installation. If the Realtime schema is present but Broadcast support is missing, update/enable Supabase Realtime before applying this section; the migration reports the missing capability.

## Isolation

- Database writes remain protected by each source table's existing RLS. A SECURITY DEFINER trigger uses a fixed empty search path and sends to the row's `user_id` topic. Anonymous/unowned rows produce no messages.
- INSERT/UPDATE payloads carry the complete new row; DELETE carries the complete old row, including ownership. An administrative ownership change emits a private DELETE to the old owner and INSERT to the new owner, without revealing the new owner's row on the old topic.
- A receive policy authorizes only authenticated users on their own private workspace topic. Additional restrictive policies prevent existing broad allow policies from authorizing another user's workspace topic or allowing clients to forge workspace broadcast messages. Policies for unrelated topic prefixes are preserved. Database-trigger messages are private by default.
- The client authenticates Supabase Realtime with its existing session, opens exactly one private channel for its signed-in account, and defensively checks payload schema, table, operation, row ID and owner. It never subscribes to a global workspace topic or an unfiltered DELETE feed. No workspace payloads are logged.

## State merging and recovery

`src/lib/workspaceRealtime.ts` shares the database-to-state mappers between initial reads and live updates. It upserts INSERT/UPDATE by primary key, removes DELETE by primary key, maps snake_case task/meeting fields, preserves unrelated UI state, and recomputes the cloud task completion history.

The channel starts after the initial cloud snapshot succeeds. Every SUBSCRIBED notification, including reconnections, reloads only the four workspace tables to close the initial load/join gap and recover missed events. Broadcasts received while a snapshot/task reload is in flight are replayed over that snapshot, so a late response cannot overwrite those changes or resurrect deleted rows. Recovery leaves chat history alone and does not seed categories when the authoritative category list is empty.

Local create responses may arrive before or after their own Realtime echo. Inserts check for existing IDs and preserve newer event data, and observed delete tombstones prevent a delayed create response from resurrecting a remotely deleted row. This is live synchronization of server-authoritative cloud data; it does not add offline cloud-write queuing or conflict-resolution UI. During a connection failure the existing sync error display asks users to reload; Supabase's normal reconnect path reloads the current workspace automatically when it rejoins.

Run `npm run typecheck`, `npm test`, and `npm run build`. Automated tests cover row mapping, duplicate/local-echo ordering, delete tombstones, snapshot races, reconnect recovery, account changes, sign-out, local mode, migration repeatability, per-user SQL policies, client-forgery rejection and ownership transfers. SQL tests replace the external Realtime service with an outbox using Supabase's documented Broadcast function signature/payload. Live delivery against a configured Supabase project still needs the two-device check above.
