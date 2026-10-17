# Wempo's Forum v2 — Design Spec

Date: 2026-10-15
Status: Approved in chat by user (2026-10-15)

## Purpose

Add 13 user-requested features to the Cloudflare Workers + D1 forum: moderated avatars, a
mod role, reaction toggling, Turnstile on replies, nested replies, feed bumping, a
word-filter template, a 10,000-char bio limit, profile socials/Polytoria username,
in-app reply notifications, and a banned-account sign-in screen.

## Existing system (context for implementers)

- Backend: `worker.mjs` (single ~1,290-line fetch handler), shared SQL constants in
  `constants.mjs`, D1 binding `FORUM_DB`, static assets binding `ASSETS`, Wrangler rate-limit
  bindings for read/write and per-feature scopes (`RATE_LIMIT_BINDINGS`).
- Frontend: no framework, ES modules in `public/js/` (`app.js` orchestrates routes and forms,
  `render.js` post cards, `forms.js` field factory, `router.js` history routing, `turnstile.js`
  widget lifecycle, `admin.js` moderation UI). All rendering is `textContent`-based.
- Auth: cookie `wempo_session` (HttpOnly, SameSite=Lax), sessions stored as SHA-256 token
  hashes, per-session CSRF token checked constant-time, same-origin enforcement on all
  state-changing routes, ban-gated SQL mutations (`meta.changes` checked).
- Roles: `role IN ('member','admin')`; admin partial unique index
  `idx_users_single_admin ON users(role) WHERE role='admin'`.
- Bans: `bans` table with optional `expires_at`; banning revokes sessions transactionally.
- Turnstile: widget actions `signup|login|post` verified server-side against siteverify with
  action + hostname checks (`requireTurnstile`).

## Decisions made with the user

| Topic | Decision |
|---|---|
| Replying to a reply | One nested level (root → reply → reply-to-reply; no deeper) |
| "Take away dislikes" | Toggling reactions off (un-like / un-dislike); dislikes themselves stay |
| Bump activity | Replies only (reactions do not bump) |
| Word filter | Replace matches with same-length asterisks, stored masked |
| Filter words | Template file only, empty list — user adds words later |
| Avatar privacy while pending | Previous approved avatar (or none) stays public |
| mods | New `mod` role, promoted by admin; moderation powers for reports/bans/avatar queue, not for promotion |
| Ban screen | Shown on rejected sign-in only: "You are banned", reason, countdown for temp bans |
| Notifications | In-app only; bell in header with unread count + `/notifications` page |
| Ban-reason probe oracle | Accepted (rate-limited sign-in mitigates) |
| Execution | Split `worker.mjs` into modules so subagents can work on disjoint files |

## 1. Database migration `migrations/0002_forum_v2.sql`

SQLite cannot alter CHECK constraints, so the `users` table is rebuilt:

1. `CREATE TABLE users_new` mirroring the current schema with changes:
   - `bio` CHECK length ≤ 10 000 (was 280)
   - `role` CHECK IN (‘member’, ‘mod’, ‘admin’) (was member/admin)
   - New nullable columns, each `TEXT` ≤ 120 chars via CHECK:
     `avatar_status` CHECK IN ('approved','pending','rejected'),
     `social_youtube`, `social_x`, `social_reddit`, `social_github`, `social_discord`,
     `social_gitlab`, `social_instagram`, `social_tiktok`, `social_twitch`,
     `polytoria_username`
   - Pending-avatar mirror set: `pending_avatar_mime`, `pending_avatar_data`,
     `pending_avatar_updated_at`, `pending_avatar_version` — populated only while
     `avatar_status='pending'` (all-or-nothing CHECK per set)
   - Consistency CHECKs: approved avatar group is all-NULL or all-populated together with
     `avatar_status` in ('approved','pending'); pending group is populated iff
     `avatar_status='pending'`
   - Recreate `idx_users_single_admin`
2. Copy: `INSERT INTO users_new SELECT id, username, username_key, password_salt, password_hash,
   role, bio, avatar_mime, avatar_data, avatar_updated_at, avatar_version, 'approved',
   NULL, NULL, ... , NULL FROM users` (existing avatars become `'approved'`; no socials).
3. `DROP TABLE users; ALTER TABLE users_new RENAME TO users;` and recreate external indexes
   (`username_key` UNIQUE is part of `users_new` DDL).

