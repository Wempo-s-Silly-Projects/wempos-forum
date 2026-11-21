# Feature slate — wave 2026-11-21-29 (v4.34.0)

## F1 — Feed reply-count rollup, code-side (perf, zero behavior change)

The wave-28 plan pass named the feed's reply-count rollup
(`replyCountsSql`, api/posts-feed.mjs) the slowest hot statement. Its WHERE
was `l1.parent_id IS NULL OR l1.parent_id IN (ids)`: the IS NULL arm made it
join and group EVERY level-1 reply in the table, and the page's ids only
narrowed the level-2 arm.

Rewrite: two arms under UNION ALL, split on `l1.parent_id IS NULL` (so they
are disjoint), each scoped to the page's ids: level-1 rows by
`r.parent_id IN (ids)`, level-2 rows by `l1.parent_id IN (ids)`. Both plan as
SEARCH on `idx_posts_parent_replies`. Same member, ban, block and nuke-rule
clauses as before. IN-list size = page size (20) per arm, well under D1's
bound-parameter limit. No migration.

Timing (node:sqlite adapter, all migrations, 2k users, 20.0k posts: 4k
roots, 16k replies at 35% level-2, 3% hidden, 100 bans, 2k blocks, ANALYZE;
first feed page's 20 root ids; mean of 20 runs):

| Viewer | Old ms | New ms |
|---|---|---|
| member (with blocks) | 5.142 | 0.120 |
| admin (no block clause) | 4.294 | 0.078 |

Counts identical at volume for both viewers.

Differential test (`tests/wave29-feed-rollup.test.mjs`): a frozen copy of
the old SQL against the live one over a seeded forest (40 roots, 260 level-1,
180 level-2, 12% hidden; bans active-permanent, active-timed, expired,
revoked; a block pair in both directions; a deleted level-1 reply with its
cascaded sub-replies and a deleted sub-reply), for anon, member, blocker,
blocked, banned member, moderator, admin, owner: page by page, plus a mixed
id list with level-1 ids, plus GET /api/posts end-to-end, plus a plan pin
(no SCAN of posts). Mutation-checked: dropping the level-2 parent clause,
the level-1 `l1.parent_id IS NULL` guard, or the block clause each fails it.

## F2 — Keyboard shortcuts sheet (members and guests)

A closed-by-default "Keyboard shortcuts" disclosure beside the J/K hint on a
thread page (shown when the thread has replies, like the hint). It lists the
shortcuts the forum already has: J/K posts, Ctrl/⌘+Enter posts, the image
viewer's arrow keys and Home/End, ↑/↓ + Enter/Tab in @mention suggestions,
Esc. Not shipped before: the keys were only mentioned one at a time in tips.

- Native `<details>`/`<summary>`: keyboard and screen-reader operable with no
  script. It binds no keys, so WCAG 2.1.4 (character-key shortcuts) is not
  touched; a global "?" opener was rejected for that reason.
- Each row is one translated sentence, since locales name keys their own way
  (Strg, Entrée, Intro). Arrow wording is direction-neutral because the image
  viewer mirrors arrows on RTL pages.
- Nothing stored, nothing sent; createElement/textContent only.

## Strings

6 new keys (`shortcuts.title`, `.posts`, `.submit`, `.images`, `.mentions`,
`.close`) in en and all 20 locales.

## Tests

- `tests/wave29-feed-rollup.test.mjs` (6): differential, mixed ids, showAll
  binds, /api/posts end-to-end, plan pin, fixture coverage.
- `tests/wave29-shortcut-sheet.test.mjs` (5): structure, every row backed by
  real wiring, placement + preload + CSS, page-view only, locale parity.

## Gates

No migration, no remote D1 step. Deploy follows the normal push then
`pnpm run deploy` order.
