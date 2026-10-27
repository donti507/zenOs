# Weekly build challenges and builder badges

## Deployment

Apply the **complete** `supabase-schema-update.sql` after the base schema in the Supabase SQL editor. Clear any selection before Run so whole function definitions execute. It is idempotent. Configure the gallery's existing server-only Supabase URL/service-role key and `ADMIN_EMAILS` (confirmed Supabase account emails); rebuild/redeploy from the merged branch. No new environment variables, LLM calls, or scheduler are required.

## Challenges

Open **Gallery → Challenges** at `/gallery/challenges`. Browsing and viewing published submissions are public. Confirmed-email administrators listed in `ADMIN_EMAILS` see **Create challenge** and choose a title, description, start, and end. Inputs use the administrator's local timezone and are stored as timestamps; viewers see dates in their own timezone. A week is suggested, with a maximum window of 31 days. Dates and text are immutable after creation. The same normalized basic text filter as gallery metadata applies.

While a challenge is open, each signed-in cloud account can submit one of its own visible published My Space pages. Publish the saved version from the page menu first. Submission is final; retrying the same page is safe. Publishing remains opt-in: a challenge never publishes a private page for you. Entries link to the gallery's sandboxed public preview; private code, version history, account emails and workspace grants are never included. A submission references its publication, so later deliberate republishing updates that page; this is a community challenge, not a frozen competition artifact.

Each signed-in account has **one permanent vote for the entire challenge**, with a confirmation before casting it. Self-voting, voting for another challenge's entry, voting for invisible pages, and votes outside the server's start-inclusive/end-exclusive window are rejected. Repeating the same vote does not add another vote. Voter identities, submitter account IDs and administrator emails are not exposed publicly. Own vote/submission receipts come from a separate authenticated read using only the verified token owner.

After the deadline, the first challenge/badge read finalizes ended challenges transactionally. Visible, published entries with the highest positive vote count win. Ties share the award; zero votes means no winner. Hidden, deleted and withdrawn pages are excluded at finalization. Restoring one afterwards does not recalculate finalized results. Results and earned badges persist; later moderation can still hide public entries. Votes cannot change after the deadline. No job needs to run at exactly the deadline.

Admins moderate submissions through the existing gallery moderation page. Challenge creation, submission, voting and badges use service-only writes/RPCs. All five new tables have own-row RLS for authenticated exports, no anonymous direct database access, and account-deletion cascades. Public data goes through the curated API, never a broad RLS read policy. Export includes challenges you created, your entries/votes, badges, and activity dates.

## Badges

Badges appear in the desktop and mobile account menus and on Challenges:

- **First page:** create your first private My Space page; publication is not required.
- **First remix:** create a private copy using the gallery Remix action.
- **Challenge winner:** win at least one finalized challenge.
- **7-day streak:** use the app signed in on seven consecutive UTC dates. A visible workspace records the server's current date on entry, focus and midnight; hidden tabs do not automatically earn activity. Repeated visits count once. Past days are not inferred or backfilled, and browser-supplied dates cannot affect cloud awards.

Creation badges are awarded by the page-creation transaction and backfilled for existing pages/remixes when the migration runs. Earned badges are permanent even if the originating page is deleted. Winner badges are awarded in the same transaction that finalizes results. Activity-day streaks start after deployment.

Local/demo mode keeps separate first-page, first-remix, and streak badges in this browser. Local activity uses the user's local calendar dates. Local mode can browse challenges but cannot submit, vote, create cloud challenges or earn a cloud winner badge. Local badges and IndexedDB pages are not imported into a cloud account, and cannot grant a cloud badge. Signing out or changing accounts clears the displayed badge state and ignores late responses.
