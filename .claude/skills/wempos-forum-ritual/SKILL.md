---
name: wempos-forum-ritual
description: "Use when running ANY remote D1 migration apply in Wempo's Forum — before the first `pnpm run db:migrate:remote`, including retries after a failed apply"
metadata:
  version: 1.1.0
  source: r8-fk-failure-2026-11-18 + ledger state 2026-11-21
---

# Wempo's Forum D1 Ritual (NAME-PRESENCE)

Who: the fleet LEAD only, under standing push/deploy/remote-D1 authority (owner, Nov 17; Section A). Seats never write prod D1. DB: `wempo-forum-data` (binding `FORUM_DB`, shared with Accounts' `wa_` tables). Command: `pnpm run db:migrate:remote` (= `wrangler d1 migrations apply wempo-forum-data --remote`).

## Ledger state (2026-11-21, v5.0.0)
- Repo `migrations/` = 0001…0044 + `0059_forum_perf_indexes.sql`; 0044 (`dm_groups_images`) and 0059 are applied remote.
- The remote `d1_migrations` ledger also holds GooberCord-era names up to 0058 that have no file here. wrangler matches by full filename, so a new file must never reuse a ledger name; take the next number after the top (0060+).
- `gc_channels` is still a real table in the shared D1: it stays the row-survival baseline.

## Steps (in order, no skips)
1. **Pre-apply NAME-PRESENCE** (read-only): `SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 6`. Record the top name. Pending (wrangler's apply listing) must be EXACTLY the expected file set. Record `SELECT COUNT(*) FROM gc_channels` as the baseline (record the live number; never reuse an old one).
2. **Local first**: `pnpm run db:migrate:local` + `pnpm test` green at the SHA; the migration is CREATE-only (rebuild-class = STOP; D1's runner enforces FKs, a DROP of a referenced table fails or silently cascades — use the column dance).
3. **Apply** once. Never a bare repeat after a failure.
4. **Post-apply NAME-PRESENCE**: the ledger's top rows must name EVERY migration just applied, each exactly once. Never count alone, never infer success from exit code.
5. **Row-survival zero-delta**: `gc_channels` COUNT must equal the baseline. ANY delta or name-absence = STOP + report raw. No fake green.
6. **Failure case**: each migration file is atomic. Run the triage triple (ledger top / gc_channels count / new-table presence) before ANY diagnosis or retry; a clean rollback is proven, not assumed.
7. **Order gates**: apply BEFORE (or with) the deploy of code that assumes the new shape; never enable UI that needs a migration that hasn't been applied.

Worked example: 2026-11-18 R8: pre-presence ok (top 0028_mentions, baseline 15), apply FAILED (FK on 0029's DROP), triage proved clean rollback (top still 0028, count 15, no new tables), patch lane opened instead of a blind retry.
