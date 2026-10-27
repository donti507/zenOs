# Model Arena

Open **My Space → Model Arena**, choose two different models, enter one prompt and select **Compare models**. Both answers stream side by side, including at 390px. Vote for A or B after both finish successfully. Your leaderboard shows wins and voted rounds for each model, from your own votes only. Voting is final; retrying the same choice after an uncertain response does not count twice. Failed, partial or stopped comparisons cannot receive votes.

## Setup

1. Run the latest complete `supabase-schema-update.sql` after the base schema. It adds `space_arena_rounds`, private voting/ranking RPCs and an atomic two-message reservation RPC. Existing single-message requests remain compatible.
2. Configure the existing AI provider normally (`LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL`, or Gemini). Set server-only `ARENA_MODELS` to **two or three distinct model IDs** supported by that provider, separated by commas. If omitted, `SPACE_MODELS` is used. One model leaves Arena unavailable while ordinary page editing continues to work. Model IDs cannot select another provider URL or key. Example format: `ARENA_MODELS=your-first-model,your-second-model` — replace both with actual supported IDs.
3. Cloud comparisons require the existing server-only `SUPABASE_URL` (fallback `VITE_SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY`. The key creates trusted round/completion metadata and also enables existing daily quota storage; never use a VITE_ service key. Signed-in votes/read ranking use the user's Supabase JWT and RLS. No new external service/package is required.
4. Rebuild/redeploy. `/api/space/arena/status` reports allowed models and readiness without secrets. `POST /api/space/arena/compare` requires existing authentication, per-minute limits, two valid distinct allowed models and a 1–2,000-character prompt. It accepts no owner, cost or provider configuration from the client.

## Daily limit

A comparison reserves **2 messages atomically before either model is called**. If only one remains, the server returns 429 and deducts neither. Concurrent chat, indexing and Arena requests lock the same daily row. Transcription counters are independent. Invalid requests do not reserve messages. Admitted upstream failures, cancellation and storage failures may use both messages; there is no automatic generation retry. UTC reset, server-verified Pro exemption and disabled/anonymous quota behavior remain unchanged. Usage refreshes after each attempt.

## Privacy and local mode

Only the entered prompt is sent to the two configured models. No page code, tasks, notes, memory, account details or tokens are included. Answers render as escaped text; model code/action JSON cannot execute or change workspace data. Both upstream streams cancel when the client disconnects or leaves the tab; switching accounts cancels work and clears private UI state.

Cloud round metadata contains only ID, user ID, two model names, completion status, vote and creation time. Prompts/answers are transient and not saved by the app. Models and completion status are written only by the service role; users can select their own rows and vote only on their own completed rounds. Leaderboards exclude unvoted rounds and contain no other users' votes. Round metadata is included in account export and cascades on account deletion. Provider retention follows your configured provider's policies; never log prompts/answers/secrets.

Local mode keeps vote metadata under `zenos_arena_votes` in this browser; prompt/answers are not persisted. Voting and reading those local results make no Supabase calls, and local votes are not imported into account leaderboards. Generating answers still uses the server and follows its existing anonymous policy; public production servers normally require sign-in (`DANTE_ALLOW_ANONYMOUS=false`). No local daily counter is fabricated. Reloading discards unfinished answers, but retains saved local votes. Stopping/leaving a comparison may race an already completed server call; it does not refund reserved messages.
