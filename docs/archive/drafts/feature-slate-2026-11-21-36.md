# Feature slate — wave 2026-11-21-36 (v4.41.0) — bookmarks, poll creation, Who's Online

Not shipped before (checked feature-slate-2026-11-21-*.md, api/bookmarks.mjs,
public/js/routes/composer.js, public/js/who-online.js): no saved-list board
filter or bulk removal, no client duplicate-option check or poll preview, and
the roster was one flat list. No follow/friend concept exists, so "online
friends first" was not built.

## F1 — Saved posts by board + Remove all saved from a board (server + client)

- `GET /api/me/bookmarks?board=<slug>`: optional, whitelisted against
  `BOARD_VALUES` (400 otherwise, before any SQL); the composite cursor keeps
  walking inside the board.
- `DELETE /api/me/bookmarks?board=<slug>`: board required + whitelisted;
  `requireUser` (Origin + CSRF before session), `assertNotBanned`, write
  limiter; removes only the caller's own rows, capped
  `SAVED_BOARD_REMOVE_CAP` = 500 per call via a `LIMIT`ed subselect; all
  values bound. Returns `{ ok, removed }`. Other methods on the path 405.
- List and removal share `visibleSavedFilter` (public, unbanned author,
  viewer block pair, visible ancestors), so the removal deletes exactly what
  the list showed; hidden/banned/blocked rows stay saved and return when that
  state lifts (read-time law).
- **Leak fixed (pre-existing):** the saved list checked only the saved row,
  so a saved reply under a hidden root or a banned parent still listed.
  `visibleAncestorSql` now requires the parent (and the root for level-2
  replies) to be public with an unbanned author. RED on main first.
- Client: `/bookmarks?board=<slug>` (router whitelist; unknown slug → whole
  list), board chips (`createSavedBoardFilter`, `aria-current`), a "Remove all
  saved from <board>" button inside a non-empty board that asks first
  (`window.confirm`) and re-renders with "Removed N saved posts."
  `public/js/saved-boards.js`. Nothing stored on the device.
- Tests: `tests/wave36-saved-boards.test.mjs` (10, real worker: filter,
  400s, cursor, guest/CSRF/foreign-Origin/banned refusals, own-rows-only,
  idempotent, 405, hidden/banned/blocked/hidden-ancestor exclusion).

## F2 — Poll dialog: duplicate-option warning + live preview (client)

`public/js/poll-preview.js`. On every input in `#poll-dialog`: options equal
after trim + lowercase (the server's rule in api/polls.mjs) get
`aria-invalid="true"` and one `role="alert"` line; a preview shows the
question and non-blank options as typed. Confirm refuses duplicates before
the poll is stashed. The server still refuses duplicates (and runs the word
filter, which the client can't see). Page-view only (pinned: no storage, no
requests).

## F3 — Who's Online grouped by role (client)

`public/js/who-online-groups.js`: the `/api/presence` roster splits into
Staff (owner, admin) and Members, each heading carrying its count; staff
first, the 12-name cap still spans the card with one "+N more". Grouping runs
only on what the server returns; invisible mode is untouched (behavioral pin:
an invisible owner never reaches the roster, so Staff can't reveal them).

## Strings

12 new keys (`saved.*` ×7, `composer.pollDuplicate|pollPreview|pollPreviewEmpty`,
`online.staff|members`) in en and all 20 locales (parity + translated +
placeholder pin).

## Storage keys

None.

## Migrations

None.

## Tests

605 → 631 (`wave36-saved-boards` 10, `wave36-client` 16).
