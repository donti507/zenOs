# AGENTS.md — ZEN OS

Read this first. It is the single source of truth for any AI agent (Codex, Claude, others) or human working on this repo. Keep it up to date when you change architecture.

## What this is
ZEN OS: productivity web app (tasks, kanban, calendar, meetings, analytics, vault) with **Dante**, an AI assistant that reads the user's data and can change it, by text or voice ("Dante Live").

## Stack
- Client: React 19, Vite, Tailwind CSS v4, `motion` (Framer Motion), React Router 7. TypeScript everywhere.
- Server: Express (`server.ts`), bundled with esbuild to `dist/server.cjs`.
- Data/auth: Supabase (Postgres + RLS). Without Supabase the app runs in **local mode** (localStorage).
- AI: any OpenAI-compatible API (currently PSNC: `https://llm.hpc.psnc.pl/v1`, chat `Qwen3.8-27B`, speech `whisper-large-v3-turbo:0.8b`), or Gemini.

## Commands
```bash
npm install
npm run dev        # http://localhost:3000 (Vite middleware + API)
npm run typecheck  # must pass before every commit
npm run build      # must pass before every commit
npm start          # production build
```

## Folder map
```
server.ts                 Express app: /api/dante (SSE chat), /api/dante/status, /api/transcribe, SPA + runtime config injection
server/llm.ts             Provider-agnostic streaming (openai-compatible | gemini)
server/prompt.ts          Dante system prompt + action protocol + voice mode
server/auth.ts            Supabase JWT check, rate limit, anonymous mode
server/stt.ts             Speech-to-text proxy (Whisper-style)
src/App.tsx               Routes (lazy pages), auth gate, password recovery
src/context/ZenosContext.tsx   ALL app state + CRUD (Supabase or localStorage). Use its functions; never call supabase from pages.
src/lib/accountData.ts     Complete paginated account export + self-deletion RPC (called through ZenosContext)
src/lib/routes.ts         view <-> URL map (state.view stays in sync with the URL via RouteSync)
src/lib/dante.ts          client streaming, context builder, action parsing, text helpers
src/lib/danteActions.ts   executes Dante actions (shared by chat + Live)
src/lib/utils.ts          dates (localDateStr/today/relDay), streak, categoryTone
src/components/layout/    AppShell (sidebar, header, mobile nav, RouteSync), Sidebar, Header
src/components/ui/kit.tsx Design-system primitives: card, btn.*, input, Modal, Field, PageHeader, EmptyState, Segmented, CategoryChip, Icon
src/components/DanteLive.tsx   Full-screen voice assistant
src/components/views/DanteAI.tsx  Dante chat page
src/pages/*.tsx           Home, Tasks, Board, Calendar, Meetings, Analytics, Vault, Login
supabase-schema*.sql      DB schema + idempotent migration (run both)
```

## Rules (important)
1. **State goes through `useZenos()`.** Add new data types to `ZenosContext` with BOTH paths: Supabase (when online) and localStorage (when `isOffline`). Copy the pattern of `addMeeting/updateMeeting/deleteMeeting`.
2. **New DB table?** Add it to `supabase-schema-update.sql` idempotently (`IF NOT EXISTS`), with RLS `USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`.
3. **UI uses the design system.** Colors only via tokens (`bg-surface-container-lowest`, `text-on-surface`, `text-on-surface-variant`, `bg-primary`, `bg-primary-container`, `text-error`, `bg-success-container`…), defined in `src/index.css` for light AND dark. Reuse `kit.tsx`. No hex colors in components except category/brand gradients. Every new screen must look right in dark mode and at 390px width.
4. **New page:** create `src/pages/X.tsx`, add a lazy route in `App.tsx`, an entry in `src/lib/routes.ts`, and a nav item in `Sidebar.tsx` (and `AppShell` mobile tabs if primary).
5. **Dante can do something new:** add the action to the list in `server/prompt.ts` AND implement it in `src/lib/danteActions.ts`. Validate every field (never trust model output). Never add destructive actions without a confirmation step.
6. **Secrets:** never commit `.env`; never put keys in client code. Only `VITE_*` and Supabase anon key may reach the browser. All LLM calls go through the server.
7. **Dates:** use `today()` / `localDateStr()` (local time). Never `toISOString().split('T')[0]`.
8. **Accessibility:** buttons need labels (`aria-label` for icon buttons), modals via `Modal`, respect `useReducedMotion()`.
9. Keep changes small and focused. One feature per branch/PR. Run `npm run typecheck && npm run build` before committing.

