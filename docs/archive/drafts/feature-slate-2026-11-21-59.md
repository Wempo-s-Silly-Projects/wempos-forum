# Feature slate 2026-11-21-59 (wave 5.9, v5.9.0)

Area: direct messages / group chats, the search page, profile walls. All three
are client-only: no server change, no migration, no new storage key, no new
network call. Checked against every `docs/archive/drafts/feature-slate-*.md` — none of
these shipped before (closest: v4.21 search highlighting, v4.32 "Unread only"
on the chat list, v4.0/v4.17 wall rendering).

## F1 — "New messages" line in a chat (unique)

- **What**: opening a DM or group chat that has unread messages draws a
  divider ("3 new messages") right above the first message you had not read.
  It stays put across the 5s repaint and while you read; it goes away when you
  leave the chat or open another one.
- **Why**: in a busy group you lose your place — the line shows where you left
  off without scrolling back and guessing.
- **How**: on a fresh (non-silent) `openThread`, the conversation payload's own
  `unread` count picks the oldest of the newest `unread` messages written by
  someone else (`firstUnreadId`), stored in `ui.newSince` keyed by the
  conversation. `paintConversation` inserts the divider before that bubble.
  Silent polls never move it. Zero unread clears it. Uses only data the reader
  already has (no DM content or membership leaves the widget).
- **Files**: new `public/js/chat-new-divider.js`; `public/js/chat-widget-composer.js`,
  `public/js/chat-widget-state.js`, `public/css/` (one rule).
- **Strings**: `dm.newMessages.one/other`.
- **Tests**: `tests/wave59-chat-new-divider.test.mjs` — pure picker (own
  messages skipped, unread > page clamps to the oldest loaded, 0 → null, input
  not mutated), divider is `role=separator` text-only, composer wiring pins
  (non-silent open sets it, silent never does), no storage/api in the module.

## F2 — Search results at a glance (unique)

- **What**: under "Results for …" a small "Jump to:" row lists what was found —
  "2 replies · 1 member · 5 posts" — and each one jumps to (scrolls to and
  focuses) its section. Sections with nothing found are left out; when nothing
  at all matched the row isn't drawn.
- **Why**: search shows replies, then people, then posts; on a phone the posts
  you wanted can be several screens down.
- **How**: `createSearchSummary(document, results, findTarget)` counts the
  arrays already in the `/api/search` payload; the section headings get ids
  (`search-replies`, `search-people`, `search-posts`). Page-view only.
- **Files**: new `public/js/search-summary.js`; `public/js/routes/feed.js`
  (`renderSearchResults`), CSS.
- **Strings**: `search.jumpTo`, `search.summaryLabel`, `search.jumpReplies.*`,
  `search.jumpPeople.*`, `search.jumpPosts.*`.
- **Tests**: `tests/wave59-search-summary.test.mjs` — counts, zero sections
  dropped, null when empty, replies section only when the payload has one,
  click focuses the target, plural keys, no storage/api.

## F3 — Reply on a wall post

- **What**: signed-in visitors see a "Reply" button on other members' wall
  posts; it puts `@name ` at the start of the wall box and focuses it, cursor
  at the end. Nothing is sent until you post.
- **Why**: walls are conversations, but answering someone meant typing their
  name by hand.
- **How**: `mentionPrefill(value, username, max)` never doubles the mention
  and respects the 280-char cap; the button is not shown on your own posts or
  to guests.
- **Files**: new `public/js/wall-reply.js`; `public/js/wall.js`.
- **Strings**: `wall.reply`, `wall.replyAria`.
- **Tests**: `tests/wave59-wall-reply.test.mjs`.

## Laws

- Defaults: nothing activity-revealing; no network action added.
- Text via `textContent` only; no innerHTML.
- Strings in en.json + all 40 other locales, really translated.
- No new localStorage keys (nothing to register in the wave24/27 wipe sweeps).
