# Feature slate — wave 2026-11-21-37 (v4.42.0) — docs catch-up + notifications Unread only

Not shipped before (checked feature-slate-2026-11-21*.md and public/js: the
only "Unread only" filter is the chat list's, v4.32; the Notifications page
had "Mark all read" and nothing to narrow the list).

## F1 — Docs (README, docs/moderation.md, docs/chat-widget.md)

Brought up to v4.31–v4.42, every claim grep-checked against code:
restored-draft notice, paste/drop images, quiet counter, edit-cancel confirm,
keyboard shortcuts list, feed views, `FEED_PAGE_SIZE` 20 + end of feed + Back
to top, long-post fold (900 chars / 14 lines), Suggestions by votes + ranks,
poll preview + duplicate warning, earlier upload refusal, saved posts by board
+ remove all, notifications Unread only, mute chat (cap 50, local-only), group
rename (`PATCH /api/dm/groups/:id`), Who's Online Staff/Members (12-name cap),
0059 dm_threads index, faster feed reply counts. moderation.md gains how
hidden posts and bans shape reply counts, Unanswered, Suggestions ranks,
saved lists and the Staff roster heading.

## F2 — Project skills (gitignored, main checkout)

- wempos-forum-patterns 1.1.0 → 1.2.0 (36 → 41 lines): Server laws — feed
  variants page by `FEED_PAGE_SIZE` and extend the wave-32 bind pin
  (< `D1_MAX_BOUND_PARAMS`); cursor parsers anchored/bounded + the wave-35
  cursor fuzz; client checks advisory, server enforces (uploads).
- wempos-forum-test-harness 1.1.0 → 1.2.0 (34 → 42 lines): safety-net pins
  list (spoiler sweep, parser fuzz, storage-wipe sweep, feed bind pin, cursor
  fuzz, rollup differential).

## F3 — "Unread only" on the Notifications page (unique)

A checkbox above the list (only when there are notifications) hides read rows
in place, single and grouped alike; when nothing unread is left a
`role="status"` line says "No unread notifications." Unticking shows every
row again. `public/js/notification-filter.js` (`applyUnreadOnly`,
`createUnreadOnlyToggle`), wired in `renderNotificationsPage`; modulepreload
hint (notifications.js is on the boot chain). Page-view only (source-pinned:
no storage, no requests, no innerHTML); resets on the next render.

## Strings

2 new keys (`bell.unreadOnly`, `bell.noUnread`) in en and all 20 locales.

## Storage keys

None.

## Tests

631 → 637 (`wave37-notification-filter` 6: hide/restore, empty line,
toggle build + change, wiring after the empty-state return + CSS, page-view
source pin, locale parity). RED first (module missing).

## Migrations

None.
