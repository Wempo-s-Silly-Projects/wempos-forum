# Feature slate — wave 2026-11-21-14 (v4.19.0)

Three small things that celebrate the community's traditions: the Question
of the Day (QOTD) threads and the showcase board. One new read-only module
(`api/traditions.mjs`, two GET routes), no migration, nothing new stored,
no new tracking.

## F1 — QOTD chip + today's question

- Every root thread whose body opens with "QOTD" (any case, leading
  whitespace ignored) carries a **QOTD** chip on its card, titled
  "Question of the Day" in the reader's language. Client-only
  (`isQotdBody`, `public/js/traditions.js`); replies never get it.
- The home feed (Recent activity, not search) shows a **Today's question**
  banner linking to the newest QOTD thread from the last 24 hours. No QOTD
  today → no banner (the slot removes itself).

Route: `GET /api/traditions/qotd` → `{ qotd: { id, body, board, createdAt,
answered } | null }`. The prefix test runs in SQL
(`UPPER(SUBSTR(LTRIM(body, ws), 1, 4)) = 'QOTD'`), `LIMIT 1`.

## F2 — Showcase gallery

The showcase board gains a **Gallery** panel above its thread list: an
image-first grid of up to 24 tiles, newest first, each the thread's first
approved image (lazy, versioned URL), a two-line spoiler-masked caption and
the author's name, linking to the thread.

Route: `GET /api/traditions/showcase` → `{ items: [{ id, body, authorName,
createdAt, image: { id, version } }] }`. Candidates need an approved image
whose hash is not revoked (`LIMIT 24`); covers come from the shared
`attachmentRowsForView(…, null)` (anonymous view = approved only, plus the
byte-existence filter), so a tile never points at a 404.

## F3 — "You answered"

When a signed-in member has already replied in today's QOTD (at either
reply level) the banner carries a **You answered** chip. Computed per
request from existing replies; guests always get `false`; the response is
`Cache-Control: no-store` (the shared `json()` default). Nothing is stored.

## Visibility law (both routes, tests written RED first)

- public roots only — hidden never shows, not even to staff or the author;
- author with an ACTIVE ban → excluded (read-time `banFilterSql`; an expired
  or revoked ban restores with no write);
- block pairs dropped both ways for signed-in members via
  `viewerBlockFilterSql` (staff bypass, like every feed list);
- replies are never QOTDs or tiles; revoked/pending images never cover.

Mutation check: stripping the filters fails 6 of the visibility tests.

## Strings

7 new keys (`traditions.qotdTitle`, `qotdToday`, `qotdAnswered`,
`galleryTitle`, `galleryEmpty`, `galleryLoadFailed`, `galleryAlt`) in
en.json and all 20 locales, real translations; `{title}` survives. The chip
text "QOTD" stays literal — it is the community's own tag.

## Tests

`tests/wave14.test.mjs` (19): QOTD pick/window/prefix/shape; hidden, ban,
expired-ban, block (both ways) for both routes; answered at level 1/2, other
thread, guest; gallery order/cover/board/pending/reply/revoked/limit-24;
GET-only; `isQotdBody`; banner and gallery DOM; wiring pins; locale parity.
