# Feature slate — wave 2026-11-21-25 (v4.30.0)

Theme: docs catch-up for v4.16–v4.29, project skills refresh, and one small
member feature. No migration. No new route. No server change.

## F1 — Docs

- `README.md` "What's in it" rewritten to cover v4.16–v4.30: IME-safe Enter,
  You chip, fold reply / fold all, first-post / latest / my-reply / author
  jumps, member since, recent threads, wall formatting, QOTD chip + banner +
  You answered, showcase gallery, grouped notifications, poll percentages +
  Your vote, search highlighting, spoilers covered on every preview path +
  Show spoilers, Download my data (what's in / what's never in), settings
  filter + jump list, newcomer + tips cards, image viewer steps, gallery
  recents + sort, Ctrl/Cmd+Enter, formatting help, quote selection, sign-out
  always wipes local data.
- New `docs/moderation.md`: desk sections, Recent activity peek (10 newest
  posts), Hide posts (1–50, closes open reports), per-post Restore on Hidden
  posts, banned members' posts return on unban, focus lands on the h1 after
  a repaint. No security internals.
- `docs/chat-widget.md`: IME-safe Enter in the DM composer and mention list
  (`isImeComposing`, focus-utils.js).

Every claim was grep-checked against en.json labels and the code
(`api/mod-tools.mjs` PEEK_LIMIT 10 / HIDE_RECENT_MAX 50,
`public/js/routes/admin.js` per-post restore, `public/js/desk/reports.js`
dismiss / hide post / ban form).

## F2 — Project skills (gitignored, main checkout)

- `wempos-forum-test-harness`: fake-dom.mjs mandatory for DOM tests,
  HTMLCollection/NodeList realism, selector limits, parser fuzz pin.
- `wempos-forum-patterns`: maskedExcerpt + the wave-17 static sweep,
  `:u<id>` keys + `wipeAccountLocalData()`, `isImeComposing`,
  modulepreload + `tests/load-path.test.mjs`.
- `wempos-forum-visibility-law`: the profile-threads / traditions shared
  filter pattern for new public reads.

## F3 — Next reply from the author (members)

On a thread page, when a loaded reply came from the member who started the
thread, a quiet **Next reply from the author** button sits beside "Jump to my
reply". Each press moves focus (and the view) to the starter's next top-level
reply, the cards with the "Author" chip in their own header, and wraps back
to the first after the last.

Why this one: the "Author" chip (v4.12) marks the starter's answers, but in a
long thread a reader still has to scroll and scan for them. This lets them
follow the starter's side of the conversation in one press each. Not shipped
before: it is not J/K (every post), not "Jump to my reply" (your own), and
not a filter (hiding other replies would break J/K and the other jumps).

Shape: `createNextAuthorReplyJump(document, replyList, replies, starterId)`
in `public/js/latest-reply.js`, using `isThreadStarterReply`
(thread-starter.js). Cards are read at click time, so it stays right after
"Load older replies". A starter chip on a nested sub-reply does not count for
its parent card. Page view only: no request, no storage.

## Strings

1 key x 21 locales: `post.nextAuthorReply`.

## Tests

`tests/wave25-author-jump.test.mjs` (7): gating (no list / no starter /
no starter reply), in-order steps + wrap, nested chip ignored, click-time
read after a prepend, no-op with no starter card, wiring + CSS + no-storage
pins, locale parity. RED (missing export) before the code.