Posts (no CHECK changes needed):
- `ALTER TABLE posts ADD COLUMN last_activity_at INTEGER NULL;`
- Backfill: `UPDATE posts SET last_activity_at = created_at WHERE parent_id IS NULL;`
  then `UPDATE posts SET last_activity_at = COALESCE((SELECT MAX(created_at) FROM replies
  …), created_at)` per root (single UPDATE with correlated subquery over all replies).
- Index: `CREATE INDEX idx_posts_activity ON posts(last_activity_at DESC, id DESC) WHERE parent_id IS NULL AND visibility='public'`.

Notifications:
- `CREATE TABLE notifications (id INTEGER PK AUTOINCREMENT, user_id NOT NULL REFERENCES
  users ON DELETE CASCADE, target_post_id NOT NULL REFERENCES posts ON DELETE CASCADE,
  reply_id NOT NULL REFERENCES posts ON DELETE CASCADE, created_at NOT NULL,
  read_at INTEGER NULL, CHECK (user_id != (SELECT author_id…))` — self-notification
  exclusion lives in application insert logic; columns plain.
- Index `idx_notifications_user ON notifications(user_id, id DESC)`.

## 2. Worker split (prerequisite, behavior-preserving)

Split `worker.mjs` (keep its default `fetch` export and public test exports re-exported so
existing tests keep passing) into:

- `api/shared.mjs` — HttpError, hex/base64url, hashing, constant-time compare, cookies,
  `readSession`/`createSession`, CSRF/Origin guards, `requireUser`/`requireAdmin`,
  rate limits, Turnstile, body readers, validators, `securityHeaders`, `postById`,
  `publicPost`, `canViewPost`.
- `api/session.mjs` — session/setup/setup-status/logout/registration/login + **ban screen
  payload** (below).
- `api/posts.mjs` — feed, search, post detail, create, reply, reactions, bump logic, filter.
- `api/profiles.mjs` — user profile read, bio, avatar upload, password change, socials.
- `api/moderation.mjs` — reports, report resolve, bans, promote/demote, avatar queue.
- `api/notifications.mjs` — list/mark-read/unread count.
- `config/filtered-words.mjs` — `export const filteredWords = [];` + `export const
  filteredWordsHelp` documenting the list format. **Empty — user curates later.**
- `worker.mjs` — imports all route groups, keeps `fetch`, re-exports exported symbols
  (`canViewPost`, `createSession`, `rateLimit`, `requireTurnstile`, etc.) for tests.

## 3. Threading (one nested level)

`POST /api/posts/:id/replies` where `:id` may be a root or a level-1 reply:

