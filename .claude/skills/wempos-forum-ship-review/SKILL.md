---
name: wempos-forum-ship-review
description: "Use when reviewing a Wempo's Forum commit range for a SHIP/BLOCK verdict — before issuing any gate verdict on wave code"
metadata:
  version: 1.1.0
  source: forum wave gates through v5.0.0 (rewritten 2026-11-21; GooberCord economy checks removed)
---

# Wempo's Forum Ship Review

Run every check on `git diff <base>..<sha>` before a verdict; a verdict without them is decoration.

1. **Visibility law** — every new/changed read that a non-staff viewer can reach: `visibility='public'`, no ACTIVE ban (`ACTIVE_BAN_SQL`/`banFilterSql`), every ancestor (parent + root) passes too (`canViewPost` / `viewablePostSql`), and block pairs hidden BOTH directions (`viewerBlockFilterSql`/`blockPairExists`). Staff bypass only where the existing helpers do. Extend `tests/wave40-cross-route-visibility.test.mjs` for new routes.
2. **Bind budget** — every statement's bound params < `D1_MAX_BOUND_PARAMS` (100) at a full `FEED_PAGE_SIZE` page with a blocking viewer; feed variants extend `tests/wave32-feed-page-size.test.mjs`. Positional `?` only, no string-built user input.
3. **Writes** — `requireUser` (CSRF: `assertSameOrigin` + `X-CSRF-Token`), `assertNotBanned`, `rateLimit`, word filter, caps from `constants.mjs`; a mutation that must apply checks `meta.changes` (`requireMutationApplied`). MCP twins reuse the same path.
4. **Spoilers** — every new preview/excerpt/title surface masks (`maskedExcerpt`/`maskSpoilers`); `tests/wave17-spoiler-paths.test.mjs` stays green without new allow-list entries lacking a reason.
5. **Storage** — new localStorage key families are `:u<id>`-scoped and wiped via `wipeAccountLocalData()` (`tests/wave27-storage-wipe-sweep.test.mjs`); device prefs excepted.
6. **Defaults & strings** — activity-revealing features opt-in; new strings exist in every locale under `public/locales`, actually translated (`tests/i18n.test.mjs`).
7. **Migrations** — CREATE-only, fresh number (one above the highest number in `migrations/` AND in the remote `d1_migrations` ledger names; never reuse a ledger name (see wempos-forum-ritual)), local-applied, and remote applied via wempos-forum-ritual BEFORE the deploy that needs it.
8. **Tests never shrink** — an edited assertion must not get weaker (no loosened regex, dropped case, lowered count, `todo`/`skip` added without a `BUG:` reason); fakes must be row-count-aware (a fake that always returns `changes: 1` hides lost-race bugs).
9. **Hygiene** — AGPL header on new files, no `api/vendor/*` diff, no secrets/`.dev.vars`, VERSION bumped in both `package.json` and `wrangler.toml`; on shared files the commit carries only its lane's hunks.

Verdict format: SHIP/BLOCK bound to the exact SHA, each check PASS or the finding's file:line, every finding with a severity (CRITICAL/HIGH/MEDIUM/LOW) and a failure scenario. Suite evidence = `pnpm test` count at that SHA in an isolated worktree.
