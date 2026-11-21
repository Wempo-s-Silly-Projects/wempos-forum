# Feature slate — wave 2026-11-21-9 (v4.14.0)

Two moderator lanes and one small forum-side member feature. No migration.
Every new route is staff-only and checks the role on the server.

## F1 — Recent activity peek (mods)

Problem: when a report comes in, a mod can't tell a one-off from a spam run
without leaving the queue.

- `GET /api/admin/users/:id/recent-posts` (`api/mod-tools.mjs`). It uses
  `requireStaff` (read), so anonymous gets 401 and members get 403. It returns
  the member's newest 10 posts in every visibility (hidden ones flagged), their
  public post count, and whether they have an active ban. The posture matches
  the Hidden posts desk, which already shows bodies to staff. No password,
  salt, email or IP fields are returned.
- Each report card gets a "Recent activity" toggle (`aria-expanded` /
  `aria-controls`). The peek loads once on first open and renders with
  createElement/textContent only.

## F2 — Hide a spam run, with restore (mods)

Problem: a spammer posts many times. Each report has to be handled one at a
time, and there was no way back from a mistaken hide.

- `POST /api/admin/users/:id/hide-recent {count: 1..50}`. It uses
  `requireStaff` (mutating: Origin + CSRF) plus `assertNotBanned` and the
  write limiter. It hides the member's newest N public posts and closes their
  open reports as `actioned`, recording `resolved_by` as the mod. Both writes
  run in one batch with a visibility guard. Like bans, it refuses the owner
  account and the mod's own account (403). It returns 409 when nothing public
  is left.
- `POST /api/admin/posts/unhide {ids: 1..50}` restores moderator-hidden posts.
  It never touches staged uploads (`staged_at IS NOT NULL`), which publish on
  the author's own path. It returns 409 when nothing could be restored.
- Client: a count field (min 1, max 50, default 5) on each report card. The
  submit asks `window.confirm` (with the restore path named) before sending.
  The Hidden posts desk gains a Restore button on moderator-hidden rows. The
  desk payload now carries `staged`, so staged uploads get no button.
- Audit trail: the codebase has no audit table (migration 0039 dropped
  `moderation_actions`). `reports.resolved_by` is the record the desk already
  keeps, and it is written here.

## F3 — Jump to the latest reply (members)

- `public/js/latest-reply.js`: a button above the replies on threads with 3+
  replies. It looks up the last reply card at click time, so it stays right
  after "Load older replies". It uses the shared `jumpToNode` (respects reduced
  motion and moves focus). No request, no storage. It is distinct from
  catch-up (new replies only) and glance (top-liked reply).

## Tests

`tests/wave9.test.mjs` adds 19 tests, authz first: anon, member, banned-mod and
bad-CSRF are refused on all three routes with nothing changed; owner/self
targets are refused; count/ids validation; newest-N-public-only;
report closing; the visibility law after a hide; restore skipping staged
uploads; the hidden-desk `staged` flag; report-card wiring; the peek renders
text, not HTML; confirm before the API call; the latest-reply threshold and
click-time lookup. 18 new strings across en + 20 locales (parity green).
