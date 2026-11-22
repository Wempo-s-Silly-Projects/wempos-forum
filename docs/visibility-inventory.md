# Visibility inventory (v5.32)

Every server path that returns or renders post text, member names or
member-derived data, with the visibility-law filters it applies and the test
that pins it. The law itself: `api/core/visibility.mjs` and
`api/core/blocks.mjs` (see AGENTS-ONBOARDING.md, "The visibility law").

Filter key: **H** = hidden posts (`visibility = 'public'`, whole chain for
replies), **B** = active bans only (expired/revoked count as unbanned), **K** =
block pairs, both directions (staff bypass), **D** = deleted rows (gone from
`posts`; the archive keeps only what was public), **S** = staff-only (non-staff
get 401/403), **M** = spoiler-masked preview (`maskedExcerpt`/`maskSpoilers`).

The cross-route sweep is `tests/wave510-cross-route-visibility.test.mjs`
(extended in v5.32; "sweep" below). One fixture — hidden root, reply under it,
banned author (plus an expired-ban control), block pair, invisible member,
deleted + wiped posts, and one row in every staff-only store — is checked
against each row for a guest, an unrelated member and both sides of the pair.
`tests/wave40-cross-route-visibility.test.mjs` and
`tests/wave40-visibility-routes.test.mjs` are the older sweeps, kept as-is.

## Public and member reads (JSON)

| Surface | Handler | Filters | Pinned by |
|---|---|---|---|
| Feed, all variants (`/api/posts`, `sort`, `board`, `mine`, `unanswered`) | api/posts-feed.mjs:401 | H B K, reply counts viewer-aware | sweep; wave32 bind pin; wave35 cursor fuzz; wave29 rollup |
| Thread read `/api/posts/:id` | api/posts-feed.mjs:510 | H B K via `canViewPost` (404) | sweep (by-id test) |
| Replies `/api/posts/:id/replies` | api/replies.mjs:54 | H B K (parent `canViewPost`, rows filtered) | sweep (by-id test) |
| Edit history `/api/posts/:id/edits` | api/posts-write.mjs:409 | H B K via `canViewPost` | sweep (by-id test) |
| Search `/api/search` (`in`, `by`) | api/search.mjs:34 | H B K (`canViewPost` per candidate), reactions B | sweep |
| Profile by name `/api/users/:name` | api/profiles.mjs:57 | K (unavailable payload), counts H B (whole chain); ban banner kept by design | sweep; wave510 F4 |
| Profile CSS `/api/users/:id/profile.css` | api/profiles.mjs:381 | K (404 both ways), approved CSS only | wave40-visibility-routes |
| Profile threads `/api/users/:id/threads` | api/profile-threads.mjs:39 | H B K (403 for the pair) | sweep (pair refusal swept) |
| Wall `/api/users/:id/wall` | api/wall.mjs:71 | B K (pair 403 + row filter) | sweep |
| Leaderboard `/api/leaderboard` | api/leaderboard.mjs:34 | H B K, counts on the whole chain, reactions B | sweep; wave510 F4 |
| Presence `/api/presence` | api/chat.mjs:228 | B K, invisible + stale dropped | sweep; wave510 F3; wave39 presence |
| Lobby `/api/chat` (+ roster) | api/chat.mjs:521 | B K | sweep; wave510 F3 |
| DM thread list `/api/dm/threads` (+ groups, `dmUnread`) | api/chat.mjs:310, api/dm-groups.mjs:128 | B K on previews and counters; partner name kept by design | sweep (`keepParticipantNames`) |
| DM thread `/api/dm/threads/:id` | api/chat.mjs:360 | members only (403), B K rows | sweep; wave510 non-member test |
| Group DM `/api/dm/groups/:id` | api/dm-groups.mjs:261 | members only (404), B K rows and member list | sweep |
| DM images `/api/dm/images/:id` | api/dm-images.mjs:171 | membership, B K, revocation | tests/dm-images.test.mjs |
| GIF library `/api/gifs` | api/gifs.mjs:211 | approved only, uploader B | sweep |
| Traditions `/api/traditions/qotd`, `/showcase` | api/traditions.mjs:119 | H B K, roots only | sweep |
| Archive `/api/archive` | api/archive.mjs:34 | D (public-at-deletion only), B | sweep; wave510 F1 |
| Notifications `/api/me/notifications` | api/notifications.mjs:186 | H B K (`viewablePostSql`), chat-mention actor B K, M (client) | sweep; wave510 F2; wave37–39 |
| Session badge `/api/session` | api/session.mjs:101 | same predicate as the list | sweep; wave510 F2 |
| Bookmarks `/api/me/bookmarks` | api/bookmarks.mjs:114 | H B K (ancestors) | sweep; wave39 saved-ancestor |
| Data export `/api/me/export` | api/export.mjs:184 | own rows only (by design: own hidden posts included) | sweep (v5.32) |
| Account security `/api/me/security` | api/account-security.mjs:53 | own sessions only | sweep (v5.32) |
| My blocks `/api/me/blocks` | api/blocks.mjs:66 | the viewer's own pairs only, both directions labelled (by design, v4.4) | sweep (v5.32 pins) |
| Rules, branding `/api/rules`, `/api/branding` | api/rules.mjs:36, api/branding.mjs:120 | owner copy, no member content | sweep (v5.32) |
| Polls (inside the thread read) | api/polls.mjs:46 | thread `canViewPost`; votes by banned voters not counted | wave40-visibility-routes; wave513-polls |
| Attachments `/api/attachments/:id` | api/attachments.mjs:357 | approved + unrevoked public by unguessable id; pending to author/staff | tests/wave21-images.test.mjs |
| Avatars `/api/avatars/:id` | api/avatars.mjs:44 | approved public; pending to owner/staff | sweep (v5.32 pins) |
| @mention fan-out (write side) | api/mentions.mjs:66 | K (no ping across a pair) | sweep (v5.32 pins) |

