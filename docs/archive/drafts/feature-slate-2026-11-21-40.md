# Feature slate — wave 2026-11-21-40 (v4.45.0) — whole-repo visibility audit

No new member feature this wave (lead order). Waves 36 and 39 both found
visibility leaks in routes that predated the night; diff-scoped reviews never
re-read old routes, so F1 re-read every server read path.

## F1 — Whole-repo visibility audit

Law (wempos-forum-visibility-law + `canViewPost`, `api/core/visibility.mjs`):
for a non-staff viewer, content shows only if it is public (hidden includes
staged), its author has no active ban, every ancestor passes the same, and no
block pair (either direction) joins viewer and author, ancestors included
when ancestor text or a dependent row is served. Presence drops invisible and
banned members. Staff = stored owner/admin = public owner/admin.

Scope: every route/handler in `api/*.mjs`, `worker.mjs` routing (no inline
content handlers), every `api/mcp.mjs` tool, `api/discovery.mjs` sitemap /
markdown / meta. Line numbers are at `bd6973a` (pre-fix). Columns: pub =
public/hidden, ban, blk = block both ways, anc = ancestors, inv = invisible.
`n-a` = staff-only, self-only, or no third-party content.

### Posts, feeds, search, threads

| route / fn | file:line | pub | ban | blk | anc | ok |
|---|---|---|---|---|---|---|
| GET /api/posts (activity, suggestions, new, mine, unanswered) → listRootPosts | posts-feed.mjs:399, 233-352 | y | y | y | roots | y* |
| replyCountsSql / withReplyMetadata | posts-feed.mjs:99-128, 158 | y | y | y | y (l1) | y |
| latestRepliesSql | posts-feed.mjs:136-156 | y | y | y | y | y |
| listReplies | posts-feed.mjs:354-396 | y | y | y | caller canViewPost | y |
| attachSubReplyCounts | posts-feed.mjs:485-505 | y | y | y | y | y |
| GET /api/posts/:id | posts-feed.mjs:507-565 | canViewPost | y | y | y | y* |
| GET /api/posts/:id/replies | replies.mjs:51-87 | canViewPost | y | y | y | y |
| GET /api/search users | search.mjs:56-61 | n-a | listed w/ banner (v3.1) | y | n-a | y |
| GET /api/search posts | search.mjs:62-63 | y | y | y | roots | y |
| searchReplies (in=replies) | search.mjs:82-110 | SQL + canViewPost | y | y | y | y* |
| GET /api/users/:id/threads | profile-threads.mjs:36-61 | y | y | 403 both ways | roots | y |
| GET /api/traditions/qotd, /showcase | traditions.mjs:52-109 | y | y | y | roots | y |
| GET /api/me/bookmarks, DELETE ?board= | bookmarks.mjs:40-173 | y | y | y | y (wave 39) | y |
| polls pollPayload | polls.mjs:39-80 | caller-gated | **voters n** | — | caller | **fixed** |
| reaction counts (POST_SELECT, searchReplies) | core/shapers.mjs:41-42, search.mjs:86-87 | — | **reactors n** | — | — | **fixed** |
| SUGGESTION_SCORE_SQL (Suggestions order + cursor) | boards.mjs:47-49 | — | **reactors n** | — | — | **fixed** |
| subscription/mention/reply fan-out (writes) | subscriptions.mjs:96-118, mentions.mjs:64-105 | — | — | reply author only | — | read-gated (below) |
| writes (create/edit/reply/react/vote/bookmark/subscribe/report) | various | canViewPost on target | | | | y |

\* reaction and poll tallies inside these payloads: see the reactor rows.

### Profiles, wall, leaderboard, notifications, media

