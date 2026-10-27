# My Space public gallery

My Space pages are private by default. In **Page menu → Publish to gallery**, choose a public title, description and author name, review the version’s code, and explicitly consent to public viewing and remixing with credit. Author names are public labels chosen for publication, not verified identities; the app does not copy account email/profile data into them. Publishing copies only this saved version’s HTML/CSS/JS. Other versions, prompts, Learn explanations, notes and task/calendar permissions stay private. Future edits do not update the public snapshot until you publish again.

Open **Gallery** from My Space or the sidebar, or visit `/gallery` without signing in. Lists load 24 pages at a time. Public details live at `/gallery/:id`; private `/space/:slug` routes still require the owner’s account. Published code runs only in the existing opaque `sandbox="allow-scripts"` iframe and strict CSP, with no workspace-data bridge or consent controls. Code can contain text you entered; inspect it before publishing. Gallery lists never execute embedded previews.

## Setup

1. Apply the latest complete `supabase-schema-update.sql` after the base schema. It adds private remix attribution, public snapshot/report tables with own-row RLS and service-only transactional operations. Direct anonymous database reads/RPCs are denied; public reads go through the server’s filtered field allowlist.
2. Configure the existing server-only `SUPABASE_URL` (fallback `VITE_SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY`, and existing Supabase authentication/anon configuration. Never use a VITE_ service-role key. Gallery publishing/reporting/moderation requires a real signed-in user even if anonymous AI calls are enabled.
3. Set **server-only** `ADMIN_EMAILS` to a comma-separated list of confirmed Supabase account emails, e.g. `ADMIN_EMAILS=admin@example.com`. Restart/redeploy after changes. Each moderation request reads the canonical account for the verified token ID and requires a confirmed email matching that list. Client flags, request-body emails and user metadata cannot grant admin access. No list is exposed to the browser. Without configured admins, reports still hide pages until an administrator is configured to review them.
4. Rebuild/deploy. Admins open **Gallery → Moderation** (`/gallery/moderation`). Server role checks protect list/detail/actions independently of the client UI. No new dependencies or AI quota charges are introduced.

## Remix and credit

Choose **Remix into My Space**, name the copy and choose an unused private address. The transaction copies the currently visible public snapshot into a new private page and initial save point, records canonical source ID/title/author credit, and turns both data grants off. Retry IDs deduplicate a completed cloud remix. Copies remain private unless their own user explicitly publishes them. The source author link/credit is preserved through later edits and publication. Further remixes also retain the first original’s credit, so an intermediate remix cannot erase attribution to the root author. The remix tree shows visible ancestors (up to 20) and direct children (up to 50); follow a branch link to explore further. Hidden/withdrawn/deleted nodes are omitted. Attribution in independent copies can remain even when the original link is unavailable.

Local/demo mode can view the public gallery and remix into IndexedDB using the same code/credit/no-grant rules. It cannot publish, report or moderate. Signing in does not automatically publish or upload local pages; existing local workspace import still does not import IndexedDB pages.

## Reports and review

A signed-in account can report a public page for inappropriate content, unsafe behavior, spam or another concern. It counts once per account per review period; identical retries do not add reports. Owners cannot report their own page. The report transaction locks the publication and hides it at **3 distinct reports**. Hidden entries disappear from public lists, detail/code reads, remix creation and visible trees. Already downloaded code and existing private/remixed copies cannot be recalled. Publish/republish and withdrawal cannot bypass a moderation hold.

Admins can inspect sandboxed hidden snapshots and choose:

- **Hide:** remove the snapshot from public access.
- **Restore after review:** clear the hold/count and begin a new reporting period. A page its owner withdrew stays withdrawn.
- **Delete publication:** after explicit confirmation, permanently clear published code and metadata, retaining a non-public tombstone to prevent restoring/republishing that same entry. The owner’s private original and other users’ remixes are retained.

Titles, descriptions and public author labels have length limits, reject markup/control characters and use a small case/Unicode-normalized profanity filter. It is a basic text check, not comprehensive content moderation. Page code is not inspected by this filter; sandboxing and reporting remain independent controls. Reporter identities are never returned in public API responses. Public and admin reads use `Cache-Control: no-store` so hidden snapshots are not served from an application cache. Previously loaded frames stop when the user navigates/refreshes; hiding a page cannot erase someone’s existing downloaded copy.

Public records and own report records are included in account exports and cascade on account deletion. Independent remix attribution remains with the copied work. Never log code, report details, private identity data or credentials.
