# Changelog
Add one line per change: date, what changed, who (Claude/Codex/you).

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
