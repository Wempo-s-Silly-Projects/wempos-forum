# Feature slate — wave 2026-11-21-23 (v4.28.0)

Theme: F1 hardening of the v4.24–v4.27 delta (`git diff 125ec91..7dc932f`),
with an independent check of the v4.24 inline parser, plus one small member
feature. No migration. No new route. No server change.

## F1 — Hardening review

### a. Inline parser (public/js/markdown.js, forward-cached finders)

Independent generator (`tests/helpers/markdown-fuzz.mjs`, seeded mulberry32),
not derived from the wave-19 self-fuzz: nested/overlapping `** __ || \` * ~~`,
unterminated and mismatched closers, 17 link shapes (http/https/upper-case,
`/path`, padded, `javascript:`, `JaVaScRiPt:`, `//host`, `data:`, tab,
backslash, empty label, `![img]`, nested brackets, parens in URL, gap, open),
8 mention shapes, line leads (list/quote/heading/fence), surrogate pairs, lone
surrogates, ZWJ, RLM/RLO/LRI, combining marks, BOM, NBSP, ideographic space;
1 in 6 bodies capped at 4750 chars (sliced, so some end mid-pair). Every
body runs as a whole (the wall path) and as each post-page inline run.
Spoiler text uses per-body-unique CJK sentinels, so "a char left a rendered
spoiler" is exact.

| Check | Result |
|---|---|
| Bodies run | 90,084 generated (seeds 23 / 1123 / 90210) + 28 pathological 4750-char bodies |
| Inline runs checked | 1,058,059 |
| (1) text == input minus consumed markers | 0 faults |
| (2) hrefs only http(s):// or `/` (not `//`), mentions `/users/[A-Za-z0-9_]+` | 0 faults |
| (3) maskSpoilers shows no char rendered inside a spoiler | 0 leaks |
| (4) worst time, 4750-char body (best of 3) | parse 0.99 ms (`"@a "` repeated), mask 0.31 ms; random capped bodies: parse 0.26 / mask 0.19 ms |
| Rendered-node equivalence vs v4.23 (`125ec91`) | 0 diffs across all 1,058,059 runs (tag, text, href, class, rel, target) |
| v4.23 worst on the same pathological set | 87.35 ms |

Single-shot timings showed up to 25 ms spikes; re-timed, the same bodies take
~0.1 ms, so those spikes were GC pauses, not parser cost. Mutation sanity:
the checker flags a dropped node, a duplicated node, an unsafe href and an
identity mask. Suite pin: `tests/wave23-parser.test.mjs` (1,528 bodies, the
same four properties, 5 ms budget, best of 5).

### b. readSession joinedAt (api/core/auth.mjs:103,124)

PASS. Additive field only; null when `created_at` is falsy. `users.created_at`
is `INTEGER NOT NULL` (0001_initial.sql:13) and the only writer stores
`nowSeconds()` (api/session.mjs:55-61), so the `toISOString` RangeError path
is unreachable. Consumers: newcomer.js:84 (Date.parse + isFinite guard).

### c. Client delta

- lightbox.js: PASS. src comes only from the `img` inside the strip's
  own `.attachment-expand` buttons; `showModal` makes the page inert;
  close returns focus to the last-shown thumbnail.
- gallery-picks.js: PASS. Keys are scoped `:u<id>`, ids are shape-checked,
  recents are filtered against the approved `/api/gifs` list, and sign-out
  wipes them (account-nav.js:275).
- newcomer.js: PASS. Keys are per account and wiped on sign-out
  (account-nav.js:273); starter links resolve (`showcase`, boards.js:41;
  `/rules`, router.js:49).
- submit-shortcut.js: PASS. Goes through requestSubmit; the guard flag is set
  synchronously before the await (app.js:400-408).
- reply-fold.js fold-all: PASS. Cards are direct children of the reply list
  (post.js:66, older replies prepended at :237); per-card toggles re-sync
  on bubble.
- a11y pass 2: PASS. Notifications rerender on read, so no stale "Unread" tag.

Real defects: none. LOW (not changed):
- wall.js:88 parses the whole wall body as ONE inline run, while
  maskSpoilers masks per block, so a spoiler spanning a `- ` line could
  differ. No masked surface shows wall bodies today; this only matters if
  one is added.
- lightbox.js:85 `show()` returns early when a thumbnail has no `img`, which
  would leave the previous image showing. Thumbnails always carry an img
  today.
- account-nav.js:268 if the logout POST throws, the local wipes (drafts,
  newcomer, recents) are skipped. This predates the delta.
- post.js:74 the fold-all toggle is gated on the first page's reply count.

## F2 — Formatting help

A closed `<details>` "Formatting help" under the new-thread and reply
composers (`createTextarea({ formatHelp: true })`; not the wall, which is
inline-only). 11 rows of language-neutral syntax (`**…**`, `[…](https://…)`,
`- …`, ```` ``` ````) with translated labels, plus a note that HTML and images
stay plain text. Static: no network, nothing stored.
`public/js/format-help.js`, `public/js/forms.js`, styles `.format-help*`.
Tests (`tests/wave23-format-help.test.mjs`) pin every row to what
parseInline/parseBlocks really render, so the help can't promise a format
the post page ignores.

## Strings

`format.summary`, `format.note`, `format.bold|italic|strike|code|spoiler|link|
mention|list|quote|heading|codeBlock`: 13 keys in en + all 20 locales.

## Tests

`pnpm test`: 448 pass, 0 fail (438 baseline + 4 parser + 6 format-help).
