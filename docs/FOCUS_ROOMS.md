# Focus Rooms

## Setup before deployment

1. Apply the **complete** `supabase-schema-update.sql` after the base schema in the Supabase SQL editor. Clear any text selection before Run. The migration is idempotent; do not execute individual lines from function bodies.
2. Keep the existing Supabase URL/anon authentication configuration and **server-only** `SUPABASE_SERVICE_ROLE_KEY`. No new secrets, provider calls or quota charges are required. Never expose the service-role key through VITE variables.
3. Enable Supabase Realtime and authenticated private channels. Allow WebSocket/HTTPS traffic to the Supabase host. The migration adds room-specific Presence receive/send policies, restrictive channel-isolation policies, and a private timer invalidation trigger using `realtime.send(jsonb,text,text,boolean)`. No Postgres Changes publication is needed.
4. Build/deploy the merged changes. Open **Focus Rooms** in the sidebar or **Focus with others** on Home (also available on mobile). Test with two signed-in browser profiles using the same invite link.

If SQL warns that the migration role cannot manage `realtime.messages`, Realtime setup is **pending**. The policy/trigger block rolls back together while the remaining migration continues. An authorized Supabase project administrator must apply the complete Focus Rooms Realtime DO block. Never change ownership of the managed table, remove restrictive policies, or install publishers separately. Plain PostgreSQL without Realtime skips that block; API/SQL tests use an outbox and fixture transport, not a live Supabase service. See [Realtime troubleshooting](REALTIME.md).

## Using a room

Create a titled room, copy its `/focus-rooms/:id` invite link, choose a display name, and **Join room**. Joining explicitly shares that name and your current task-completion streak with the other signed-in members. Names are chosen labels, not verified identities. Account emails, tasks, notes, calendar contents, tokens and other workspace data are never shared. Invite links are unguessable UUIDs; anyone signed in who has a link can join. There is no public room directory.

The creator controls **Start together**, **Pause for everyone**, and a confirmed **Reset for everyone**. Everyone derives the same continuous 25-minute focus / 5-minute break cycles from server timestamps. Pause preserves the current phase and progress; reset returns to a paused 25-minute session. Only the connected creator can control the timer; if they leave, the room keeps its last state and they can return through the link. A room timer never changes a task's status or the existing personal focus timer.

Streaks use the same completion rule as Home: consecutive days with at least one currently completed task, ending today or yesterday, capped at 3,650 days. The server calculates each member's streak in the timezone their browser supplies on joining. Only the count is returned. This is a completion streak, independent of the builder activity badge. Updates reconcile at most 30 seconds after task changes, and on presence sync/reconnection/focus.

## Presence and synchronization

`useFocusRooms` owns all API/channel state through ZenosContext. After the verified API admits a session, it opens a **private** `zenos:focus:<room UUID>` Supabase Realtime channel with Presence. It tracks only its opaque session ID. Names and streaks always come from a server-curated roster; client presence fields cannot override them. Members are deduplicated across up to three tabs. The UI intersects observed Presence session IDs with fresh server session leases, dropping stale/unknown sessions; presence is a connection hint, never an authorization or timer source. Other room members can observe and replay Presence payloads, so the two-minute server lease bounds stale indicators rather than treating presence as proof of identity.

Timer controls lock the room and require an expected revision to prevent conflicting host devices overwriting each other. Database broadcasts contain only a revision invalidation, never workspace/account data. Clients read the canonical state after broadcasts, joins and reconnects. A 30-second server heartbeat reconciles missed events and renews the session. Read ordering prevents older snapshots replacing newer state. The countdown uses server time anchored to the browser's monotonic clock with a bounded half-round-trip correction, rather than trusting a device's wall clock. Network delay still limits synchronization precision.

A disconnected channel clears visible presence and disables controls until it reconnects. **Resync timer** fetches canonical state, and **Reconnect room** opens a fresh session. Leaving, navigating away, signing out, changing accounts, or entering local mode removes the channel, cancels requests/timers and best-effort deletes only the captured owner's session. Late events cannot restore previous room state. Browser closure/network loss can leave a session lease for up to 120 seconds; Supabase Presence usually removes it sooner. No room subscription or API write runs in local/demo mode; local tasks and personal focus remain available.

## Expiry and storage

Rooms expire **24 hours after their last server-confirmed join, heartbeat or host timer control**. An open connected room keeps sending heartbeats, including while the tab is backgrounded if the browser permits. A running countdown or read-only request does not keep an empty room alive. Expired rooms disappear from lists and reject join, read, heartbeat, control and Realtime admission. An expired create retry cannot revive the old link. No scheduler is needed: expiry is enforced on every operation. Records are retained as expired metadata until account deletion; this is logical expiry, not a scheduled purge.

Each creator may have 10 active rooms; a room admits 50 live members, with up to three tabs each. Room, membership and session tables have own-row authenticated SELECT-only RLS; all writes and cross-member reads use verified server endpoints and service-only RPCs. Realtime policies admit only users with a fresh session in the exact non-expired room, restrict client sends to Presence, and prevent client-forged timer broadcasts even if older permissive policies exist. Supabase may cache channel authorization until rejoin/token refresh; expiry is independently rechecked by the API and session leases. Existing members already know the invite link and can rejoin while it is valid.

Account exports include your owned room records, own memberships and own sessions. Account deletion cascades memberships/sessions; deleting the creator's account removes their rooms. Remaining browsers fail their next reconciliation and disconnect. No presence payload or room/workspace content is logged.

## Verification

Run `npm run typecheck`, `npm test`, and `npm run build`. Tests cover repeated migration application, own-row isolation/service-only writes, exact-topic Presence policies, broadcast forgery protection, owner controls/revision conflicts, timer phase boundaries, multiple tabs, stale leases, expiry, canonical streaks, local mode, late responses and cleanup. With a real Supabase project, verify two users see each other, share timer controls, survive refresh/network reconnection, and disappear on leave; a third user without joining and an anonymous client must not subscribe to the room topic.