## Discovery, page heads and MCP

| Surface | Handler | Filters | Pinned by |
|---|---|---|---|
| Thread page head + JSON-LD (`/posts/:id`) | api/seo.mjs:109 | H B K (non-staff `canViewPost`), M, generic noindexed head otherwise; reply count viewer-aware (v5.32 L1) | sweep (all viewers, heads + by-id); wave531; wave510 L1 |
| Profile page head (`/users/:name`) | api/seo.mjs:135 | B K | sweep; wave531 |
| Site JSON-LD (WebSite, Organization) | api/seo.mjs:163 | branding only | wave531 |
| Sitemap `/sitemap.xml` | api/discovery.mjs:306 | H B roots, unbanned members | sweep; wave531 |
| Markdown `/`, `/c/:board`, `/posts/:id` | api/discovery.mjs:277 | H B (guest `canViewPost`), M titles | sweep |
| Static docs (`/openapi.json`, `/.well-known/*`, `auth.md`) | api/discovery.mjs:684 | no member content | tests/discovery.test.mjs |
| MCP `search_posts`, `recent_posts`, `list_board` | api/mcp.mjs:106, :120, :130 | H B K (token's member) | sweep |
| MCP `get_post` | api/mcp.mjs:494 | H B K via `canViewPost` | sweep (by-id test, v5.32) |
| MCP `lobby_read` | api/mcp.mjs:155 | B K | sweep |
| MCP `list_mentions` | api/mcp.mjs:685 | H B K (`viewablePostSql`) | sweep |

## Staff-only stores (S)

Every row refuses guests and members with 401/403 (the AutoMod key route is
404 while AutoMod is off) and leaks no fixture text — pinned by the v5.32
staff-only sweep, which also checks staff do read the store.

| Surface | Handler |
|---|---|
| Post reports `/api/admin/reports` | api/reports.mjs:71 |
| Hidden posts desk `/api/admin/hidden` | api/reports.mjs:215 |
| Profile reports `/api/admin/profile-reports` | api/reports.mjs:294 |
| DM reports `/api/admin/dm-reports` | api/dm-reports.mjs:93 |
| Appeals `/api/admin/appeals` | api/appeals.mjs:92 |
| AutoMod log `/api/admin/automod`, queue `/api/automod/queue` | api/automod.mjs:333, :337 |
| Analytics `/api/admin/analytics` | api/analytics.mjs:193 |
| Mod logs `/api/admin/chat`, `/api/admin/dms` | api/modlogs.mjs:114, :145 |
| Bans `/api/admin/bans` | api/bans.mjs:37 |
| Member search `/api/admin/users/search` | api/members-admin.mjs:85 |
| Recent-posts peek `/api/admin/users/:id/recent-posts` | api/mod-tools.mjs:73 |
| Avatar, attachment, GIF, CSS queues | api/avatars.mjs:134, api/attachments.mjs:426, api/gifs.mjs:249, api/profiles.mjs:414 |
| Word filter `/api/admin/filter` | api/filterstore.mjs:91 |

## Findings (v5.32)

- **L1 (fixed)** — api/seo.mjs (`REPLY_COUNT_SQL`, v5.31): the thread head's
  JSON-LD `userInteractionCount` counted replies by a block-paired author, and
  sub-replies under them, for a signed-in member, while the feed hides them.
  The count now adds the viewer's block filter through the shared
  `publicReplyCountSql` builder (api/discovery.mjs). Pinned by the L1 test.
- **Unpinned rows (now pinned)** — the @mention fan-out across a block pair,
  pending-avatar privacy and the blocks list had no test; behavior was
  already correct, and the v5.32 pins test now holds it.

## Standing exemptions (unchanged)

- Staff (owner/admin) read everything, except the page head, which always
  shows the public face.
- 1:1 DM rows and the data export keep the other participant's username.
- Per-member pages by name keep the ban banner (reason for staff only).
- DM and group previews are not spoiler-masked: chat never renders spoilers
  (`NOT_A_SPOILER_SURFACE` in tests/wave17-spoiler-paths.test.mjs).
