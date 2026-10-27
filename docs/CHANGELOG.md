# Changelog
Add one line per change: date, what changed, who (Claude/Codex/you).

- 2026-10-27: Added pgvector semantic search over owned task/meeting notes, vault metadata and lecture summaries, revision-safe chunk indexing/backfill with quota-aware background work, validated 1024-dimensional embeddings, responsive source search/previews and a source-citing Dante read tool; retained local text search and added SQL/API/worker/client tests. Apply the migration and configure the embedding provider. (Codex)

- 2026-10-27: Installed FFmpeg/ffprobe explicitly in GitHub CI for real lecture-audio tests and removed a wall-clock race from the processing-session expiry test; validated typecheck, all tests and build with CI's Node 22. (Codex)

- 2026-10-27: Fixed managed Realtime migration compatibility by skipping unnecessary RLS ALTERs and atomically deferring policy/trigger setup on ownership denial, allowing later app tables to migrate without weakening channel isolation; added restricted-role regression coverage and troubleshooting instructions. (Codex)

- 2026-10-27: Added Lectures recording/uploads (60 minutes), FFmpeg sub-10 MB transcription sections, streamed analysis progress, saved summaries/key points/ten reviewable flashcards/action items, duplicate-safe task creation, cloud RLS/atomic RPCs and local IndexedDB persistence; added audio/API/SQL/client regression tests and setup documentation. Apply the migration and install FFmpeg. (Codex)

- 2026-10-27: Added Dante long-term memory with per-user RLS, atomic 100-fact quota and 200-character validation, remember/confirmed forget actions for chat and Live, server-loaded 30-fact prompt data, a responsive inspect/delete panel with mobile composer clearance, local persistence, account export/cascade support and SQL/server/client regression tests. Apply the latest migration. (Codex)

- 2026-10-27: Added per-user private Supabase Realtime Broadcast for tasks/categories/meetings/vault, duplicate-safe state merging and local-write echoes, delete/snapshot race guards, reconnect recovery, sign-out/account/local-mode cleanup, scoped SQL authorization and regression tests. Apply the updated migration and enable Realtime. (Codex)

- 2026-10-27: Added service-role-only Google Calendar refresh-token storage, authenticated offline-consent/refresh/disconnect endpoints, automatic expiry/401 renewal for reads and meeting creation, server restoration and account/disconnect race guards, responsive disconnect controls, setup documentation and API/SQL/client regression tests; local mode remains independent. Apply the migration and reconnect Calendar once. (Codex)

- 2026-10-27: Added optional server-only Stripe subscriptions, authenticated Checkout/portal, signed raw webhooks with atomic retry-safe plan updates, read-only own-profile RLS, server-verified Pro daily-quota bypass, responsive account/pricing/return UI, setup documentation and API/SQL/UI regression tests; disabled billing preserves local mode. Apply the updated SQL migration before enabling. (Codex)

- 2026-10-27: Added an Exam planner to Tasks/Calendar with reviewed, meeting-aware study scheduling, an Exams category, durable topic/checklist tracking, atomic cloud/local saves and overdue re-planning that preserves completed work; added scheduling, SQL, local persistence and modal tests, and bounded icon slots to prevent mobile overflow while fonts load. Apply the updated SQL migration. (Codex)

- 2026-10-27: Added Snap a syllabus on Home/Calendar, authenticated rate-limited vision extraction with a 5 MB image cap, lazy single-page PDF rendering, editable opt-in review and task/exam/meeting creation, with regression coverage. (Codex)

- 2026-10-27: Added atomic/local postpone counting, gentle Home cards after three later-date moves, append-only three-step Dante breakdowns, and a five-minute focus timer that survives workspace navigation; added SQL/date/action/UI tests. Apply the updated SQL migration. (Codex)

- 2026-10-26: Added recurring tasks (daily/weekdays/weekly/monthly), atomic completion successors and monthly anchors, one-time browser reminder permission and foreground scheduling, Dante repeat actions, import preservation, and regression coverage. Apply the updated SQL migration. (Codex)

- 2026-10-26: Added atomic per-user daily Dante chat/transcription quotas, service-role-only counting with RLS, authenticated usage display and refresh, optional server configuration, and SQL/API/UI regression coverage. Apply the updated SQL migration before enabling quotas. (Codex)

- 2026-10-26: Added a lazy public landing page with DanteOrb, six features, three steps, pricing, FAQ and legal links; Get started opens existing Login while signed-in/demo Home and password recovery remain intact; added routing tests and reduced-motion styling. (Codex)

- 2026-10-26: Added opt-in client/server Sentry error monitoring via VITE_SENTRY_DSN/SENTRY_DSN, default-off SDK loading, strict content-scrubbing event allowlists, documentation, and privacy/transport regression tests. (Codex)

- 2026-10-26: Lazy-loaded Login and first-use overlays with Suspense, retained overlay close behavior, and split React/Motion/Supabase vendor chunks; main JS reduced from 679.29 kB to 56.83 kB (gzip 203.85 to 17.53 kB), with lifecycle tests. (Codex)

- 2026-10-26: Added a one-time per-account local/demo workspace import dialog, atomic retry-safe Supabase import with category label mapping, safe local-key cleanup, and PostgreSQL/browser lifecycle tests. Apply the updated SQL migration. (Codex)

- 2026-10-26: Added signed-in account JSON export (all saved rows, including full Dante history) and confirmed atomic account deletion with sign-out, desktop/mobile menus, and regression tests; requires the updated Supabase SQL migration. (Codex)

- 2026-10-26: Ran `npm audit fix` without force; reduced audit findings from 17 to 3 with compatible lockfile updates; deferred Vitest 5 migration (remaining Vitest/mocker/Tinypool advisories) because it drops the project's Node 20 support. (Codex)

- 2026-10: Full redesign (Stitch design system), routing, Dante chat + Live voice, PSNC (Qwen + Whisper), offline mode, meetings persistence. (Claude)
- 2026-10: Vitest test suite (31 tests: utils, Dante parsing, Dante actions, server prompt/config), `npm test` in CI; fixed action parsing for JSON arrays. (Claude)
