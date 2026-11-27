# Feature slate — wave 2026-11-21-13 (v4.18.0)

Three small profile-side delights. One new read-only route, no migration,
nothing new stored, no new tracking.

## F1 — Member since

Every profile shows **Member since {date}** under the post counts, formatted
by `Intl.DateTimeFormat` in the reader's own language (e.g. "March 5, 2026",
"5. März 2026"). The date is the account's existing `users.created_at`; it
rides the profile's counts query as `joinedAt` (ISO). The block-pair
"unavailable" payload does not carry it. A refused locale falls back to
English; an unparseable stamp renders nothing.

Why: a small warm community likes to see who has been around since the
beginning. Harmless: a date the forum already holds, shown on a page that is
already public.

## F2 — Recent threads (visibility law)

A **Recent threads** panel above the wall lists the member's five newest
threads as links to `/posts/:id`, each with its date.

Route: `GET /api/users/:id/threads` (`api/profile-threads.mjs`, registered in
the profiles dispatcher). Rules, each with a test written RED first:
- public roots only — hidden roots never show, not even to staff or the
  author (this is the public face of the profile);
- an author with an ACTIVE ban lists nothing (read-time `banFilterSql`, so an
  expired or revoked ban restores the list with no write);
- a block pair refuses the read with 403 in both directions, like the profile
  and wall; staff are exempt from that gate;
- replies are not threads and never list;
- rows are hand-shaped to `id, body, board, createdAt` — no author row is
  joined, so no private field can ride along;
- unknown member 404; non-numeric id never matches the route.

Client: `public/js/profile-extras.js`. Excerpts mask spoilers BEFORE cutting
to 120 characters, so a spoiler split by the cut can never leak. Empty body
reads "Untitled thread". The panel is appended synchronously and checks
`renderVersion` after the fetch, so a fast route switch never paints into the
next page.

## F3 — Wall posts read like posts

Wall post bodies now render through the same `parseInline` used by posts:
bold, italics, inline code, safe links, and click-to-reveal `||spoilers||`.
Built with createElement/textContent only; the 280-character cap, word filter
and auto-mod are unchanged.

## Strings

5 new keys (`profile.joined`, `profile.threadsTitle`, `profile.threadsEmpty`,
`profile.threadsLoadFailed`, `profile.threadUntitled`) in en.json and all 20
locales, real translations; the wave-13 test checks every locale has them,
none is left in English, and `{date}` survives.

## Tests

`tests/wave13.test.mjs` (14): joinedAt shape and block-pair omission; locale
formatting; thread list order/limit; hidden, banned, expired-ban, block-pair
(both ways, staff exempt), field-shape and 404 cases; excerpt masking; panel
DOM; route and wall wiring; locale parity.
