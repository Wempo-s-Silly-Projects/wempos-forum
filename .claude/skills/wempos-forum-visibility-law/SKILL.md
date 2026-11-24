---
name: wempos-forum-visibility-law
description: "Use when writing or reviewing ANY query that returns forum posts, replies, users or chat to someone who might not be staff — feeds, search, sitemap, markdown, MCP tools, notifications — so hidden or banned content never leaks"
metadata:
  version: "1.2.0"
  source: local-git-analysis + session (re-verified 2026-11-21 at v5.0.0, wave-40 audit)
---

# The visibility law (`api/core/visibility.mjs`)

A post may be shown to a non-staff viewer only if ALL hold:
1. `visibility = 'public'` (the other value is `'hidden'`; hidden posts are reachable only via the desk's `GET /api/admin/hidden`).
2. Its author has no ACTIVE ban: `bans` row with `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > CAST(strftime('%s','now') AS INTEGER))`. Expired/revoked bans don't count; "now" is SQL-computed (bind-free).
3. Every ancestor (parent, and the root for level-2 replies) passes 1, 2 and 4. A public reply under a hidden root is NOT visible.
4. Signed-in viewers: no block pair between viewer and author, in EITHER direction (blocker and blockee both lose each other's content).
Staff (`owner`/`admin`) bypass all four.

## Helpers
- Single post: `canViewPost(env, row, viewer)` (`null` = anonymous) — walks ancestors, checks bans + blocks per level.
- Lists: `ACTIVE_BAN_SQL(column)` (active-ban predicate on any user-id column, binds nothing); `banFilterSql(alias)` (`api/posts-feed.mjs`, on `alias.author_id`); `viewablePostSql(idExpr)` = canViewPost as one EXISTS over post+parent+root for a signed-in non-staff viewer, binding the viewer id `VIEWABLE_POST_BINDS` (6) times in text order; `viewerBlockFilterSql(viewer, col)` / `blockPairExists` (`api/core/blocks.mjs`), no binds for guests/staff.
- Chat: lobby (`chat_messages.user_id`), DMs and presence (`/api/presence`) apply the same read-time ban filter in `api/chat.mjs`; presence also drops invisible/stale members.
- Never select `password_hash`, `password_salt`, emails or IP data into a response; shape rows with `publicPost`/`publicUser` (`api/core/shapers.mjs`).
- Read-time filtering: an unban restores content with no write — never "fix" by deleting rows.

## Model for a new public read (`api/profile-threads.mjs`, `api/traditions.mjs`)
- roots only, `visibility = 'public'` even for staff/author when it is the public face;
- ban filter + block filter (staff bypass); per-member pages refuse a block pair with 403 both ways;
- hand-shaped columns (no `SELECT *`), hard `LIMIT`, binds < `D1_MAX_BOUND_PARAMS`;
- images only approved + unrevoked via `attachmentRowsForView(db, ids, viewer)`;
- preview text masked (`maskedExcerpt`).

## Proof
Wave 40 (v4.45) audited every route: 15 privacy fixes. `tests/wave40-cross-route-visibility.test.mjs` sweeps routes against hidden root, banned author, block pair and invisible member. A new list = extend it, RED first, and mutation-check (drop the filter → test must fail). Sitemap, markdown and MCP results obey the same law.