- Atomic insert SQL requires: target exists, is `public`; and either `target.parent_id IS NULL`
  (target is root) or target's parent exists, is a public root (`target.parent_id = root.id AND
  root.parent_id IS NULL AND root.visibility = 'public'`).
- Attempting to reply to a level-2 reply → 400 "Replies only go one level deep."
- `canViewPost` now validates a reply's parent AND, for level-2 replies, the grandparent root.
  Unrelated members never see hidden ancestors; author/admin rules unchanged.
- Detail page shows root → level-1 replies → inline level-2 replies ("sub-replies") with no
  further reply affordance.

## 4. Feed bumping (replies only)

- Reply insert (same SQL transaction as §3) also
  `UPDATE posts SET last_activity_at = ? WHERE id = <root_id>`; root id resolved in the insert
  CTE/SELECT (target root, or target's parent).
- New roots insert `last_activity_at = created_at`.
- `GET /api/posts` (non-search) orders `ORDER BY last_activity_at DESC, id DESC` with keyset
  pagination cursor `before=<last_activity_at>_<id>` (both validated server-side; the composite
  key prevents row skipping/duplication). Search results and profile pages keep id-DESC.
- `publicPost` gains `lastActivityAt`.

## 5. Reaction toggling

- New endpoint `DELETE /api/posts/:id/reaction` — same guards as PUT (session, ban checks,
  `canViewPost`, `reaction` rate limiter). `DELETE FROM reactions WHERE post_id=? AND
  user_id=?` — idempotent, always 200 even if no reaction row existed.
- PUT behavior unchanged (upsert value; no way to clear via PUT).
- UI: the active reaction button shows `aria-pressed=true`; clicking it sends DELETE and
  clears state; clicking the other button sends the new value via PUT.

## 6. Turnstile on replies

- Reply composer gains a Turnstile slot (`addTurnstileSlot(form, "reply")`), rendered with the
  other slots after route render.
- `handleReplyCreateRoute` calls `requireTurnstile(request, env, body, "reply")` after the
  existing rate limits, before body validation (same placement as post creation).
- Test fixtures mirror the existing post-create Turnstile test.

## 7. Word filter

- `config/filtered-words.mjs` exports an empty list (see §2). The worker compiles it once per
  isolate: lowercase, dedupe, drop empty entries, match on `lower(body)` with substring
  matching; each match position is replaced by `*` × word.length in the original string. Filter
  runs when (a) storing any post or reply, and (b) before every length check, so masked text
  cannot exceed limits by construction (replacement is length-preserving).
- Filter state is static per deploy. Empty list = no-op.

## 8. mods and promotion

- New role `mod`; `requiremod` = role admin OR mod for:
  report queue, report resolve, ban list, ban create/revoke, avatar queue.
- New admin-only endpoints:
  - `POST /api/admin/users/:id/promote` → sets role='mod' (target must be a member)
  - `POST /api/admin/users/:id/demote` → sets role='member' (target must be a mod)
  - Refuse targeting admins (same 403 as bans). Session users of demoted mods keep
    access until their next `readSession` — acceptable, reads role at request time.
- `POST` bodies validated (reason optional; not stored).
- Admin UI: promote/demote controls on author cards in the moderation desk, and on the member
  profile page for admins.

## 9. Avatar moderation

Schema (from §1): approved set (`avatar_mime/data/updated_at/version`), pending set
(`pending_avatar_mime/data/updated_at/version`), and `avatar_status`
('approved' with approved set populated, 'pending' with pending set populated, or both
NULL — the never-uploaded state; 'rejected' exists only as a transient handler value used
with an empty pending set).

- **Upload:** validated bytes always go to the `pending_avatar_*` set;
  `avatar_status='pending'`. An approved avatar already in the approved set keeps serving
  publicly. Re-upload while pending replaces pending bytes.
- **Serving (`GET /api/avatars/:userId`):** serves the approved avatar if the approved set is
  populated. If not — i.e. the user has no approved avatar yet and the account has a pending
  one — the endpoint serves the pending avatar only to the owner (session user id matches) or
  an admin/mod; everyone else gets 404.
- **Approve (mod/admin):** copies pending set → approved set, clears pending set,
  `avatar_status='approved'`.
- **Reject (mod/admin):** clears pending set; approved set reappears for public serving
  if one exists; otherwise the user is back to no-avatar.
- **Queue:** `GET /api/admin/avatars` lists users with `avatar_status='pending'` (username,
  avatar version, uploaded time), mod-gated, same shape as the report queue. Resolve
  endpoints are `POST /api/admin/avatars/:userId/approve` and `.../reject`, both ban-gated
  for the acting mod. Rate limits read on `read`, resolve on `write`.
- Frontend: profile page shows the user's own "awaiting review" badge when their pending set
  is populated; the user's current public avatar still shows normally.

## 10. Socials + Polytoria

- Profile edit form fields: YouTube, X, Reddit, GitHub, Discord, GitLab, Instagram, TikTok,
  Twitch, Polytoria — all optional plain-text handles, ≤ 120 chars each (DB CHECK).
- Server validation per platform: allowed characters (letters, digits, `._-` plus platform
  extras like `@` and `/`-free), reject any string containing a URL scheme, whitespace, or
  leading/trailing symbols. No HTML risk (all output is `textContent`).
- Rendering: linked for YouTube (`youtube.com/@handle`), X (`x.com/handle`), Reddit
  (`reddit.com/user/handle`), GitHub (`github.com/handle`), GitLab (`gitlab.com/handle`),
  Instagram (`instagram.com/handle`), TikTok (`tiktok.com/@handle`), Twitch
  (`twitch.tv/handle`); plain text for Discord and Polytoria. All URLs built client-side
  with `encodeURIComponent(handle)`, opened with rel defaults (same-tab, safe origin).
- `GET /api/users/:username` and `publicUser`-shaped responses include socials when set.
- `PATCH /api/me` accepts a `socials` object (platform → handle or null to clear); each value
  validated; unknown platform keys → 400.

## 11. Bio limit 10,000

- DB CHECK rebuilt (§1). `PATCH /api/me` validation `bio.length > 10000` (checked before trim;
  trim result must still be ≤ 10 000? — Trim first, then check ≤ 10 000, same as today's
  order but at the new limit).
- Per-route JSON cap: `readJson` accepts an optional max; `/api/me` uses 64 KB instead of the
  global 16 KB.

## 12. Notifications

- Insert happens inside the reply-insert transaction (§3/§4 batch): when the reply's target
  post author differs from the reply author, insert a notification for the target author
  (reply → root author; reply-to-reply → parent reply author). Notifications are not inserted
  when the target author is banned? — No: notifications are plain rows; delivery is unaffected
  by bans (banned users cannot sign in; content remains). Cap: keep newest 50 per user,
  prune on insert (`DELETE FROM notifications WHERE user_id=? AND id NOT IN (SELECT id …
  ORDER BY id DESC LIMIT 50)`).
- `GET /api/session` gains `unreadNotifications` (integer) for signed-in users — count of
  `read_at IS NULL`. No extra request per navigation.
- `GET /api/me/notifications` → newest 50 with post preview (first 80 chars of the reply body),
  target post id, read state; mod-safe (recipient-only rows).
- `POST /api/me/notifications/:id/read` → sets `read_at` for own rows only.
- `POST /api/me/notifications/read-all` → stamps all unread own rows.
- UI: bell button in header (hidden for guests) with unread count badge; `/notifications`
  route listing items, "Mark all read"; clicking an item navigates to the thread and marks it
  read; badge count comes from `/api/session`.

## 13. Ban screen

- Login route: when a valid credential matches a banned account, respond 403 with JSON
  `{ error: "This account is currently banned.", banned: true, reason: <ban reason>,
   expiresAt: <int seconds epoch or null> }` (permanent bans: `expiresAt: null`).
- Password still verified before returning ban details (no ban info for wrong passwords).
- Frontend: dedicated banned view replaces main content: "You are banned", the reason, and
  for temporary bans a live countdown ("Reactivates in 3d 2h 14m"), for permanent bans
  "No reactivation time set." No cookies/session changes.
- Setup route and all other routes for banned credentials unchanged (they have no session).

## 14. Frontend notes (modern-web-guidance search before implementation)

- New UI pieces (bell, notifications page, banned screen, socials editor, avatar pending
  badge, reply affordances) follow the existing `element()/createForm()` DOM-building style —
  no `innerHTML`. A modern-web-guidance search is REQUIRED before frontend implementation.
- CSP: no changes needed (img-src 'self' covers avatars; link navigations unrestricted).

## 15. Testing

- Migration: applied to a local DB in tests via fixture SQL (or schema parity asserted by
  inspecting column lists after a fixture application); unit tests assert new CHECK values.
- Each backend feature: node:test cases with mock D1 (existing `mockD1Batch` pattern) —
  reply-depth validation SQL matches bind order; bump cursor pagination; DELETE reaction
  idempotence; filter masking boundary cases (word at end, case, repeated word, empty list);
  promote/demote authorization table (member/mod/admin × admin-only routes);
  avatar queue approve/reject state machine; notification insert/self-exclusion/cap;
  login-ban payload (wrong password excluded).
- Frontend: node tests for pure helpers where extractable (reaction toggle intent from button
  state, social-URL builder, filter preview).
- Full `npm test` + `wrangler deploy --dry-run` gate every module. Browser smoke test at the
  end (CLAUDE.md checklist extended to the new features).

## 16. Execution order (subagent-friendly)

1. Migration 0002 + table rebuild (one agent, sequential)
2. Worker split into `api/*` modules (one agent, sequential, tests stay green)
3. Parallel backend agents on disjoint files:
   a. threading + bump + replies Turnstile (`api/posts.mjs`)
   b. reactions DELETE, socials, bio cap (`api/profiles.mjs` + shared validators)
   c. mod role + promote/demote + ban screen payload (`api/moderation.mjs`,
      `api/session.mjs`)
   d. avatar moderation queue (`api/moderation.mjs` — **shares file with (c)**, so (c) and (d)
      run sequentially or (d) first)
   e. filter (`config/filtered-words.mjs`, touched only by the filter agent, then thread into
      posts.mjs — keep filter in a separate file the posts module imports, avoiding conflict)
   f. notifications module (`api/notifications.mjs`)
4. Parallel frontend agents on disjoint files: notifications UI (`notifications.js` new file +
   small `app.js` edit — the one file many agents touch, so frontend app.js edits are a
   single agent), reaction toggle + reply affordances (`render.js`), profile editor
   (socials/bio in new `profile-editor.js`), ban screen (`banned.js`).
5. Final integration pass by the main session (app.js glue), full test suite, dry-run,
   browser smoke test.