| route / fn | file:line | pub | ban | blk | anc | ok |
|---|---|---|---|---|---|---|
| GET /api/users/:name | profiles.mjs:50-135 | **counts n** | banner (v3.1) | unavailable strip | n-a | **fixed** (counts) |
| GET /api/users/:id/profile.css | profiles.mjs:362-384 | n-a | n | **n** | n-a | **fixed** (blk) |
| GET /api/users/:id/wall | wall.mjs:68-94 | n-a | y | y (403 owner pair + author filter) | n-a | y |
| GET /api/leaderboard | leaderboard.mjs:29-61 | **n** | user y, **reactors n** | **n** | — | **fixed** |
| GET /api/me/notifications | notifications.mjs:67-74, 154-166 | reply y | reply y | reply y | **n** | **fixed** |
| unreadCount (GET /api/session badge) | notifications.mjs:147-152 | **n** | **n** | **n** | **n** | **fixed** |
| GET /api/archive (post_archive, public by design) | archive.mjs:29-69 | y | **n** | **n** | n-a | **fixed** (ban, blk) |
| GET /api/me/blocks | blocks.mjs:64-84 | — | — | — | — | n-a (self) |
| GET /api/me/export | export.mjs:150-183 | own | — | — | — | n-a (self) |
| GET /api/attachments/:id | attachments.mjs:354-406 | capability URL (documented :343-352) | | | | owner ruling |
| attachmentRowsForView | attachments.mjs:538-589 | caller-gated, pending → author/staff | | | | y |
| GET /api/avatars/:id | avatars.mjs:40-70 | pending → self/staff | n | n | n-a | LOW, not fixed |
| GET /api/gifs, /api/gifs/:id; GET /api/rules | gifs.mjs, rules.mjs | no identities | | | | n-a |
| /api/relay/* | relay.mjs:60-116 | relay-token only | | | | n-a |
| /api/admin/* (css, avatars, attachments, gifs) | profiles/avatars/attachments/gifs | requireStaff | | | | n-a (staff) |

### Chat, DMs, presence, session, appeals, reports

| route / fn | file:line | ban | blk | inv | ok |
|---|---|---|---|---|---|
| lobbyMessageRows (GET /api/chat, MCP lobby_read) | chat.mjs:82-92 | y | **n** | n-a | **fixed** |
| lobbyOnlineCount / GET /api/chat roster | chat.mjs:95-101, 499-506 | y | n-a | y | y |
| GET /api/chat bellUnread | chat.mjs:511-514 | **n** | **n** | n-a | **fixed** (shares unreadCount) |
| POST /api/presence (heartbeat) | chat.mjs:205-233 | **writes for banned** | n-a | n-a | **fixed** (F2a) |
| GET /api/presence | chat.mjs:170-177, 237-250 | y | n-a | y | y |
| GET /api/dm/threads 1:1 rows (preview, time, sort) | chat.mjs:281-325 | unread y, **preview n** | unread y, **preview n** | n-a | **fixed** |
| viewerDmUnread / viewerGroupUnread | chat.mjs:264-277, dm-groups.mjs:165 | y | y | n-a | y |
| GET /api/dm/threads/:id | chat.mjs:331-355 | y | **n** (history + unread) | n-a | **fixed** |
| listViewerGroups | dm-groups.mjs:126-162 | y | preview/unread y, members n | n-a | y (members: owner q) |
| GET /api/dm/groups/:id | dm-groups.mjs:261-287 | y | messages y, **unread raw** | n-a | **fixed** (unread) |
| DM/group writes, POST /api/dm/threads (open) | chat.mjs:373-479, dm-groups.mjs:218-423 | y | y | n-a | y |
| GET /api/dm/images/:id | dm-images.mjs:168-200 | y | y | n-a | y |
| session / login / sso / 2FA | session.mjs, accounts.mjs, twofa.mjs | self | | | n-a |
| POST /api/appeals; POST reports | appeals.mjs:141-197, reports.mjs:33-65, 256-284 | canViewPost gate | | | y |
| /api/admin/appeals, reports, hidden, chat, dms, bans, users, filter; mod-tools | appeals/reports/modlogs/bans/members-admin/filterstore/mod-tools | requireStaff (owner/admin; promote = owner) | | | n-a (staff) |

### MCP and discovery

| route / tool | file:line | pub | ban | blk | anc | ok |
|---|---|---|---|---|---|---|
| search_posts / recent_posts / list_board | mcp.mjs:437-464 | y | y | **n for agent** (ctx never passed, :404) | roots | **fixed** |
| get_post + replies | mcp.mjs:471-495 | y | y | **n for agent** (`canViewPost(…, null)`) | y | **fixed** |
| list_mentions | mcp.mjs:627-673 | reply y | reply y | reply y | **n** | **fixed** |
| lobby_read | mcp.mjs:741-748 | n-a | y | **n** | n-a | **fixed** |
| reply / create_* / lobby_post / delete_own_post | mcp.mjs:526-626, 760-783 | canViewPost(target, agent) | | | | y |
| sitemap.xml (posts + users) | discovery.mjs:73-79 | y | y | guest | roots | y |
| markdown `/`, `/c/<slug>`, `/posts/<id>` + reply_count | discovery.mjs:61-84, 209-279 | y | y | guest | y (l1) | y |
| openapi / api-catalog / auth.md / server-card; worker.mjs | discovery.mjs:615-619, worker.mjs:147-201 | static / routing | | | | n-a |

### Totals

- About 120 route/handler rows audited (4 read-only audit passes plus lead
  verification of every flagged row against the source).
- **15 non-compliant, all fixed**, each with a RED test that fails when its
  clause is reverted (`tests/wave40-visibility-routes.test.mjs`, 15 tests):
  - HIGH: notifications ancestor gap (list + label + badge),
    `api/notifications.mjs:67`; MCP read tools ignore the agent's block
    pairs, `api/mcp.mjs:404/475/484`; MCP list_mentions ancestor gap,
    `api/mcp.mjs:627`; leaderboard counts hidden posts and banned reactors and
    ignores blocks, `api/leaderboard.mjs:34`.
  - MEDIUM: lobby block filter (web + MCP), `api/chat.mjs:82`; DM thread-list
    preview, `api/chat.mjs:294`; DM thread history block, `api/chat.mjs:151`;
    profile counts include hidden posts, `api/profiles.mjs:90`; archive
    ignores bans/blocks, `api/archive.mjs:48`; banned reactors/voters counted,
    `api/core/shapers.mjs:41`, `api/boards.mjs:47`, `api/polls.mjs:41`,
    `api/search.mjs:86`.
  - LOW: DM thread/group unread disagree with the list, `api/chat.mjs:352`,
    `api/dm-groups.mjs:284`; profile.css ignores blocks,
    `api/profiles.mjs:367`; lobby bell count unfiltered, `api/chat.mjs:511`.
- New shared SQL: `ACTIVE_BAN_SQL(column)` and `viewablePostSql(idExpr)`
  (canViewPost's SQL twin, 6 viewer binds) in `api/core/visibility.mjs`.
  Worst new query: the DM thread list at 11 binds (< D1_MAX_BOUND_PARAMS 100).
  Feed binds are unchanged; the ban clauses are bind-free and ride
  `idx_bans_active`.
- Cross-route regression: `tests/wave40-cross-route-visibility.test.mjs`
  seeds one hidden root (and a reply under it), one banned author, one block
  pair, and one invisible member. It sweeps 113 route reads (guest, an
  unrelated member, each side of the pair, plus the MCP tools) and asserts
  that none of that content or identity appears. A second test proves the
  seed is live (positive controls) and that staff still see everything.
  Reverting any one of the notifications, MCP, chat, leaderboard or archive
  fixes turns it RED.

### Open (owner-gated, not fixed)

- A 1:1 DM thread with a banned or block-paired member still lists that
  member's name on the thread row; the messages are hidden. Should the row
  drop entirely?
- Group member lists keep a member blocked after joining (bans are filtered).
- Avatar bytes and attachment capability URLs are served without block or
  post checks (attachments are documented as intentional, with immutable
  caching).
- Label-only notifications ("mentioned in chat") have no actor column, so a
  later block can't retract them without a schema change.
- Who's Online lists block-paired members (the block law covers content, not
  presence).
- Discovery edge cache: up to 5 minutes of lag after a hide or ban
  (`s-maxage=300`).
- The reply-refusal copy is an existence oracle for public post ids (no text
  leaks).
- Leaderboard reply counts don't check the reply's parent (hidden parent →
  reply still counted).

## F2 — LOWs

- (a) `api/chat.mjs` heartbeat: an actively-banned member's ping writes no
  presence row (it answers `ok` without writing).
  `tests/wave40-visibility-routes.test.mjs` "presence heartbeat".
  `tests/chat.test.mjs:140` now heartbeats as an unbanned member, because its
  member was banned by an earlier test.
- (b) `public/js/feed-end.js` `reachedFeedEnd(page, { olderPage })`: an empty
  Load older page (after a feed of exactly FEED_PAGE_SIZE) closes the list
  with the end line, and the feed no longer prints "No posts" under existing
  posts. `tests/wave35-feed-end.test.mjs`.

## Release

v4.45.0, privacy fixes only. Migrations: none.
