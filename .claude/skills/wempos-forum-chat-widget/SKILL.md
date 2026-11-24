---
name: wempos-forum-chat-widget
description: "Use when editing public/js/chat-widget*.js, chat-pins/mutes/filter, group-rename or who-online.js — the bottom-right chat (Lobby + DMs + group DMs), GIFs in chat, the Who's Online card — or debugging chat polling, drafts, or unread badges"
metadata:
  version: "1.1.0"
  source: local-git-analysis + session (re-verified 2026-11-21 at v5.0.0)
---

# Chat widget conventions

## Modules (wave 2026-11-21-5 split)
- `chat-widget.js` — launcher + panel, timers, mount. `chat-widget-state.js` — shared mutable state bag. `chat-widget-threads.js` — thread list (1:1 + group), badge, unread-only checkbox (`chat.unreadOnly`), New-chat strip. `chat-widget-composer.js` — open conversation + composer. `chat-widget-lobby.js` — Lobby tab. `chat-widget-gifs.js` — `[gif:<id>]` tokens, picker, body node.
- Local-only, opt-in helpers: `chat-pins.js` (`MAX_PINNED_CHATS = 5`), `chat-mutes.js` (muted chats don't count toward the badge), `chat-filter.js` (name filter, sends nothing), `group-rename.js` (creator-only form; caller does `PATCH /api/dm/groups/:id`). Pins/mutes keys are account-scoped (`:u<id>`) and wiped via `clearAllPins`/`clearAllMutes` in `wipeAccountLocalData()`.
- `who-online.js` — bottom-left roster, its own surface; owns the presence heartbeat (`/api/presence`) — the widget must not send presence.

## Laws
- Boot: one probe `GET /api/dm/threads`; failure = mount nothing, no timers (signed-out stays inert). The Lobby tab appears only after `GET /api/chat` succeeds.
- Polling (`chat-widget.js`): `PANEL_POLL_MS` 5s while open, `LOBBY_POLL_MS` 15s, `UNREAD_POLL_MS` 30s while closed; every timer bails when `document.hidden`.
- Sends are single-flight (flag + disabled button gate both Enter and click); Enter first bails on `isImeComposing(event)`.
- The 5s repaint rebuilds the composer: carry the draft (value, cursor, focus) only within the same thread id.
- Rendering: createElement/textContent only, never innerHTML with user content.
- GIFs: a body that is exactly `[gif:<uuid>]` renders from `/api/gifs/:id`; unknown ids fall back to text.
- Strict-mode pitfall: every module variable must be declared (an undeclared `lobbyOnline` threw on every poll).

## Server
- `api/chat.mjs` — lobby (`/api/chat`), 1:1 DMs (`/api/dm/threads…`), presence; read-time `ACTIVE_BAN_SQL` filters on lobby, DMs and presence. Shared lobby helpers back the MCP lobby tools.
- `api/dm-groups.mjs` — `/api/dm/groups[/:id[/read|/leave|/members[/:uid]]]`; `api/dm-images.mjs` — thread/group image uploads + `/api/dm/images/:uuid`.
- Index: `idx_forum_perf_dm_threads_user_b ON dm_threads(user_b)` (migration 0059) serves the thread list's `user_a OR user_b` lookup.
