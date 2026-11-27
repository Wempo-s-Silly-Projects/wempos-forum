# Feature slate — wave 2026-11-21-39 (v4.44.0) — hardening + notification day dividers

Not shipped before (checked feature-slate-2026-11-21*.md and public/js: the
Notifications page had per-row times since v4.43 but no day grouping;
thread-glance read time already exists, so it was not reused as F2).

## F1 — Hardening review of v4.40–v4.43 (`7d7fc27..6f75f56`)

- **MEDIUM, fixed** — `api/bookmarks.mjs` `visibleAncestorSql`: the saved list
  and the board removal block-checked only the reply's own author, while
  `canViewPost` also refuses a block pair with the parent/root author.
  POST_SELECT ships `parent.body`, so the block-paired member's text reached
  `/api/me/bookmarks`, and `DELETE /api/me/bookmarks?board=` deleted those
  rows. Both ancestor probes now carry the viewer block clause (staff bypass);
  +4 binds for a blocking member (list worst case 12, < 100).
  `tests/wave39-saved-ancestor-blocks.test.mjs` (4; RED 3 before, mutation
  dropping the root-level clause turns it RED).
- **MEDIUM, fixed** — `api/chat.mjs` `PRESENCE_SELECT_SQL`: the guest-readable
  Who's Online roster had no ban filter (the heartbeat has no ban gate), so an
  actively-banned member with an open tab stayed listed while
  `lobbyOnlineCount` excluded them; `who-online-groups.js` already documented
  the roster as ban-free. Same read-time ban clause added, bind-free.
  `tests/wave39-presence-ban.test.mjs` (3; RED 1 before).
- Checked, no defect: board param (case/whitespace/encoded/repeated → first
  value, exact whitelist; `updates` is readable so saving/removing is fine);
  500-row cap (client re-renders after removal, so leftovers reappear with the
  button still there); cursor from another board (pure sort key, safe);
  deleted root (missing ancestor → hidden, matches canViewPost); poll
  duplicate key (trim + lowercase, same as the server; server still enforces);
  invisible staff (excluded in SQL); owner label (publicRole maps
  `admin` → owner); notification stamps (ISO with Z; bad dates skipped).
- LOW (suspicions, not fixed):
  - `public/js/poll-preview.js:30` the client key ignores the word filter;
    the server compares post-filter labels, so two options differing only in
    filtered words are refused without the early warning (advisory only).
  - `public/js/feed-end.js:33` a final page of exactly 20 with a cursor shows
    no end line; the next (empty) Load older shows the empty state instead.
  - `api/chat.mjs:205` the heartbeat still writes presence rows for banned
    members (harmless now that reads filter; a gate would save writes).

## F2 — Today / Yesterday / Earlier on the Notifications page (unique)

- `public/js/notification-days.js` (new): `notificationDayKey(createdAt, now)`
  on the local calendar (DST-safe via local Date construction; future → today;
  junk → null), `createDayHeading` (h2.notification-day[data-day]),
  `syncDayHeadings` (hides a heading with no visible rows).
- `public/js/notifications.js`: a heading opens each new day bucket in row
  order; a group files under its newest reply; undated rows open none.
- `public/js/notification-filter.js`: Unread only calls `syncDayHeadings`.
- `public/index.html`: modulepreload hint (sibling of notification-filter).
- Page-view only: no storage, no request.

## Strings

`bell.dayToday`, `bell.dayYesterday`, `bell.dayEarlier` — en + all 20 locales.

## Storage keys

None.

## Tests

646 → 660 (wave39-saved-ancestor-blocks 4, wave39-presence-ban 3,
wave39-notification-days 7). F1 + F2 RED first.

## Migrations

None.
