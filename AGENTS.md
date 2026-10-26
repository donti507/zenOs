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
`LLM_PROVIDER, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_TIMEOUT_MS, STT_MODEL (+STT_BASE_URL, STT_API_KEY), GEMINI_API_KEY, DANTE_RATE_LIMIT, DANTE_ALLOW_ANONYMOUS, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, PORT`. See `.env.example`.

## Known gaps / next work
See `docs/ROADMAP.md`. Biggest: no automated tests, no payments/plans, Google Calendar token expires hourly, main JS chunk ~650 KB.

## Working with two AI agents
- Each task = its own git branch (`feat/…`, `fix/…`). Never let two agents edit the same branch at once.
- Before finishing: update this file if you changed structure, rules or env vars, and add a line to `docs/CHANGELOG.md`.
