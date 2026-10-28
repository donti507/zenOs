# Optional server text-to-speech

## Setup

Apply the complete `supabase-schema-update.sql` to add the private `tts_usage` counter and atomic service-only reservation RPC. Keep existing Supabase authentication and server-only Supabase URL/service-role credentials. Set all four **server-only** environment variables to values supported by a speech provider:

```env
TTS_BASE_URL=https://your-speech-provider.example/v1
TTS_API_KEY=your-private-provider-key
TTS_MODEL=your-speech-model
TTS_VOICE=your-provider-voice
```

The server appends `/audio/speech` to the base URL. The provider must support an OpenAI-compatible JSON speech request and MP3 output; consult its speech model/voice list. A chat model or Whisper transcription model is not a speech-synthesis model. PCSS's listed Whisper speech service is transcription; only configure a PCSS TTS model if its documentation explicitly supports `/audio/speech`. A separate TTS provider is supported without changing chat or transcription configuration.

All four values are required. There is no fallback to LLM/STT keys, model or base URL. Never prefix these variables with `VITE_`, put the provider key in frontend settings or commit a real key. Restart/redeploy after changes. `/api/dante/status` exposes only `tts: true/false`; no TTS key, base URL, model or voice is sent to the client. The flag is true only when synthesis and daily-usage storage are configured.

Without server TTS configuration, Live keeps its existing browser voices and local/demo behavior. No new dependencies are required.

## Endpoint and limits

`POST /api/tts` requires the existing verified Supabase authentication token, even when anonymous Dante AI calls are enabled. JSON:

```json
{"text":"One sentence to speak."}
```

Text is trimmed and bounded to 600 UTF-16 characters. Client-supplied owners, provider URLs, models, voices, keys and limits are ignored. The server forwards only its configured model/voice plus `input` and `response_format: "mp3"` to the configured provider. It sends no Supabase token or user ID upstream. Spoken reply text is sent to that provider; do not log it, audio or authentication headers.

A separate atomic UTC-day allowance uses `DANTE_DAILY_LIMIT` (default **20 paid speech sections per day per free account**). It does not consume chat messages or transcription balance. Verified Pro accounts retain the existing server-side quota exemption. Missing/unavailable usage storage fails closed before provider work. Exhaustion returns 429 with `Retry-After` until midnight UTC. Counters have own-row SELECT-only RLS, service-only writes and account-deletion cascades, like other operational usage counters.

Validation/disabled/auth/concurrency rejections do not reserve a section. Once reserved, provider errors, playback failures, cancellations and prefetched sections can consume it; stopping audio does not refund a reservation. Existing per-minute API rate limiting also applies. At most two simultaneous server synthesis requests per user are admitted per server process; the database daily cap applies across all replicas.

Upstream calls time out after 60 seconds, do not follow redirects, and abort when the client disconnects. Only MP3/generic binary responses are accepted, bounded to 4 MiB per section. The server forwards audio with backpressure as provider chunks arrive, `Content-Type: audio/mpeg`, `Cache-Control: no-store` and `nosniff`. It never persists audio or forwards provider response headers/error bodies. A failure after streaming begins closes the partial response; the client falls back safely.

## Dante Live playback

Live still extracts sentences as the LLM streams its answer. `liveSpeech.ts` queues bounded sections, starts playing the first complete sentence without waiting for the full reply, and prepares **one sentence ahead** while the current sentence plays. The HTTP proxy streams bytes; the browser buffers each bounded sentence into an MP3 Blob for portable playback rather than buffering the whole answer. This keeps playback ordered and bounds memory/provider fan-out. It is not a continuous MediaSource stream or a cache of the entire answer.

The provider's fixed voice comes from `TTS_VOICE`. Live's speed setting applies through the audio element's playback rate. In Voice settings, the browser selector is labelled **Browser fallback voice** when server synthesis is available. A provider error, quota/rate rejection, invalid audio or playback failure switches the remainder of that turn to the selected browser voice and shows a short notice. Already heard parts of a failed sentence can repeat during fallback. If browser speech is unavailable too, the reply stays readable.

Local/demo mode always uses browser voices and makes no `/api/tts` requests. Weekly recap playback and Dante's other browser speech controls keep their existing behavior; enabling Live server speech does not silently send those saved texts to a new provider.

Interrupting, closing Live, navigating, changing accounts or unmounting aborts current/lookahead synthesis, pauses audio, revokes Blob URLs, clears queued speech and resolves pending playback. Late responses/callbacks cannot play in a different conversation or resume its microphone. Only explicit Live voice turns send speech requests; merely checking status or opening settings does not synthesize anything.

## Verification

Run `npm run typecheck`, `npm test` and `npm run build`. Tests cover configuration/auth validation, canonical upstream payloads, streaming before completion, sanitized errors, limits/timeouts/cancellation, SQL repeatability/isolation, ordered bounded prefetch, browser fallback, media cleanup and Live integration/local mode. Deployment verification needs a provider that actually implements MP3 speech synthesis: speak a multi-sentence Live reply, interrupt midway, switch routes, exhaust a test account's budget, and confirm browser fallback. Browser autoplay policy and installed system voices can affect playback.
