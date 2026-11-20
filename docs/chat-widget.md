// Docs page for the chat widget wave (W-CHAT + day-2, shipped 2026-11-20 at 2dc444a). The repo's other docs/*.md carry no AGPL banner (see license-ledger.md's per-file rule for which file kinds do), so this page rides the doc convention.

# Chat widget + Who's Online

The widget ships on `main` at commit 2dc444a and later: a floating launcher in the
bottom-right of every page, expanding into the DM panel, plus the Who's Online
roster as its separate bottom-left surface. Zero migrations — everything rides the
tables `0032_presence_chat.sql` created (presence, dm_threads, dm_messages,
unread counters `0038`).

## Endpoints (api/chat.mjs, wired in the worker's API_HANDLERS tail)

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/presence` | signed-in | Heartbeat. Body `{invisible?: 0\|1}` optional — with it, upserts the flag; without, keeps it. Response echoes `{ok, invisible}` (the stored truth) so clients can read their own state. |
| `GET /api/presence` | optional | Roster: `{now, online:[{id, username, role}]}` — users with `last_seen >= now-300` (PRESENCE_WINDOW), invisible=0 only, never a `last_seen` timestamp in the payload. |
| `GET /api/dm/threads` | signed-in | Thread list: `{threads:[{id, other, unread, lastMessageAt, lastMessagePreview(<=80)}]}`, newest activity first. |
| `GET /api/dm/threads/:id` | participant | `{id, other, unread, messages}` newest-first LIMIT 50; `?after=<id>` walks OLDER pages for scrollback. Banned authors' rows vanish at read time (wall's predicate). |
| `POST /api/dm/threads/:id` | participant | Send `{body}` 1..1000 chars: ban check → rate limit → block pair 403 → word filter at intake → insert → exactly ONE bump of the OPPOSITE side's unread counter. 201 `{message}`. |
| `POST /api/dm/threads/:id/read` | participant | Zeroes the viewer's own unread counter only. |
| `POST /api/dm/threads` | signed-in | Open-or-return. Body `{userId}` or `{username}` (trim+lowercase → `username_key`). Self-pair 400, block pair 403, canonical pair (MIN/MAX) via `INSERT OR IGNORE`. `{id, other}`. |

## Client surfaces (public/js)

- `chat-widget.js` — self-mounting; the single boot probe `GET /api/dm/threads`
  decides everything (signed-out or endpoint-missing renders no DOM). Timers:
  open panel 5s / closed unread 30s; sends are single-flight (the 11-12
  double-send defect's UI fix); renders via createElement/textContent only.
  Exports `openChatThread(threadId)` for other modules (the profile page's
  Chat button uses it).
- `who-online.js` — the roster's OWN surface (bottom-left card, hidden ≤640px);
  renders signed-out too; the presence beacon lives HERE alone (boot + 60s,
  signed-in only). Invisible mode is set from the account page's toggle
  (renderInvisibleToggle in routes/feed.js), read back from the heartbeat echo.
- Polling sleeps whenever `document.hidden`; the api() wrapper is the only
  transport (fetch; XHR banned fleet-side).
