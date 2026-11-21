# Feature slate — wave 2026-11-21-16 (v4.21.0)

Three small member comforts across notifications, polls and search. One new
POST route (own rows only, CSRF), no migration, nothing new stored, no new
tracking.

## F1 — Notifications grouped by thread

Several plain reply notifications for the same thread now fold into one row
("3 new replies on your post — latest: …"), placed where the newest of them
sat. Clicking it marks that thread's reply notifications read in one call
and opens the thread. Mentions, appeal outcomes and chat pings stay their
own rows. A thread with a single notification looks exactly as before.

- `POST /api/me/notifications/read-thread/:postId` (`api/notifications.mjs`):
  `requireUser` (Origin + CSRF), updates only the caller's rows with
  `target_post_id = ? AND read_at IS NULL AND label IS NULL`, bounded by an
  inner `LIMIT 50`, bound params. Idempotent; 405 on other methods, 404 on
  a non-positive id. Returns `{ ok: true }` and reads nothing back.
- Client: `groupNotifications` (pure) + `threadGroupRow`
  (`public/js/notifications.js`); action `open-notification-thread`
  (`public/js/routes/notifications.js`).

**Fixed alongside: notification previews now follow the spoiler law.** The
80-char preview was shown raw; it now goes through `maskSpoilers`, and
because the server's cut can leave a spoiler opener without its closer
("the twist: ||he di"), anything from a leftover `||` on is replaced by an
ellipsis (`notificationPreview`).

## F2 — Poll results, clearer

Each option shows its share (`75%`) beside the count; the member's own
option carries a **Your vote** chip, with a quiet "You can change your vote
any time." under the total. The vote total was hardcoded English
("4 votes"); it now uses the plural pair `polls.total`. Client-only
(`public/js/polls.js`); guests see shares and totals, never the chip.

## F3 — Search highlighting

The searched words are highlighted in reply results and member names on
the search page. Spoilers are masked first, so a hit never reveals one.
`public/js/search-highlight.js` builds text nodes and `<mark>` elements
only (no HTML strings); when lowercasing changes a string's length (e.g.
"İ") it skips highlighting rather than mark the wrong letters.

## Strings

8 new keys (`bell.threadGroup.one/.other`, `bell.threadGroupPreview.one/
.other`, `polls.yourVote`, `polls.total.one/.other`, `polls.changeHint`)
in en.json and all 20 locales, real translations.

## Tests

`tests/wave16.test.mjs` (17): read-thread touches only the caller's own
label-less rows for that thread (not mentions, other threads or other
members); anonymous, missing-CSRF and cross-origin calls refused with rows
unchanged; 405/404; LIMIT + placeholder pin; grouping order and unread
state; preview masking incl. a cut-open spoiler; page renders one thread
row; poll shares, Your-vote gating, translated total; highlight splitting,
the length-drift fallback, `<mark>` building; locale parity.