## Dante protocol (summary)
Client sends `{messages, context}` to `POST /api/dante` → server builds the system prompt (`server/prompt.ts`) from the context and streams SSE `data: {"text": "..."}` … `data: [DONE]`. When the model changes data it ends its reply with:
```json
{"actions":[{"action":"create_task","data":{"title":"…","date":"YYYY-MM-DD","cat":"…"}}]}
```
Supported: `create_task, complete_task, reopen_task, update_task, add_task_steps, create_meeting, switch_view, filter_category`. `context.mode = "voice"` makes replies short and speakable.

## Environment (.env)
`LLM_PROVIDER, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_TIMEOUT_MS, VISION_MODEL, STT_MODEL (+STT_BASE_URL, STT_API_KEY), GEMINI_API_KEY, DANTE_RATE_LIMIT, DANTE_ALLOW_ANONYMOUS, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, PORT, SENTRY_DSN, VITE_SENTRY_DSN, DANTE_DAILY_LIMIT, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET`. See `.env.example`.

## Known gaps / next work
See `docs/ROADMAP.md`. Persistent Google Calendar access is documented in docs/GOOGLE_CALENDAR.md. Optional Stripe subscriptions are documented in docs/BILLING.md.

## Working with two AI agents
- Each task = its own git branch (`feat/…`, `fix/…`). Never let two agents edit the same branch at once.
- Before finishing: update this file if you changed structure, rules or env vars, and add a line to `docs/CHANGELOG.md`.

## Account data controls
Signed-in account menus (desktop sidebar and mobile header) expose JSON export and confirmed deletion via `useZenos()`. Export queries every page, including Dante messages outside the UI history limit. Apply `supabase-schema-update.sql` to install `delete_my_account()`: an authenticated-only SECURITY DEFINER function that deletes only `auth.uid()` from auth.users and cascades through all app tables atomically. No service-role key is needed. Local-mode data is kept separate and is not deleted.

## Local workspace import
`LocalImportDialog` offers import after a real account loads successfully, through `useZenos().importLocalWorkspace`. `src/lib/localImport.ts` reads the four local workspace keys, remembers decline per account in this browser, retains a snapshot/batch ID across failures, and clears unchanged imported keys only after success. Theme and local Dante history are retained. Apply `supabase-schema-update.sql` to install the authenticated, RLS-protected `import_local_data` transaction and import receipts. It matches category labels ignoring case/outer whitespace, maps task category IDs, and prevents retry duplicates. Embedded PostgreSQL tests use PGlite; browser lifecycle tests use jsdom.

## Client bundle loading
Login (including password recovery) is lazy with a loading fallback. AppShell lazy-loads Modals, MorningBriefing and DanteLive through `OnFirstOpen`: it defers their first render until opened, then keeps them mounted so close effects, animations and local state survive. Vite groups React/router, Motion and Supabase into separate vendor chunks. The main app chunk is about 73 kB minified (vendor chunks are additional initial downloads).

## Optional Sentry monitoring
`SENTRY_DSN` enables server error reporting at startup. `VITE_SENTRY_DSN` independently enables browser reporting at Vite build/dev time; rebuild/restart to change it. Leave either blank to disable that side completely (no SDK initialization or telemetry requests). The browser DSN is public ingest configuration, never a Sentry API/auth token. Allow your DSN's ingest hostname in network/CSP settings when enabling monitoring. No DSNs are supplied by default. Sentry 10.x preserves the repository’s Node support. The optional browser SDK is a separate async chunk (~468 kB minified) and is not downloaded without VITE_SENTRY_DSN.

`server/monitoring.ts` and `src/lib/monitoring.ts` dynamically load their SDKs only when opted in. Only global errors/unhandled rejections and explicitly captured React/Express/Dante/transcription errors are enabled; request, console, tracing, replay, profiling and session integrations are disabled. Do not add user data, request context, attachments, logging, feedback, replay or new telemetry integrations without reviewing this privacy contract.

