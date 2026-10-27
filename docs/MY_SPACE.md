# My Space

Open **My Space** (`/space`) to create a private page with a title and a lowercase, hyphen-separated address. Pages live at `/space/:slug`, appear in the desktop sidebar and are available from the mobile Space tab. A slug belongs to an account: another account can use the same slug without seeing your page. There is no public/sharing route.

Describe an edit in **Build with AI**, choose a permitted model and send it. Each completed edit stores a full HTML/CSS/JS snapshot and the request/reply as a save point. Refresh recovers an edit whose response was interrupted. Retrying the same completed edit reuses its request ID without another provider call or quota reservation. Local drafts survive a failed IndexedDB save in memory so Retry can save without regenerating; leaving/reloading before that save loses the unsaved draft.

The timeline loads 30 versions at a time and **Load older versions** reaches the entire history. Restore adds a new save point with the selected old code; it does not erase later history. Restoring and every AI edit turn data permissions off. Concurrent stale edits/restores/grants fail rather than overwriting another device's new version. Page title/address metadata is fixed after creation in this release; AI edits change the page's rendered contents. Page deletion/renaming and public sharing are not included.

## Setup

1. Apply the latest complete `supabase-schema-update.sql` after the base schema. It creates private `space_pages` and `space_page_versions`, RLS, owner-bound atomic RPCs and account-deletion cascades. Both tables are included in account JSON exports. Clients can read only their own rows; direct client table writes are denied. RPCs derive the owner from `auth.uid()` and enforce expected version IDs. No service-role key is needed for My Space saves.
2. Use the existing chat-provider configuration (`LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, or Gemini settings). Server-only `SPACE_MODELS` optionally lists **one to three** comma-separated model IDs supported by that same provider; it defaults to the active chat model. Example: `SPACE_MODELS=Qwen3.8-27B`. Add only model IDs your provider exposes. It cannot select another provider URL or API key. Restart after configuration changes.
3. `GET /api/space/status` lists the allowed models and availability without exposing credentials. `POST /api/space/pages/:id/edit` uses `requireUser`, per-minute limits and the existing daily message reservation. Invalid/unowned/stale requests and confirmed cached retries do not invoke the model or consume a new daily allowance. An admitted generation/save failure or cancellation may consume one allowance. Server-verified Pro exemption is preserved.
4. Deploy/rebuild the app. No new external runtime service or package is required. Local pages/history use IndexedDB; local creation, viewing and restore do not need provider configuration. Local AI editing follows the existing anonymous policy (off by default in production), using bounded local code. Signed-in cloud edits load canonical code/history with the verified user's JWT and ignore body owners/code.

AI output is JSON with separate `html`, `css`, `js`, `reply` and `explanation` fields. Limits are 24,000 HTML, 16,000 CSS, 24,000 JS, 2,000 prompt, 2,000 reply and 1,200 explanation characters. The server asks for a complete replacement, validates it before saving, and never executes generated code. Input includes only the current page code, up to five recent edit exchanges and the current request—not app tasks, notes, Calendar tokens or credentials. Do not paste secrets into page code or prompts. A page can contain mistakes; use another edit or restore.

## Sandboxed rendering

Generated code executes **only** inside `<iframe sandbox="allow-scripts" srcdoc="…">`. Never add `allow-same-origin`, forms, popups, top navigation or downloads. The iframe has an opaque origin, `referrerPolicy="no-referrer"` and restrictive camera/microphone/geolocation/clipboard/payment/fullscreen policies. It cannot read the parent app DOM, storage, cookies or bearer tokens.

The wrapper puts a CSP first: default/connect/frame/child/worker/object/font/media/manifest sources are `none`; base URIs and form submission are disabled. Inline scripts/styles are intentionally allowed to run the user's page, while eval, remote scripts/styles and resource/network connections are not. Raster data-URI images are allowed. No script nonce is exposed that could authorize a remote script. HTML is parsed in an inert, detached template, restricted to ordinary HTML elements and sanitized before serialization. Scripts/styles belong in separate fields. Foreign namespaces, meta/base/iframe/object/embed/link/script markup, comments, handlers, external URLs and srcsets are removed. Code strings cannot break out of their script/style raw-text containers. The app displays saved code only as escaped text (textareas and Learn mode code blocks), never app DOM markup.

CSP is not a universal navigation control in every browser. A page may attempt to navigate its own frame, but it retains sandbox restrictions and must prove the original private bootstrap session again; a new document cannot complete that challenge, and the preview is removed. Reload preview starts a new session. Responses carrying app data use dedicated transferred **MessagePorts**, never a `postMessage(...,'*')` response to a browsing-context window that could have navigated. The wildcard is used only for non-data probes and requests from the opaque origin.

The sandbox is not a CPU/memory quota or a guarantee that malicious code cannot misuse information the user explicitly shares. Treat page code and granted data carefully. No cookies, storage credentials or tokens are ever included in the bridge, including when permissions are granted.

## Optional read-only bridge

The page can call:

```js
try {
  const tasks = await zen.tasks();
  // Use textContent when displaying returned data.
} catch (error) {
  // Explain that this version needs explicit user permission in My Space.
}
```

`zen.events()` works the same way. There is no write API. Calls do not open permission dialogs: only the user can open **Manage page access** in the host UI, select fields and confirm **Save access**. Revoke all access is immediate and reloads the preview. Edits and restores reset both grants; each version needs fresh consent.

- Tasks: up to 200 IDs, titles, status, due dates and progress; no notes/categories/owner information.
- Events: up to 200 meeting/connected Calendar IDs, titles, start/end times and a source label. No meeting notes, attendees, descriptions, locations, links or provider credentials. These are currently loaded app snapshots; no token refresh/API fetch is performed for the frame.

A small, self-contained bootstrap executes before generated markup/code, removes its own script node and keeps a random per-preview capability private in its closure. A MessageChannel challenge proves that the original document is loaded; capability values are never sent back in data replies. The host checks the exact iframe window, opaque origin, capability, method and a ten-requests-per-second bound. It rechecks the current saved version's permission via authenticated RLS (or local IndexedDB) for **every** allowed read, so another-device revocation/edit also denies the old preview. Replies contain explicit allowlisted plain data through the request's MessagePort. Account/page/version/permission changes and unmount close channels; no bridge message can write state or trigger host permissions.

## Verification

Run `npm run typecheck`, `npm test`, `npm run build`. SQL tests cover privacy, atomic/idempotent saves, stale branches, append-only restore, permission resets and account cascades. Client tests cover inert sanitization, data allowlists, local history/restore, failed-save retries and account guards. Chromium checks use real sandboxed iframes, CSP and MessageChannels to verify parent/cookie/storage/network denial, removal of the bootstrap capability, rejection of forged requests, explicit grants/revocation, navigation invalidation and 390px dark/light layout. AI responses in browser tests are fixtures; live provider/auth delivery needs configured deployment credentials.

## Home dashboard widgets

Open a page, expand **Page menu**, and choose **Pin to Home**. Home shows its current saved version using the same `SpaceFrame` sandbox and CSP as the editor. Choose **Small** (256px high, one desktop column) or **Medium** (384px high, two desktop columns). Both fit one column on mobile. **Earlier** / **Later** reorder only your pinned cards; **Unpin** is available on Home and in the page menu.

Apply the latest full `supabase-schema-update.sql` before deployment. It adds `dashboard_size` and `dashboard_order` to `space_pages`, and the authenticated, owner-bound `change_space_widget` RPC. No new environment variables are needed. Preferences sync through Supabase and refresh on window focus; local mode persists them transactionally in IndexedDB. Pinning, resizing and ordering do not create code versions or grant data access. Each widget still checks current saved permission on every bridge read; edits/restores revoke grants as before. Unpinning removes the frame and closes its bridge session. Reordering starts fresh preview sessions so moving an iframe cannot retain a stale navigation/bridge session.

## Learn mode

On a page, turn on **Learn mode** to see **What changed and why** after each AI edit. The explanation uses a few short sentences in the request’s language. Added lines use **+** and a success background; removed lines use **−** and an error background, with previous/new line numbers and nearby context. Code comparisons scroll within the card at mobile widths. Long comparisons load 200 lines at a time; very large edits highlight the replaced block to keep comparison work bounded.

**Explain this version** in the timeline revisits any save point without restoring it or making an AI request. Explanations are generated and saved with every AI edit even while Learn mode is off, in the same daily-quota reservation (no second AI call). Turning Learn mode on/off only changes the display during this session.

Apply the latest full migration before deploying: `space_page_versions.explanation` stores bounded plain text, and `parent_version_id` records the exact version each new edit/restore replaced. The owner-bound save RPC sets this predecessor from the locked current page; highlights come from comparing owned saved code, not model-supplied line numbers. Local IndexedDB versions preserve the same fields. Existing versions are left unchanged and display a message if an explanation/comparison is unavailable. Restores record their own explanation and predecessor; the restored source’s original explanation stays in its historical version. Account exports include the saved explanations. No new environment variables or permissions are needed.

## Edit by voice with Dante Live

Open a specific page and choose **Edit by voice** (also available at 390px), or open Dante Live with **Ctrl+Shift+Space**. The Live banner names the page being edited. Say an instruction such as “make the background purple” or “add a timer.” While Live is open on that page, spoken instructions go to the page builder. Leave the page or close Live to end that editing session.

Each successful instruction uses the existing authenticated page-edit endpoint with its default allowed model, per-minute/daily limits, version conflict checks and cloud/local storage. It creates a save point with a Learn explanation and resets data grants as a text edit does. The preview, timeline and Learn panel update after saving. Dante speaks a short confirmation only once the save is confirmed; failures show an error instead of claiming success. Server transcription, when configured, still uses its separate existing transcription allowance. There is no extra general-chat AI request. Page commands stay in the page timeline rather than the general Dante conversation.

On Home (including pinned widgets), `/space` without a selected page, or other app pages, Dante Live keeps its normal assistant behavior. Microphone input requires a supported browser and HTTPS/localhost. Late recordings/transcriptions and in-flight edit responses cannot retarget a different page/account after navigation or sign-out. Interrupting/closing can race an already completed save; inspect save points before repeating an uncertain instruction. The iframe sandbox and read-only permission bridge are unchanged. No new SQL migration, dependencies or environment variables are needed for voice edits; complete the existing My Space and voice-provider setup first.
