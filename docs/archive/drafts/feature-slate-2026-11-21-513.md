# Feature slate 2026-11-21-513 (wave 5.13, v5.13.0)

Area: polls + the staff moderation desk. Checked against every
`docs/archive/drafts/feature-slate-*.md`: earlier poll work was the poll dialog's
duplicate warning/preview and clearer results (percent + "Your vote"); earlier
desk work was the activity peek and hide-a-spam-run. Nothing below repeats them.

## F1 — Close voting on a poll (unique)

- What: the thread's author (or staff) can close voting on the thread's poll,
  and reopen it. A closed poll keeps its results visible to everyone, shows
  "Voting is closed", and drops the vote buttons.
- Why: `polls.closed_at` and the vote route's 409 "This poll is closed." have
  existed since v3.0 (migration 0014) but nothing could ever set the column.
- Server: `PATCH /api/posts/:id/poll` `{closed: true|false}` in `api/polls.mjs`
  — `requireUser` (CSRF) → `assertNotBanned` → `rateLimit("write")` →
  `canViewPost` (404) → root author or public role owner/admin (403) → poll
  exists (404) → boolean body (400). The detail payload adds `closed` and
  `canManage` (author or staff only). No migration.
- Client: `public/js/polls.js` (closed note, Close/Reopen button),
  `public/js/routes/post.js` (`poll-close` action).
- Tests: `tests/wave513-polls.test.mjs` — anon 403 at the Origin gate, other
  member 403, banned author 403, hidden thread 404 for a member, bad body 400,
  author closes → vote 409 → reopen → vote 200, staff can close, payload
  flags per viewer; DOM: closed poll has no vote buttons + the note.

## F2 — Take back my vote

- What: a member who voted can withdraw the vote (not just move it) while the
  poll is open.
- Why: votes were changeable but never removable; a misclick was permanent.
- Server: `DELETE /api/posts/:id/poll` in `api/polls.mjs` — same gate chain as
  the vote PUT, 409 when closed, deletes only the caller's own row.
- Client: "Take back my vote" button (`poll-unvote`) in `public/js/polls.js`,
  action in `public/js/routes/post.js`.
- Tests: same file — anon 403, vote then DELETE removes only the caller's vote
  (another member's stays), closed poll 409, DOM button only for a voter on an
  open poll.

## F3 — Repeat-report chip on the report queue (unique, staff-only)

- What: when several open reports point at the same post, each of its cards
  says "Open reports on this post: N", so staff see a pile-up at a glance.
- Why: the queue lists reports one by one, oldest first; three reports on one
  post read as three unrelated cards.
- Client only: `public/js/desk/reports.js` counts by `post.id` over the
  already staff-gated `GET /api/admin/reports` payload. No server change.
- Tests: DOM — chip on both cards of a doubled post with N=2, absent on a
  single-report card.

## Laws

- Visibility: the only new reads are the poll row by root id after
  `canViewPost`; no list surface added.
- Writes: CSRF + not-banned + rate limit on both new routes; staff check uses
  the PUBLIC role on `session.user`.
- Strings: 5 new keys in en.json + all 40 other locales, translated.
- No localStorage, no migration, no new module.