`shared/monitoringPrivacy.ts` is the mandatory final `beforeSend` allowlist on both sides: it drops request bodies/URLs/headers/cookies, breadcrumbs, user details, contexts/extras/tags and log messages. Exception text, arbitrary error names, source context, locals, function names and paths are also stripped because they may echo task/note/Dante content. Only standard error types, fixed location labels, numeric stack coordinates, generated event IDs/timestamps and handled status remain. This deliberately limits Sentry diagnostics/grouping; never relax it to upload application content. Message-only events are discarded. Tests inspect a real SDK transport envelope locally without contacting a Sentry project.

## Public landing and authentication
Signed-out visitors to `/` see lazy-loaded `src/pages/Landing.tsx`. Get started links to `/login`, which uses the existing lazy Login screen; protected deep links still show Login, and password recovery takes precedence. Signed-in and local/demo users keep Home at `/`. Public pages are selected with React Router location so legal links and browser history work. Landing is public marketing, not a workspace navigation item; its animations use CSS only under `prefers-reduced-motion: no-preference` (the shared orb also obeys reduced motion). Pro remains unavailable unless the server reports billing enabled. Optional Stripe Checkout/portal and webhook-backed entitlements are documented in docs/BILLING.md. Daily quotas are optional server configuration (see below).

## Daily Dante quotas
Apply `supabase-schema-update.sql` before enabling quotas. `SUPABASE_SERVICE_ROLE_KEY` is a server-only secret used by `server/dailyUsage.ts` with `SUPABASE_URL` (fallback `VITE_SUPABASE_URL`) to count requests. Never expose it through runtime browser config, VITE_ variables or client imports. If the key is missing/blank, daily limits are skipped; anonymous/local sessions also skip per-user database quotas. Existing authentication and per-minute limits still apply. Keep DANTE_ALLOW_ANONYMOUS=false on public deployments so callers cannot opt into unmetered demo requests.

`DANTE_DAILY_LIMIT` is a positive integer (default 20; invalid values fall back to 20). It independently caps chat messages and transcriptions per account per UTC day. Requests admitted by auth and per-minute checks reserve a slot before provider work; malformed chat payloads, upstream errors and user-cancelled calls may consume a slot. Quota-denied requests do not increment. JSON parsing failures before routing are not counted. Days reset at midnight UTC. The service-role-only `consume_dante_usage` RPC locks the user/day row and checks/increments atomically; browser users have read-only access to their own rows under RLS. Counters cascade on account deletion. When enabled storage is unavailable, requests return a friendly 503; exhausted counters return 429 with Retry-After.

GET `/api/dante/usage` requires existing auth, is not cached, and reports only the verified user’s counts/configured limit/reset time (or enabled:false). `ZenosContext.refreshDanteUsage` owns client usage state, refreshes after chat/transcription attempts, on focus and at midnight, and ignores stale account responses. The Dante page shows the actual remaining message allowance and transcription balance; local/disabled sessions never display a fabricated quota.

## Recurring tasks and browser reminders
Tasks optionally carry recurrence (`none`, `daily`, `weekdays`, `weekly`, `monthly`), a monthly anchor day and a predecessor ID. Apply `supabase-schema-update.sql`: its authenticated/RLS-respecting completion trigger creates the next occurrence atomically on an open → done status transition. A per-user predecessor index deduplicates concurrent/reopened completions while the successor exists. Already-done tasks created/imported as history do not spawn occurrences. Local mode uses matching calendar logic in `src/lib/recurrence.ts` through ZenosContext, preserving localStorage. Calendar dates advance from the prior due date (including overdue dates), weekdays skip weekends, monthly recurrence clamps short months while retaining the original day. Each successor resets status/progress/checklist/completion time and shifts its reminder by the same calendar-day offset; notes/category/rule are retained. Changing a rule affects future successors; existing occurrences are not removed. Local imports remap predecessor IDs and preserve recurrence metadata.

Dante create_task/update_task accept validated `repeat` values and map them to recurrence; prompts/context include repeat metadata. Completing a recurring task already creates its successor; Dante must not create a second successor action.

