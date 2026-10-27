# ZEN_OS

A personal productivity dashboard with tasks, a kanban board, calendar (with Google Calendar sync), meetings with a stopwatch and notes, analytics, a link vault, and **Dante**, an AI assistant that can read your data and make changes for you by text or voice.

**Stack:** React 19 + Vite + Tailwind v4 (client) · Express (server) · Supabase (auth + Postgres) · any OpenAI-compatible LLM API (e.g. PSNC) or Google Gemini.

## Quick start

```bash
npm install
cp .env.example .env     # then fill in the values (see below)
npm run dev              # http://localhost:3000
```

Without Supabase configured the app runs in **local mode**: everything is saved in your browser only.

## Configuration

### 1. Dante AI provider

Dante works with any API that speaks the OpenAI `/chat/completions` format, which includes PSNC/PCSS, vLLM, Ollama, LM Studio and OpenRouter.

```env
LLM_PROVIDER="openai"
LLM_BASE_URL="https://<your-endpoint>/v1"    # the part before /chat/completions
LLM_API_KEY="<your key>"
LLM_MODEL="<model name>"
```

To use Gemini instead, set `LLM_PROVIDER="gemini"` and `GEMINI_API_KEY`.

Check the connection at `GET /api/dante/status`; the Dante screen also shows the model name, or the exact configuration problem.

### 2. Supabase

1. Create a project at supabase.com.
2. In the SQL editor run `supabase-schema.sql`, then `supabase-schema-update.sql` (safe to re-run).
3. Put the project URL and anon key in `.env` as both `VITE_SUPABASE_*` (used in dev) and `SUPABASE_*` (used by the server to verify logins and injected into the page in production).
4. For Google sign-in + Calendar: enable the Google provider in Supabase Auth and add the Calendar scopes in Google Cloud. For persistent access, configure server-only `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`, apply the migration, and reconnect Calendar once. See [Google Calendar setup](docs/GOOGLE_CALENDAR.md).

For live workspace updates across devices, apply the latest migration and enable Supabase Realtime. See [Realtime setup](docs/REALTIME.md). Local mode remains browser-only.

## Dante

- Streams answers, with a **Stop** button (or Esc).
- Knows your tasks, meetings, calendar events, vault and streak, plus today's date and your timezone, so "tomorrow at 4" works.
- Can create, complete, reopen and update tasks, schedule meetings, switch views and filter categories. Every change is shown in a card with ✓ or ✗ and the reason.
- **Voice input** with a live transcript and 7 languages (including Polski); it stops automatically after a pause.
- **Read aloud** for answers, with the current sentence highlighted, plus a Listen button on every message.
- **Conversation mode**: hands-free. You speak, Dante answers out loud, then listens again.
- Hides `<think>` reasoning from open models such as Qwen and DeepSeek.

Voice input uses the browser's Web Speech API: it works in Chrome, Edge and Safari, needs HTTPS (or localhost), and the browser sends audio to its own speech service.

Dante can remember short facts/preferences across conversations. Open **What Dante remembers** to inspect or forget them. Apply the updated SQL migration first; see [Dante memory](docs/DANTE_MEMORY.md).

## Security

- `/api/dante` requires a valid Supabase login and is rate-limited (`DANTE_RATE_LIMIT`, default 20/min per user).
- The LLM key never reaches the browser.
- Row Level Security on every table, including `WITH CHECK` on inserts.

## Deploy

```bash
docker build -t zen-os .
docker run -p 3000:3000 --env-file .env zen-os
```

The Supabase URL and anon key are injected at runtime, so the same image works in any environment. See `DEPLOY.md`.

## Scripts

| command | what it does |
|---|---|
| `npm run dev` | dev server with hot reload |
| `npm run build` | build client to `dist/` and bundle the server to `dist/server.cjs` |
| `npm start` | run the production build |
| `npm run typecheck` | TypeScript check |

Lecture recording, transcription and study-guide setup: [docs/LECTURES.md](docs/LECTURES.md). Requires FFmpeg/ffprobe on the server and the latest SQL migration.

Semantic search and Dante source citations: [docs/SEARCH.md](docs/SEARCH.md). Requires pgvector, server embedding configuration and the latest SQL migration.
