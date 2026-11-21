# Chat and Who's Online

When you're signed in, every page has a chat button in the bottom-right corner. It opens a panel with two tabs:

- **Lobby**: one public room for everyone on the forum.
- **Messages**: private one-to-one direct messages (DMs).

Who's Online is a separate small card in the bottom-left corner. It lists the members active right now and is hidden on narrow screens (640px and below).

All of this lives in `api/chat.mjs` (server) and `public/js/chat-widget.js` plus `public/js/who-online.js` (browser). The tables come from migrations `0032_presence_chat.sql` and `0038_dm_unread_counters.sql`.

## Lobby

| Route | Who | What it does |
|---|---|---|
| `GET /api/chat` | anyone | Returns the newest 50 messages, or messages after `?after=<id>`, plus the online count and a roster of up to 60 visible members. Signed-in members also get their DM and notification unread totals in the same response, so one poll keeps both badges fresh. |
| `POST /api/chat` | signed in | Posts a message (up to 500 characters). Checks bans, rate limits, and the word filter, then pings any @mentions. |
| `DELETE /api/chat/:id` | staff | Deletes a lobby message. The lobby is ephemeral, so deletion is permanent and nothing is archived. |

The lobby counts someone as online if they were seen in the last 3 minutes.

## Direct messages

| Route | Who | What it does |
|---|---|---|
| `GET /api/dm/threads` | signed in | Your conversations, newest activity first, each with the other person, your unread count, and a short preview (up to 80 characters). |
| `POST /api/dm/threads` | signed in | Opens a conversation with `{userId}` or `{username}`, or returns the existing one. You can't message yourself, and blocked pairs get a 403. |
| `GET /api/dm/threads/:id` | participants | The newest 50 messages. Pass `?after=<id>` to page back through older ones. Messages from banned members are hidden. |
| `POST /api/dm/threads/:id` | participants | Sends `{body}` (1 to 1000 characters). Checks bans, rate limits, blocks, and the word filter, then bumps the other person's unread count. |
| `POST /api/dm/threads/:id/read` | participants | Marks the conversation read for you. |

## Presence

| Route | Who | What it does |
|---|---|---|
| `POST /api/presence` | signed in | Heartbeat. Send `{invisible: 0 or 1}` to change your invisible setting, or an empty body to keep it. The response echoes your stored setting. |
| `GET /api/presence` | anyone | Members seen in the last 5 minutes who aren't invisible. It never exposes exact last-seen times. |

## In the browser

- `chat-widget.js` mounts itself. On load it calls `GET /api/dm/threads`; if that fails (signed out, or the endpoint is unavailable) the widget draws nothing and doesn't poll. The Lobby tab stays hidden until `GET /api/chat` answers. While the panel is open it refreshes conversations every 5 seconds and the lobby every 15; while it's closed it checks unread counts every 30 seconds. Nothing polls while the browser tab is hidden. Sending is one message at a time, so a double click can't send twice. Other code can call `openChatThread(threadId)` to jump straight into a conversation (the Chat button on profiles uses this).
- `who-online.js` draws the roster for everyone, signed in or not. For signed-in members it also sends the presence heartbeat, on load and every 60 seconds.
- You can turn invisible mode on or off from your account page.
- All requests go through the shared `api()` helper in `public/js/api.js`, which uses `fetch`.