`useTaskNotifications` runs in ZenosContext for both cloud and local users. The task modal asks native notification permission once from a save gesture when a reminder is present; existing reminder users see a dismissible enable prompt in the workspace. Permission choices are remembered per browser, never requested on mount/timer, and denied/dismissed prompts are not repeated. Browser site settings can enable permission later. Notifications use local reminder wall time, include only task titles (no notes/Dante content), deduplicate using receipt metadata and browser tags, and cancel/reschedule when tasks or users change. Old reminders from before login are not replayed; reminders missed while the app stays open can fire on focus/wake. Notifications require a supporting browser/secure context and are best-effort while the app is open; no service worker/background delivery is installed. Some mobile browsers cannot construct foreground notifications and are handled without crashing. Theme, reduced-motion behavior and local data remain independent of notification permission.

## Postponed tasks and a five-minute start
Apply `supabase-schema-update.sql` for `tasks.postponed_count` and its BEFORE UPDATE trigger. A move from one valid YYYY-MM-DD due date to a later valid date increments the counter atomically; first scheduling, clearing, equal/earlier dates and invalid dates do not. History never decreases on earlier edits; stale counter patches cannot reset it. Cloud reads map it to Task.postponedCount. Local edits use the same rules in `applyPostponement` through ZenosContext. Legacy/new tasks default to zero, imports retain recorded history, and new recurring occurrences reset to zero. No past counts can be inferred/backfilled from the current due date.

Home shows a gentle card for each open task postponed at least three times. Break it down with Dante hands off an ID-specific prompt to `/dante` requesting exactly three tiny checklist steps. The validated `add_task_steps` action appends short labels through editTask, preserves existing checklist states and other fields, and deduplicates replays; it never creates separate tasks or replaces the checklist. Start 5-min focus starts a single context-owned task/deadline session. A shared design-system timer survives workspace navigation, derives remaining time from the deadline so tab throttling does not accumulate drift, announces completion once, supports stopping, and clears on account change/logout. Timer ticks render only the timer; task status is not automatically changed. A full reload ends this ephemeral timer.

## Snap a syllabus
Home and Calendar open a lazy SnapDialog for JPEG/PNG/WebP photos or a PDF page. Source files and prepared images are limited to 5 MiB. PDFs are rendered locally with lazily loaded PDF.js 4.x and its same-origin worker (isEvalSupported:false); users choose one page, rasterized to JPEG at at most 2000px on its longest edge. The PDF itself and filename are never sent to the model. The small trigger loads with Home/Calendar; SnapDialog and the PDF renderer/worker are deferred until used.

POST `/api/snap` accepts raw image bytes (Content-Type image/jpeg, image/png or image/webp), not multipart, PDFs, image URLs or JSON. It uses the same requireUser/anonymous-mode policy and shared per-minute rateLimit as Dante, before a bounded image parser. Signatures and the 5 MiB bound are checked server-side. It calls the OpenAI-compatible LLM_BASE_URL chat/completions endpoint with the server-only LLM_API_KEY (and LLM_EXTRA_HEADERS), using VISION_MODEL (default Qwen3-VL-235B-A22B-Instruct-FP8), a text prompt and a data-URL image_url message. LLM_MODEL/Gemini do not replace the vision model. Snap does not consume the daily chat/transcription counters. Upstream work times out/cancels on disconnect; provider/document data is not echoed in errors or monitoring.

Responses contain only validated `{items:[{title,date,type}]}` suggestions (at most 50, types task/exam/meeting). Uncertain dates stay empty and must be filled or unchecked. No upload is saved by the app and no data is created until review. Edited selections use existing ZenosContext addTask/addMeeting functions; exams become tasks prefixed “Exam: ”, meetings have no time set, and created rows are disabled to prevent replay within the review. Partial failures remain retryable with a warning to check the workspace. Close/change-account aborts reading and stops subsequent creates; completed writes remain. Local mode uses the normal local CRUD paths, with extraction still subject to the server's auth policy. A configured vision provider is required; no new database migration is needed. Explain the selected page is sent to the configured AI provider; never log image bytes, extracted content, filenames or credentials.

## Exam planner
Tasks and Calendar expose a lazy ExamPlannerDialog. `src/lib/examPlanner.ts` contains deterministic calendar scheduling: one topic per task/checklist step, blocks of min(25, daily budget) minutes, balanced across available local days from today through the day before the exam. Days with at least two meetings are excluded; linked Google events are deduplicated. Capacity errors require a larger budget or later exam; topics are never silently dropped. The review precedes all writes.

