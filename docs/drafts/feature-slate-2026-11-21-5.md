# Feature slate — wave 2026-11-21-5 (release v4.10.0, close the LOWs + split the widget)

Through-line: **finish the wave-4 hardening, make the chat widget
maintainable again, then one small chat comfort.** No migration, no new
server-side storage, no new tracking.

Laws every feature rides: vanilla ES modules + 17-line AGPLv3 header on new
files; createElement/textContent only; fetch through the one `api()`
wrapper; `api/vendor/**` untouched; the visibility law on every list and
counter; every painted string keyed in `public/locales/*.json` (21 tables,
real translations); opt-in, never default-on.

Not duplicated (already shipped): drafts, mentions, catch-up, thread at a
glance, group DMs, DM images, message effects, spoilers, live preview,
language picker, copy link, text size.

## F1 — Wave-4 LOWs

1. The 1:1 half of `GET /api/dm/threads` had no LIMIT. It is now the newest
   `DM_THREAD_LIST_LIMIT` (50) threads.
2. Unread counters (group rows, 1:1 rows and the lobby badge) counted
   messages that the visibility law hides at read time. Group unread is now
   the number of the newest `unread` messages by other members whose author
   has no active ban and no block pair with the viewer (a `ROW_NUMBER()`
   window over groups with a non-zero counter). A 1:1 thread with a banned or
   block-paired member shows 0. Read-time only, so an unban restores the count.
3. A creator add racing the creator's own last-member leave hit a foreign-key
   failure (500). The add's INSERT now also requires the creator to still be a
   member, in the same statement as the cap, and answers 404 when it loses.
4. Members in more than 50 groups could not reach older ones. The groups key
   pages behind `?before=<activity seconds>.<group id>` (`groupsCursor` in
   the response, null on the last page). The widget shows an "Older groups"
   button and keeps loaded pages across its 5s refresh.
5. Catch-up markers were stored under one browser-wide key. They are now keyed
   per account (the drafts idiom) and cleared on sign-out.

Acceptance (RED first, `tests/wave5-fixes.test.mjs`): 55 threads → 50 newest
shown; banned/blocked group authors are excluded from group unread and from
dmUnread; a 1:1 thread with a banned member reads 0; a raced add answers 404;
55 groups page 50 + 5 with no overlap and a bad cursor answers 400; catch-up
keys are per account and the sign-out wipe leaves other keys alone.

## F2 — Maintenance: split `chat-widget.js`

961 lines → `chat-widget.js` (boot law, panel shell, tabs, profile door) plus
`chat-widget-state.js`, `-gifs.js`, `-lobby.js`, `-threads.js` and
`-composer.js`. Zero behavior change: every moved line is verbatim apart from
the shared `let`s becoming properties of one state bag (the
`public/js/state.js` idiom). Existing tests stay green and unedited. A
fake-DOM differential run (boot, tabs, open DM, send, poll, back, open group,
lobby send, close, reopen) gives an identical DOM and request log before and
after.

## F3 — UNIQUE: Pinned chats

A "Pin chat" toggle in the open conversation's header (aria-pressed). Pinned
conversations, 1:1 or group, sit at the top of the chat list with a small pin
mark (screen readers hear "Pinned"). Up to 5; when the list is full the
toggle is disabled with a note, and no older pin is ever dropped silently.
Why: regulars have two or three people they talk to every day. With group
DMs in the list, those chats get pushed down by whatever is busiest.
Harmless: opt-in per click, stored only in this browser under the member's
own key, never sent to the server, cleared on sign-out. Values read back are
shape-checked (`dm:<id>` / `group:<id>`).
Acceptance (RED first, `tests/chat-pins.test.mjs`): per-account keys
round-trip; toggle is immutable and refuses past the cap; pinned-first sort
keeps activity order; corrupt or blocked storage reads as no pins; the
sign-out wipe; wiring pins in the list, the composer and account-nav.
