# Security review — v5.12.0..v5.15.0 (wave 5.16)

Scope: `git diff v5.12.0..v5.15.0` — server first (api/polls.mjs,
api/posts-feed.mjs, api/account-security.mjs, api/boards.mjs,
api/posts-write.mjs, api/mcp.mjs, worker.mjs), then the client modules
(polls.js, routes/post.js, desk/reports.js, account-security.js,
lightbox.js, boards.js).

Findings: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW (fixed), 2 INFO (no fix).

## S1 — LOW — close/vote race (FIXED)

- Where: api/polls.mjs vote route (PUT) and take-back route (DELETE, v5.13).
  Both read the poll's `closed_at`, then wrote unconditionally.
- Scenario: a vote or take-back request whose poll read happens just before
  the author's close commits still writes after the close, so a closed poll's
  tally can change. Reachable only since v5.13 made `closed_at` settable.
  Impact is a single vote landing in a millisecond window; no authorization
  bypass.
- Fix: both writes carry the open-poll guard in the same statement
  (`POLL_OPEN_SQL`, api/polls.mjs:105). The vote upsert becomes
  `INSERT ... SELECT ... WHERE EXISTS(open poll) ON CONFLICT ...`
  (api/polls.mjs:239); zero rows changed means 409. The take-back delete
  carries the same guard (api/polls.mjs:139); zero rows on a now-closed poll
  means 409 (`assertPollStillOpen`, api/polls.mjs:107), and zero rows on an
  open poll stays a harmless 200.
- Tests: tests/wave516-security-pins.test.mjs (S1 x4, RED before the fix).

## I1 — INFO — sign-out-others covers forum sessions only (NO FIX)

- Where: api/account-security.mjs:62.
- `DELETE FROM sessions WHERE user_id = ? AND token_hash != ?` ends the
  caller's other forum sessions only. Wempo Accounts sessions (`wa_` tables)
  are not touched, so a device still signed in to Accounts can come back to
  the forum through the normal SSO sign-in. This matches the documented
  scope ("Forum sessions only: the relay, SSO redeem and session cookie
  contract are unchanged"). Noted for a future Accounts-side lane; no
  redesign this wave.

## I2 — INFO — no board-move path exists (NO FIX, pinned)

- No route writes `posts.board` after creation: the author edit
  (`PATCH /api/posts/:id`) updates `body`/`edited_at` only, and no
  moderation or import route sets it. Both topic-creating paths are gated by
  `isStaffOnlyBoard` (api/posts-write.mjs:273, api/mcp.mjs:571); the MCP
  `create_suggestion` tool is fixed to the open Suggestions board, and poll
  creation attaches to the caller's own root on its existing board.
- Pin: an edit that sends `board: "polls"` or `"updates"` leaves the board
  unchanged (tests/wave516-security-pins.test.mjs).

## Checks that passed

- Poll close (PATCH): `requireUser` (Origin + CSRF), `assertNotBanned`,
  write rate limit, `canViewPost` (404 for hidden / banned-author / blocked
  threads), poll must exist on that post id (a reply never has one: 404),
  then root author OR public `owner`/`admin` (api/polls.mjs:119). A member
  closing someone else's poll gets 403 (pinned).
- Take-back (DELETE): the delete is keyed `poll_id = ? AND user_id = <caller>`;
  it cannot change another member's row (pinned).
- Roles: `session.user.role` (readSession) and `ctx.agent.role`
  (agent-auth) both pass through `publicRole` once; every new check compares
  public values (`owner`/`admin`). posts-feed `canManage` likewise.
- account-security GET: counts only (totpEnabled, backupCodesLeft,
  otherSessions), `Cache-Control: no-store`, no code, secret, token or hash
  in the payload. The compare uses `session.tokenHash` from the session row.
  POST: `requireUser` (CSRF), write rate limit; `user_id = ?` never matches
  guest rows (NULL) or other members.
- Binds: every new statement binds at most 5 values; all reads carry LIMIT
  or are single-row aggregates.
- Visibility law: poll payload rides the already-gated detail read; votes
  by actively-banned members still drop at read time.
- Client: all new text via `textContent`; no `innerHTML`; the lightbox
  "Actual size" toggle touches no storage and no network (pinned in
  tests/wave514-account-security.test.mjs).
