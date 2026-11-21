# Feature slate — wave 2026-11-21-34 (v4.39.0) — Suggestions vote order

## F1 — Suggestions sort by vote score (bug, found in wave 33)

- Cause: `handlePostFeedRoute` (api/posts-feed.mjs) passed `byActivity: true`
  for every non-`sort=new` feed, `board=suggestions` included. The activity
  branch runs first in `listRootPosts`, so the vote-score branch was
  unreachable: Suggestions ordered by bump time, and the parsed score cursor
  (`{score, id}`) was bound into the activity keyset (`cursor.seconds`
  undefined).
- Fix: the route no longer sets `byActivity` for Suggestions, so the board
  takes its existing score branch: net score (likes minus dislikes,
  `SUGGESTION_SCORE_SQL`) DESC, `p.id` DESC tiebreak, `score_id` cursor,
  `FEED_PAGE_SIZE` pages. Root WHERE untouched (public, ban filter, block
  pair, unanswered arm). An activity cursor sent to Suggestions stays a 400.
- Tests: `tests/wave34-suggestions-sort.test.mjs` (6; RED first, 3 failed on
  05b6737): older liked above newer, dislikes count against, ties by id DESC
  and stable, page 2 via cursor with no duplicates or gaps across ties,
  hidden / banned / lapsed ban / blocked, unanswered keeps score order.
  Mutation: id ASC tiebreak fails 3.

## F2 — Rank numbers on Suggestions cards (unique)

Not shipped before (checked feature-slate-2026-11-21*.md and public/js; the
only rank today is the leaderboard). Each Suggestions card leads its author
row with its place in the vote order: `#1`, `#2`, ... with an aria-label
"Rank N by votes". Load older continues the count; a numbered card is never
re-numbered; nested cards are skipped (only direct children of
`.post-list`). `public/js/suggestion-rank.js`, page-view only
(source-pinned: no storage, no requests, no innerHTML), modulepreload hint.
Tests: `tests/wave34-suggestion-rank.test.mjs` (7).

## Query plans (wave-28 volume)

node:sqlite + all migrations, 2k users, 20k posts (4k roots, 16k replies,
3% hidden), 40k reactions, 2k blocks, 100 bans, `ANALYZE`; the Suggestions
SELECT captured with real binds from `worker.fetch`, `EXPLAIN QUERY PLAN`,
mean of 20 runs.

| Suggestion roots | Viewer | page 1 | page 2 (cursor) | unanswered |
|---|---|---|---|---|
| 800 | anon | 0.71 ms | 0.99 ms | 0.74 ms |
| 800 | blocking member | 0.92 ms | 1.41 ms | 1.23 ms |
| 4000 (every root) | anon | 1.69 ms | 2.77 ms | 1.99 ms |
| 4000 (every root) | blocking member | 1.76 ms | 3.09 ms | 2.41 ms |

Plan: SEARCH posts via idx_posts_feed (anon) / idx_posts_author (blocking
member), score via the covering idx_reactions_post_value, then TEMP B-TREE
for the computed ORDER BY. No SCAN. The sort is linear in Suggestions roots
(the score is computed, not stored); every variant < 5 ms at volume, so no
index or migration now.

## Bind count

`tests/wave32-feed-page-size.test.mjs` extended: Suggestions page 1, page 2
via the score cursor, and unanswered, by a blocking member at a full page:
worst = 51 (the reply-count rollup), < 100.

## Strings

1 new key (`feed.suggestionRank`, "Rank {rank} by votes") in en and all 20
locales.

## Migrations

None.
