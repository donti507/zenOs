# Weekly recaps

## Setup

Apply the complete `supabase-schema-update.sql` after the base schema. In the Supabase SQL editor, paste the whole file, clear any text selection and Run; do not run lines from inside function bodies separately. Recaps and scheduling preferences have own-row SELECT-only RLS, service-only mutations and account-deletion cascades. Exports include both tables.

Keep the existing server-only Supabase URL/service-role key and existing authentication configuration. No new secrets or AI models are needed. Rebuild/deploy the merged changes. `WEEKLY_RECAP_WORKER=true` is the default; set it to `false` only if another server instance handles scheduling or the deployment deliberately uses visit-time catch-up instead. Multiple workers are safe: row locks and `SKIP LOCKED` serialize each account's schedule. Recaps make no LLM requests and consume no Dante daily quota; explicit generation keeps the existing per-minute request limit.

## Schedule and storage

The first Home visit registers the browser's timezone and an automatic Sunday **6 p.m.** schedule. The Home card can turn automatic generation off or back on, and travel/timezone changes are registered on a later Home visit. Scheduling uses database time and the account's IANA timezone, including daylight-saving changes. It runs independently of an open browser once the schedule is registered.

The server checks due schedules every minute and drains batches of 50. It creates a concise as-of-now Sunday snapshot, then advances to the next Sunday at 6 p.m. It must be running with database connectivity to generate while the user is away; a suspended/serverless deployment needs an always-running worker for punctual scheduling. On recovery or the next Home visit, missed schedules catch up to the **latest** due Sunday rather than inventing every missed historical week. A normal Sunday recap includes the week through its generation time; later Sunday work can be included by **Update recap** that day.

**Generate recap / Update recap** works on demand for the current Monday-based week. Repeated updates keep the same week's ID and replace its snapshot; history retains the **latest eight distinct weeks** per account. Pruning and saving are atomic. Scheduled/on-demand races cannot create duplicate weekly rows or a ninth retained recap. Disabling automation does not remove history or prevent manual generation.

Local/demo mode stores independent recaps and preferences in this browser. It makes no recap API or LLM calls. Because no background server can read local tasks, Sunday generation and missed-Sunday catch-up happen when Home is opened/visible. Local recaps are not imported into a cloud account, and account deletion does not erase separately stored local history. Unreadable local history is left intact and reported rather than silently replaced.

## What the recap means

- **Tasks done:** currently completed tasks with a valid completion timestamp in the Monday-based week, up to the snapshot time. Future completion timestamps and other users' tasks are excluded.
- **Best day:** the local date with the most recorded completions; the earliest date wins a tie. No completions means no best day, not a fabricated day.
- **Streak:** consecutive local dates with a recorded completion ending on the recap date or the preceding date, capped at 3,650 days, matching the Home completion-streak rule.
- **What slipped:** tasks still open whose canonical due dates fall within this recap week and are earlier than the current local date. At most three titles are saved with the full count. Today's deadlines are not overdue yet; older backlog is not labelled as this week's slippage.
- **One suggestion:** one short deterministic suggestion based on the recorded workload, slipped tasks and streak. Facts are computed from canonical owned task rows on the server; the client cannot submit owners, counts, task lists, timestamps or an automatic-generation flag.

These are snapshots of available task data, not an immutable task-event audit. Deleted/reopened tasks, missing legacy completion timestamps and rescheduled due dates cannot be reconstructed historically. A late catch-up uses the current task state and available timestamps for that week. No task notes, meeting notes, vault contents or lecture transcripts are included or sent to a provider. Stored titles and all UI text are rendered as escaped text.

## Play recap

**Play recap** reads the saved summary aloud using the same voice URI, language and speed as Dante Live. Live and recap playback share `src/lib/danteVoice.ts` preferences/voice selection. Playback uses browser speech synthesis in sentence-sized chunks; it does not open the microphone, call an LLM, charge quota or create Dante chat messages. It begins only after the user clicks Play, and offers Stop. Browser/OS voice availability controls which voices are available; a missing selected voice falls back the same way as Live.

Changing history, leaving Home, signing out/changing account, or opening Dante Live stops recap playback; late utterance callbacks cannot start another sentence. A card that is idle does not cancel unrelated speech. If the browser lacks speech synthesis or playback fails, the complete written recap remains available.

## Verification

Run `npm run typecheck`, `npm test`, and `npm run build`. SQL tests apply the whole migration twice and cover canonical aggregation, timezone schedules, retries, bounded due jobs, eight-week retention, own-row RLS/service-only writes, account isolation and cascades. Client tests cover local Sunday boundaries/catch-up, manual updates, opt-out, stale-account responses, five-part Home rendering, exact Live voice preferences and playback cleanup. Check Home at 390px in light/dark mode, generate a recap and select history, then play/stop it using a browser with a speech engine installed.
