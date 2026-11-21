# Feature slate — wave 2026-11-21-6 (release v4.11.0, Lobby history + two chat comforts)

Through-line: **the Lobby shows its history again, the badge tells the
truth, and two small chat comforts.** No migration, no new server storage,
no new tracking, no new request on the client's poll rhythm.

Laws every feature rides: vanilla ES modules + 17-line AGPLv3 header on new
files; createElement/textContent only; fetch through the one `api()`
wrapper; `api/vendor/**` untouched; the visibility law on every counter;
every painted string keyed in `public/locales/*.json` (21 tables, real
translations); opt-in, never default-on.

Not duplicated (already shipped): drafts, mentions, catch-up, glance, group
DMs, DM images, message effects, spoilers, preview, language picker, copy
link, text size, pinned chats.

## F1 — Lobby history never painted on open (bug)

`paintLobbyLog` in `public/js/chat-widget-lobby.js` was defined but never
called, so the newest 50 messages seeded by the boot probe stayed off screen
and the Lobby looked empty until someone posted. `seedLobby(data)` now holds
the boot probe (log, `lastId` cursor, online count) and `openPanel` calls
`paintLobbyLog()` right after the `/api/session` probe, so "mine" rows and
the staff delete arm are right on the first paint. The poll resumes at
`?after=lastId` and dedupes by id, so the next tick does not repaint rows.

## F2 — Wave-5 reviewer LOWs

a. Older group pages stayed cached after the viewer was removed from one of
   those groups. A 404 on opening or polling a group now drops it from both
   `ui.groups` and `ui.olderGroups` (`dropGroup`) and returns to the list.
b. The badge summed only the loaded pages (50 threads + loaded group pages).
   `GET /api/dm/threads` now carries `dmUnread` — the same whole-account,
   visibility-law total the lobby read already returned (one shared
   `viewerDmUnread` helper) — and the badge paints it. Older servers without
   the key fall back to the old sum.

## F3 — Lobby reply

A small "Reply" button under other members' Lobby rows prefills `@name ` in
the send box, keeping anything already typed and putting the cursor at the
end. The existing @mention ping on send does the rest. Pure helper
`public/js/lobby-reply.js` (`withReplyMention`), capped at the 500-char body.

## F4 — Chat list quick filter

A search box above the DM/group rows narrows the list by the name each row
shows (case-insensitive substring). Local-only: it filters rows already
loaded and sends nothing. Mounted outside the 5s-repainted rows so typing
survives the refresh; cleared when the panel closes. Pure helper
`public/js/chat-filter.js` (`filterConversations`).

Acceptance (RED first, `tests/wave6-fixes.test.mjs`, 10 tests): seeded log
painted after the session probe; poll dedupe + cursor pinned; group 404 drop
wired; a removed member's group read answers 404; 53 unread groups → list
shows 50, `dmUnread` = 53 and equals the lobby's; badge reads `ui.dmUnread`;
`withReplyMention` and `filterConversations` edge cases; wiring pins.
Strings: `chat.reply`, `chat.replyTo`, `chat.filterChats`,
`chat.noFilterMatch` in all 21 tables.