Apply `supabase-schema-update.sql` for `tasks.exam_plan` and authenticated SECURITY INVOKER `save_exam_plan`. Context saves the category and sessions atomically (cloud transaction/local state update), reuses Exams by case-insensitive label, and preserves metadata through local imports. Cloud saves enforce owner identity, RLS, per-user locking, daily budget and a stale-snapshot guard. The caller passes today's local date, bounded to within one day of the database date for timezone differences. Retrying initial creation with the same plan ID does not duplicate tasks. Refresh after an uncertain re-plan response before retrying.

Task.examPlan stores plan ID, exam name/date, daily budget and stable topic ID; checklist steps optionally have IDs. Re-plan appears when any unfinished topic is overdue and moves all remaining topics in place, preserving task IDs, notes and checklist states. Done tasks and checked topic steps stay untouched. Re-plan allows updating the exam date/budget; remaining topics remain fixed. New recurring occurrences do not inherit exam metadata. The planner window is at most 730 days with 1–100 topics; it estimates one study block per topic rather than inferring topic difficulty.

## Stripe billing
`server/billing.ts` owns optional Stripe Checkout, portal, signature-verified raw webhooks and server-side plan lookup. Server-only `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, Supabase URL and `SUPABASE_SERVICE_ROLE_KEY` are required to enable billing. `BILLING_APP_URL` optionally overrides the trusted redirect origin (default https://zenose.tech). Never use VITE_ Stripe secrets. Apply the updated SQL migration before enabling billing: `profiles` allows own-row SELECT only; service-role-only writes and `apply_stripe_billing_event` enforce atomic event receipts, ordering and optimistic concurrency. Only current Stripe subscriptions for the configured price grant Pro; browser returns/metadata/client plan claims never do. Pro bypasses daily Dante limits, preserving authentication and per-minute limits. Disabled billing and local mode preserve the existing workflow.

Billing state/actions go through `useZenos()`. Account menus show Upgrade to Pro or Manage subscription, and free customers retain portal access. Lazy `/billing/upgrade`, `/billing/success`, `/billing/cancel` pages are account flows rather than primary navigation; success polls server activation. See docs/BILLING.md for Stripe setup, test/live separation and account deletion/cancellation responsibilities.

## Persistent Google Calendar
`server/google.ts` owns authenticated `POST /api/google/connect`, `POST /api/google/token`, and `DELETE /api/google/token`. The private `google_tokens` table is service-role-only, with **no client RLS policies, not even SELECT**; this is an intentional exception to the general own-row policy rule. Apply the migration and set server-only GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET matching Supabase's Google OAuth client, plus SUPABASE_SERVICE_ROLE_KEY. Never return/log provider refresh tokens or secrets. Disconnect deletes stored access, not Google events or the Google OAuth grant.

`useGoogleCalendar` manages only in-memory access tokens, explicit consent transfer, server restoration, expiry and in-flight/account-change guards through ZenosContext. Calendar clients use `getGoogleAccessToken` rather than a captured token for reads/writes, and gate UI on `googleConnected`. A definitive Google 401 is retried once after refresh; no automatic retries of uncertain writes. Local mode makes no Google token requests. Existing users reconnect once for offline consent; Google OAuth Testing-mode tokens may expire after seven days. See docs/GOOGLE_CALENDAR.md.

## Workspace Realtime
`src/lib/workspaceRealtime.ts` shares cloud row mapping and duplicate-safe change merging. ZenosContext subscribes to a single private `zenos:workspace:<user UUID>` Broadcast channel only for a loaded signed-in cloud account; it removes that channel on sign-out/account/local-mode changes and ignores late callbacks/reads. Source-table triggers and scoped receive/publisher policies in the SQL migration authorize only that user's rows, including DELETE (Postgres Changes cannot filter deletes). Never replace this with a global/unfiltered delete feed or enable client publishing on this topic prefix.

On channel join/rejoin, reconcile only the four workspace tables and replay broadcasts received during the read. Preserve chat/UI state, task field mappings/completion history and idempotent mutation responses; local mode stays independent. Apply the SQL migration and enable Supabase Realtime before live testing; see docs/REALTIME.md.
