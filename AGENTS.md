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
Supported: `create_task, complete_task, reopen_task, update_task, create_meeting, switch_view, filter_category`. `context.mode = "voice"` makes replies short and speakable.

## Environment (.env)
`LLM_PROVIDER, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_TIMEOUT_MS, STT_MODEL (+STT_BASE_URL, STT_API_KEY), GEMINI_API_KEY, DANTE_RATE_LIMIT, DANTE_ALLOW_ANONYMOUS, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, PORT, SENTRY_DSN, VITE_SENTRY_DSN, DANTE_DAILY_LIMIT, SUPABASE_SERVICE_ROLE_KEY`. See `.env.example`.

## Known gaps / next work
See `docs/ROADMAP.md`. Biggest: no payments/plans, Google Calendar token expires hourly.

## Working with two AI agents
- Each task = its own git branch (`feat/…`, `fix/…`). Never let two agents edit the same branch at once.
- Before finishing: update this file if you changed structure, rules or env vars, and add a line to `docs/CHANGELOG.md`.

## Account data controls
Signed-in account menus (desktop sidebar and mobile header) expose JSON export and confirmed deletion via `useZenos()`. Export queries every page, including Dante messages outside the UI history limit. Apply `supabase-schema-update.sql` to install `delete_my_account()`: an authenticated-only SECURITY DEFINER function that deletes only `auth.uid()` from auth.users and cascades through all app tables atomically. No service-role key is needed. Local-mode data is kept separate and is not deleted.

## Local workspace import
`LocalImportDialog` offers import after a real account loads successfully, through `useZenos().importLocalWorkspace`. `src/lib/localImport.ts` reads the four local workspace keys, remembers decline per account in this browser, retains a snapshot/batch ID across failures, and clears unchanged imported keys only after success. Theme and local Dante history are retained. Apply `supabase-schema-update.sql` to install the authenticated, RLS-protected `import_local_data` transaction and import receipts. It matches category labels ignoring case/outer whitespace, maps task category IDs, and prevents retry duplicates. Embedded PostgreSQL tests use PGlite; browser lifecycle tests use jsdom.

## Client bundle loading
Login (including password recovery) is lazy with a loading fallback. AppShell lazy-loads Modals, MorningBriefing and DanteLive through `OnFirstOpen`: it defers their first render until opened, then keeps them mounted so close effects, animations and local state survive. Vite groups React/router, Motion and Supabase into separate vendor chunks. The main app chunk is about 60 kB minified (vendor chunks are additional initial downloads).

## Optional Sentry monitoring
`SENTRY_DSN` enables server error reporting at startup. `VITE_SENTRY_DSN` independently enables browser reporting at Vite build/dev time; rebuild/restart to change it. Leave either blank to disable that side completely (no SDK initialization or telemetry requests). The browser DSN is public ingest configuration, never a Sentry API/auth token. Allow your DSN's ingest hostname in network/CSP settings when enabling monitoring. No DSNs are supplied by default. Sentry 10.x preserves the repository’s Node support. The optional browser SDK is a separate async chunk (~468 kB minified) and is not downloaded without VITE_SENTRY_DSN.

`server/monitoring.ts` and `src/lib/monitoring.ts` dynamically load their SDKs only when opted in. Only global errors/unhandled rejections and explicitly captured React/Express/Dante/transcription errors are enabled; request, console, tracing, replay, profiling and session integrations are disabled. Do not add user data, request context, attachments, logging, feedback, replay or new telemetry integrations without reviewing this privacy contract.

`shared/monitoringPrivacy.ts` is the mandatory final `beforeSend` allowlist on both sides: it drops request bodies/URLs/headers/cookies, breadcrumbs, user details, contexts/extras/tags and log messages. Exception text, arbitrary error names, source context, locals, function names and paths are also stripped because they may echo task/note/Dante content. Only standard error types, fixed location labels, numeric stack coordinates, generated event IDs/timestamps and handled status remain. This deliberately limits Sentry diagnostics/grouping; never relax it to upload application content. Message-only events are discarded. Tests inspect a real SDK transport envelope locally without contacting a Sentry project.

## Public landing and authentication
Signed-out visitors to `/` see lazy-loaded `src/pages/Landing.tsx`. Get started links to `/login`, which uses the existing lazy Login screen; protected deep links still show Login, and password recovery takes precedence. Signed-in and local/demo users keep Home at `/`. Public pages are selected with React Router location so legal links and browser history work. Landing is public marketing, not a workspace navigation item; its animations use CSS only under `prefers-reduced-motion: no-preference` (the shared orb also obeys reduced motion). Pricing copy does not implement billing or Pro entitlements; Pro is a disabled coming-soon action. Daily quotas are optional server configuration (see below).

## Daily Dante quotas
Apply `supabase-schema-update.sql` before enabling quotas. `SUPABASE_SERVICE_ROLE_KEY` is a server-only secret used by `server/dailyUsage.ts` with `SUPABASE_URL` (fallback `VITE_SUPABASE_URL`) to count requests. Never expose it through runtime browser config, VITE_ variables or client imports. If the key is missing/blank, daily limits are skipped; anonymous/local sessions also skip per-user database quotas. Existing authentication and per-minute limits still apply. Keep DANTE_ALLOW_ANONYMOUS=false on public deployments so callers cannot opt into unmetered demo requests.

`DANTE_DAILY_LIMIT` is a positive integer (default 20; invalid values fall back to 20). It independently caps chat messages and transcriptions per account per UTC day. Requests admitted by auth and per-minute checks reserve a slot before provider work; malformed chat payloads, upstream errors and user-cancelled calls may consume a slot. Quota-denied requests do not increment. JSON parsing failures before routing are not counted. Days reset at midnight UTC. The service-role-only `consume_dante_usage` RPC locks the user/day row and checks/increments atomically; browser users have read-only access to their own rows under RLS. Counters cascade on account deletion. When enabled storage is unavailable, requests return a friendly 503; exhausted counters return 429 with Retry-After.

GET `/api/dante/usage` requires existing auth, is not cached, and reports only the verified user’s counts/configured limit/reset time (or enabled:false). `ZenosContext.refreshDanteUsage` owns client usage state, refreshes after chat/transcription attempts, on focus and at midnight, and ignores stale account responses. The Dante page shows the actual remaining message allowance and transcription balance; local/disabled sessions never display a fabricated quota.
