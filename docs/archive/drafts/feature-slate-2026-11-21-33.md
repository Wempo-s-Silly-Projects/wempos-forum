# Feature slate — wave 2026-11-21-33 (v4.38.0) — feed discovery

Not shipped before (checked against feature-slate-2026-11-21*.md, api/ and
public/js): the feed had one order per surface (bump order; Suggestions its
own) and no way to find threads still waiting for a reply. A "Latest
activity" sort was considered and dropped: the default feed already orders
by `last_activity_at`. Category tabs already act as board chips.

## F1 — Unanswered filter (`GET /api/posts?unanswered=1`)

- Roots with no reply the viewer could see. A level-1 reply counts only
  when `visibility = 'public'`, its author has no active ban
  (`banFilterSql`), and it is not from a block pair with the viewer
  (`viewerBlockFilterSql`). Same rule as the card's `replyCount` (the nuke
  rule), so every card the filter returns shows 0 replies.
- Decision: a thread whose only replies come from someone you blocked reads
  **unanswered for you** (the replies are invisible to you, and its card
  already says 0). Guests have no block pair, so for them it is answered.
  Level 2 needs no arm: a sub-reply under an invisible level-1 reply is
  invisible too.
- Rides the existing root WHERE (public root, ban filter, block pair) on
  every order; works with `board=` and with `sort=new`. `unanswered` must be
  0 or 1; `mine=1` + either discovery param is a 400.

## F2 — Newest sort (`GET /api/posts?sort=new`)

- Roots by creation (`p.id DESC`), ignoring bumps and pins; bare-id cursor
  (the My posts convention). Scopes to a board. `sort` must be `new`;
  `board=suggestions&sort=new` is a 400.

## Client — view chips

- Home and every category except Suggestions show **Active / Newest /
  Unanswered** chips under the heading (`public/js/feed-views.js`). The view
  rides the URL (`?view=new|unanswered`, validated in `router.js`), so the
  chips are app-link anchors with `aria-current="page"`, shareable, back
  button safe. Feed fetch and Load older carry the matching params.
  Unanswered has its own empty state. Page-view only (source-pinned).

## Query plans (wave-28 volume)

node:sqlite + all migrations, 2k users, 20k posts (4k roots, 16k replies,
3% hidden), 2k blocks, 100 bans, `ANALYZE`; the root SELECT captured with
real binds from `worker.fetch`, `EXPLAIN QUERY PLAN`, mean of 20 runs.

| Variant | Viewer | Plan (posts) | ms |
|---|---|---|---|
| default (control) | anon / blocking member | SEARCH idx_posts_author / idx_posts_feed | 1.02 / 1.14 |
| unanswered=1 | anon / member | SEARCH p + SEARCH r via idx_posts_feed | 1.45 / 1.60 |
| sort=new | anon / member | SEARCH idx_posts_feed, no temp sort | 0.05 / 0.08 |
| sort=new&unanswered=1 | anon / member | SEARCH idx_posts_feed (p and r) | 0.04 / 0.10 |
| unanswered=1&board (0 hits, full walk) | anon / member | SEARCH | 0.41 / 0.74 |
| sort=new&board (0 hits, full walk) | anon / member | SEARCH | 0.40 / 0.64 |

No SCAN; every variant < 5 ms. No index needed.

## Bind count

`tests/wave32-feed-page-size.test.mjs` extended: unanswered, sort=new, both,
and each with a board, by a blocking member at a full page: worst = 51
(the reply-count rollup), < 100.

## Tests

`tests/wave33-feed-discovery.test.mjs` (9, RED first: hidden / banned /
lapsed ban / blocked / anon / admin, board, paging, validation;
mutation-checked: dropping the ban, visibility, or block arm fails 3/3/1),
`tests/wave33-feed-views.test.mjs` (6: router, chips via fake-dom, wiring
pins, locale parity).

## Strings

5 new keys (`feed.viewLabel`, `feed.viewActive`, `feed.viewNewest`,
`feed.viewUnanswered`, `feed.unansweredEmpty`) in en and all 20 locales.

## Found, not fixed (out of scope)

`board=suggestions` reaches `listRootPosts` with `byActivity: true`, so the
vote-score branch is unreachable and Suggestions pages by activity (checked
on 65bae41: a liked older suggestion sorts below a newer one).

## Migrations

None.
