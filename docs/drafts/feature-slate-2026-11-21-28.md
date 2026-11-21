# Feature slate — wave 2026-11-21-28 (v4.33.0)

No member-facing feature this wave: a D1 query-plan pass over the hot paths.

## Method

node:sqlite test adapter (`tests/helpers/d1.mjs`, all migrations applied),
seeded with 2k users, 20.2k posts (4k threads, 16k replies, 3% hidden),
30k reactions, 50k notifications, 3k DM threads, 20k DM messages, 300 groups
(5k group messages), 10k lobby messages, 2k blocks, 100 bans, 3k sessions,
3k wall posts, then `ANALYZE`. 31 GET routes driven through `worker.fetch`
as a member and as the admin. Every statement was captured with its real
binds (69 unique), run through `EXPLAIN QUERY PLAN`, and timed (20 runs).

## Plan table

| Path | Statement | Plan before | Fix | ms before → after |
|---|---|---|---|---|
| /api/chat poll, /api/dm/threads | DM unread sum (`user_a = ? OR user_b = ?`) | SCAN dm_threads | 0059 index on dm_threads(user_b) | 0.159 → 0.092 |
| /api/dm/threads | 1:1 thread list (same OR) | SCAN t | same index | 0.212 → 0.155 |
| /api/chat, /api/admin/chat, /api/admin/dms | newest-first lobby/DM log | SCAN by rowid DESC under LIMIT | none (bounded walk) | 0.04–0.10 |
| /api/leaderboard | every user, per-user counts | SCAN users | none (reads all users by design) | 5.3 |
| /api/search, admin user search | username `instr()` | SCAN users | none (substring match can't use an index) | 0.03–0.40 |
| /api/admin/css | pending CSS queue | SCAN users | none (staff-only, small) | 0.08 |
| feed / board / mine / search | reply-count rollup | SEARCH (temp B-tree group by) | none (F2 candidate) | 6.2–7.8 |
| session, thread, replies, notifications, profile, wall, traditions, groups, reports | all others | SEARCH USING INDEX / PK | none | ≤ 1.6 |

## Shipped

- `migrations/0059_forum_perf_indexes.sql`: `CREATE INDEX IF NOT EXISTS
  idx_forum_perf_dm_threads_user_b ON dm_threads(user_b);`. Local D1
  applied; local EXPLAIN shows MULTI-INDEX OR, both arms SEARCH.
- `tests/wave28-perf-indexes.test.mjs`: pins the file shape, the index, and
  that the SQL captured from the live /api/chat and /api/dm/threads handlers
  plans with no dm_threads SCAN.

## Gates

- The lead applies 0059 to remote via the NAME-PRESENCE ritual BEFORE push.
- F2 (not done): the feed reply-count rollup is the slowest hot statement;
  worth a code-side look next wave.
