# Changelog
Add one line per change: date, what changed, who (Claude/Codex/you).

- 2026-10-26: Added a one-time per-account local/demo workspace import dialog, atomic retry-safe Supabase import with category label mapping, safe local-key cleanup, and PostgreSQL/browser lifecycle tests. Apply the updated SQL migration. (Codex)

- 2026-10-26: Added signed-in account JSON export (all saved rows, including full Dante history) and confirmed atomic account deletion with sign-out, desktop/mobile menus, and regression tests; requires the updated Supabase SQL migration. (Codex)

- 2026-10-26: Ran `npm audit fix` without force; reduced audit findings from 17 to 3 with compatible lockfile updates; deferred Vitest 5 migration (remaining Vitest/mocker/Tinypool advisories) because it drops the project's Node 20 support. (Codex)

- 2026-10: Full redesign (Stitch design system), routing, Dante chat + Live voice, PSNC (Qwen + Whisper), offline mode, meetings persistence. (Claude)
- 2026-10: Vitest test suite (31 tests: utils, Dante parsing, Dante actions, server prompt/config), `npm test` in CI; fixed action parsing for JSON arrays. (Claude)
