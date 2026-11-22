# Visibility inventory (v5.52)

Every server path that returns or renders post text, member names or
member-derived data, with the visibility-law filters it applies and the test
that pins it. The law itself: `api/core/visibility.mjs` and
`api/core/blocks.mjs` (see AGENTS-ONBOARDING.md, "The visibility law").

Filter key: **H** = hidden posts (`visibility = 'public'`, whole chain for
replies), **B** = active bans only (expired/revoked count as unbanned), **K** =
block pairs, both directions (staff bypass), **D** = deleted rows (gone from
`posts`; the archive keeps only what was public), **S** = staff-only (non-staff
get 401/403), **M** = spoiler-masked preview (`maskedExcerpt`/`maskSpoilers`),
**O** = owner-only private data (keyed on the caller's id; anyone else,
staff included, gets 404 or their own empty rows), **X** = expiry checked
against "now" at read time (no cron).

The cross-route sweep is `tests/wave510-cross-route-visibility.test.mjs`
(extended in v5.32 and again in v5.42; "sweep" below). One fixture — hidden root, reply under it,
banned author (plus an expired-ban control), block pair, invisible member,
deleted + wiped posts, and one row in every staff-only store — is checked
against each row for a guest, an unrelated member and both sides of the pair.
Since v5.42 the same fixture also carries a private folder
(`PRIVATEFOLDERTXT`, owner-only), follows, a muted notification kind, pins and
statuses (one expired), and a hidden newest staff pick over an older
block-paired one; a staff + owner pass checks the public faces and the
private stores for both staff roles. Swept-count floor: 263 (was 245).
Waves 5.43 – 5.51 extended the fixture as each surface shipped: staff notes
(`STAFFNOTETXT`), a claimed report, slow mode and a lock with a staff-only
reason on the public root, a tag on every fixture root (the hidden one and
the reply under it included), a 1:1 DM reaction by each side of the pair,
private notes (`PRIVNOTETXT`) and a saved search (`SAVEDSEARCHTXT`), both
owner-only, and a TL;DR on every fixture root. Since v5.52 it also carries a
muted thread (the viewer mutes the public root), and the sweep adds the tag
list, a mute pass (owner-only flag, visibility-gated writes, fan-out), a lock
oracle pass (web + MCP), the DM reaction counts across the pair, a row-by-row
export check for six member kinds, a staff-write refusal pass and a staff pass
over the tag listing. Swept-count floor: 326 (was 322 after v5.50).
`tests/wave40-cross-route-visibility.test.mjs` and
`tests/wave40-visibility-routes.test.mjs` are the older sweeps, kept as-is.

## Public and member reads (JSON)

| Surface | Handler | Filters | Pinned by |
|---|---|---|---|
| Feed, all variants (`/api/posts`, `sort`, `board`, `mine`, `unanswered`) | api/posts-feed.mjs:407 | H B K, reply counts viewer-aware | sweep; wave32 bind pin; wave35 cursor fuzz; wave29 rollup |
| Thread read `/api/posts/:id` | api/posts-feed.mjs:516 | H B K via `canViewPost` (404) | sweep (by-id test) |
| Replies `/api/posts/:id/replies` | api/replies.mjs:54 | H B K (parent `canViewPost`, rows filtered) | sweep (by-id test) |
| Edit history `/api/posts/:id/edits` | api/posts-write.mjs:421 | H B K via `canViewPost` | sweep (by-id test) |
| Search `/api/search` (`in`, `by`) | api/search.mjs:58 | H B K (`canViewPost` per candidate), reactions B | sweep |
| Profile by name `/api/users/:name` | api/profiles.mjs:60 | K (unavailable payload), counts H B (whole chain); ban banner kept by design | sweep; wave510 F4 |
| Profile CSS `/api/users/:id/profile.css` | api/profiles.mjs:389 | K (404 both ways), approved CSS only | wave40-visibility-routes |
| Profile threads `/api/users/:id/threads` | api/profile-threads.mjs:39 | H B K (403 for the pair) | sweep (pair refusal swept) |
| Wall `/api/users/:id/wall` | api/wall.mjs:71 | B K (pair 403 + row filter) | sweep |
| Leaderboard `/api/leaderboard` | api/leaderboard.mjs:34 | H B K, counts on the whole chain, reactions B | sweep; wave510 F4 |
| Presence `/api/presence` | api/chat.mjs:229 | B K, invisible + stale dropped | sweep; wave510 F3; wave39 presence |
| Lobby `/api/chat` (+ roster) | api/chat.mjs:522 | B K | sweep; wave510 F3 |
| DM thread list `/api/dm/threads` (+ groups, `dmUnread`) | api/chat.mjs:311, api/dm-groups.mjs:128 | B K on previews and counters; partner name kept by design | sweep (`keepParticipantNames`) |
| DM thread `/api/dm/threads/:id` | api/chat.mjs:361 | members only (403), B K rows | sweep; wave510 non-member test |
| Group DM `/api/dm/groups/:id` | api/dm-groups.mjs:261 | members only (404), B K rows and member list | sweep |
| DM images `/api/dm/images/:id` | api/dm-images.mjs:171 | membership, B K, revocation | tests/dm-images.test.mjs |
| GIF library `/api/gifs` | api/gifs.mjs:211 | approved only, uploader B | sweep |
| Traditions `/api/traditions/qotd`, `/showcase` | api/traditions.mjs:157 | H B K, roots only | sweep |
| Archive `/api/archive` | api/archive.mjs:34 | D (public-at-deletion only), B | sweep; wave510 F1 |
| Notifications `/api/me/notifications` | api/notifications.mjs:286 | H B K (`viewablePostSql`), chat-mention actor B K, M (client) | sweep; wave510 F2; wave37–39 |
| Session badge `/api/session` | api/session.mjs:102 | same predicate as the list | sweep; wave510 F2 |
| Bookmarks `/api/me/bookmarks` | api/bookmarks.mjs:115 | H B K (ancestors) | sweep; wave39 saved-ancestor |
| Data export `/api/me/export` | api/export.mjs:213 (sections :104) | O: every section keyed on the caller (by design: own hidden posts included); DM rows authored by the caller only | sweep (v5.32); wave 5.52 row-by-row export pin (6 member kinds × 10 sections) |
| Account security `/api/me/security` | api/account-security.mjs:53 | own sessions only | sweep (v5.32) |
| My blocks `/api/me/blocks` | api/blocks.mjs:71 | the viewer's own pairs only, both directions labelled (by design, v4.4) | sweep (v5.32 pins) |
| Rules, branding `/api/rules`, `/api/branding` | api/rules.mjs:36, api/branding.mjs:120 | owner copy, no member content | sweep (v5.32) |
| Polls (inside the thread read) | api/polls.mjs:54 | thread `canViewPost`; votes by banned voters not counted | wave40-visibility-routes; wave513-polls |
| Attachments `/api/attachments/:id` | api/attachments.mjs:357 | approved + unrevoked public by unguessable id; pending to author/staff | tests/wave21-images.test.mjs |
| Avatars `/api/avatars/:id` | api/avatars.mjs:44 | approved public; pending to owner/staff | sweep (v5.32 pins) |
| @mention fan-out (write side) | api/mentions.mjs:66 | K (no ping across a pair) | sweep (v5.32 pins) |

## Added since v5.32 (v5.33 – v5.41)

| Surface | Handler | Filters | Pinned by |
|---|---|---|---|
| RSS `/feed.xml`, `/c/:board/feed.xml` | api/feeds.mjs:154 | H B roots only (discovery `feedSql`, the anonymous feed; cookies ignored, one cacheable document), M, XML-escaped | sweep (guest, 4 feeds); wave 5.42 staff/owner pass; positive control; wave534-feeds |
| `/llms.txt` | api/feeds.mjs:158 | static: branding, boards, public docs only — no post or member read | sweep (guest); wave 5.42 staff/owner pass |
| This week `/api/week` (threads, showcase, staff pick) | api/week.mjs:70 | H B K roots (`visibleRootSql`; hidden off for staff too), tally viewer-aware, M | sweep (all viewers); wave 5.42 staff/owner pass; wave535-week |
| This week page head `/week` | api/seo.mjs:197 | fixed copy, no record | sweep (all viewers + staff/owner) |
| RSS `<link rel=alternate>` in every head | api/seo.mjs:228 | URLs only | wave534-feeds |
| Sitemap `/week` entry | api/discovery.mjs:321 | fixed URL | wave535-week |
| Newest members `/api/members/newest` | api/newcomers.mjs:35 | B K (staff bypass K), name + approved avatar only, no join time | sweep (all viewers, new v5.42); wave 5.42 newest-members pin; wave535-week |
| New chip (`isNew` on every post) | api/core/shapers.mjs:48 | rides only posts already visible; boolean computed in SQL, `created_at` never sent | wave535-week |
| Staff pick flag (`staffPick` on every post) | api/core/shapers.mjs:52 | rides only posts already visible (newest pick) | wave535-week |
| Staff pick of the week (gallery + /week) | api/traditions.mjs:135 | H B K re-checked per read; hidden off for staff; an older pick never stands in | sweep (hidden newest pick over an older block-paired pick); wave 5.42 staff/owner pass |
| Staff pick writes `/api/admin/threads/:id/staff-pick` | api/staff-picks.mjs:81 | S (requireStaff + CSRF), only a public, unbanned Showcase root | wave535-week |
| Invite claim `POST /api/me/invite` | api/invites.mjs:78 | B K at claim (inviter unbanned, no pair), once per new account; ignored claims answer the same | wave534-invites |
| `session.user.invitedBy` | api/session.mjs:121 (api/invites.mjs:68) | O (own row), B K read-time | wave534-invites |
| Invite bell label ("Your friend X joined…") | api/notifications.mjs:125 | B K on the named actor read-time (list + badge) | sweep (bell rows naming each actor); F2 pin; positive control |
| Search `since` / `sort` | api/search.mjs:43, api/posts-feed.mjs:348, api/search.mjs:111 | same H B K as plain search (`listRootPosts`, `canViewPost` per reply) | sweep (3 filtered searches, all viewers); wave536-search-filters |
| Conversation search `/api/dm/threads/:id/search` | api/conversation-search.mjs:97 | participants only (404 like missing), B K rows (`DM_VISIBLE_MESSAGE_SQL`), M | sweep (pair members); non-member test; wave536-conversation-search |
| Conversation search `/api/dm/groups/:id/search` | api/conversation-search.mjs:110 | members only (404), B K rows (`VISIBLE_GROUP_MESSAGE_SQL`), M | sweep (viewer); non-member test |
| Recent searches (client) | public/js/recent-searches.js:86 | O: `:u<id>` localStorage, wiped on sign-out; never sent | wave27 storage-wipe sweep |
| Profile pin (`pinnedThread` on `/api/users/:name`) | api/profile-pin.mjs:36 (api/profiles.mjs:148) | H B (own public root; hidden off for staff), K via the profile's pair refusal | wave 5.38 pin; wave538-profile-extras; wave 5.42 staff/owner pass |
| Custom status (`status` on `/api/users/:name`) | api/user-status.mjs:105 | X (expiry vs now), B, K via the pair refusal, word filter at read | sweep (`STALESTATUSTXT` on every route); wave 5.38 pin |
| Poll deadline (`closesAt` in the thread poll) | api/polls.mjs:96 | rides the thread read (`canViewPost`), X | wave538-profile-extras |
| Bookmark folders list `/api/me/bookmark-folders` | api/bookmark-folders.mjs:94 | O (`user_id = caller`) | sweep (`PRIVATEFOLDERTXT` forbidden to all but its owner); wave 5.42 staff/owner pass |
| Folder contents `/api/me/bookmark-folders/:id/items` | api/bookmark-folders.mjs:183 | O (404 to anyone else, staff included), H B K ancestors (`visibleSavedFilter`, shared with bookmarks) | sweep; wave 5.39 pin; wave 5.42 staff/owner pass |
| Folder add `PUT …/items/:postId` | api/bookmark-folders.mjs:147 | O, must be bookmarked and pass `canViewPost` | wave539-folders-follows |
| Follow state `GET /api/users/:name/follow` | api/follows.mjs:144 | O (caller's own state), K (404 = missing member, staff bypass) | sweep (members); wave 5.42 follow-state pin |
| Following list `/api/me/following` | api/follows.mjs:168 | O, B K read-time | sweep; wave 5.39 pin; wave 5.42 staff/owner pass |
| Follow writes `POST/DELETE /api/users/:name/follow` | api/follows.mjs:144 | B K refusals = 404 like a missing member; a block removes the pair's follows both ways (api/blocks.mjs:67) | wave 5.39 pin; wave539 |
| Follow bell fan-out (`follow_thread`) | api/follows.mjs:69 (called at api/posts-write.mjs:347) | public unbanned root only, follower B K + mute; the bell re-checks H B K via `viewablePostSql` | wave 5.39 + 5.40 fan-out pins; sweep (follow bell rows for each fixture root) |
| Notification prefs `/api/me/notification-prefs` | api/notifications.mjs:249 | O (own row; others read their own empty list) | wave 5.40 pin; sweep (members); wave 5.42 staff/owner pass |
| Every notification insert path + mute | api/notifications.mjs:51 (`mutedKindSql`) via :155 reply, :170 fan-out (mention, subscription, chat_mention at api/chat.mjs:131), :205 label-only (invite_joined); api/follows.mjs:69 | each names its kind; muted recipients get no row; appeal outcomes (api/appeals.mjs:61) are safety notices with no kind and always land; visibility re-checked at read | wave540-notification-prefs; wave 5.40 pin |

## Added since v5.42 (v5.43 – v5.51)

| Surface | Handler | Filters | Pinned by |
|---|---|---|---|
| Slow-mode flag (`slowModeSeconds` in `POST_SELECT`) | api/core/shapers.mjs:55, :263 | public by design (the thread page shows it); rides only posts already visible; `set_by` never selected | sweep (public root carries it on every route) |
| Slow-mode reply refusal (web + MCP `reply`) | api/replies.mjs:164, api/mcp.mjs:637 (api/staff-tools.mjs:76) | runs AFTER the H B K target check, so an unseen thread never answers 429; staff exempt. Open owner item M1 (check-then-insert race) referenced, not fixed | wave543-staff-tools |
| Slow-mode writes `PUT/DELETE /api/admin/threads/:id/slowmode` | api/staff-tools.mjs:107 | S (requireStaff + CSRF, not banned, write limiter) | wave 5.52 staff-write pass; wave543 |
| Report claim writes `POST/DELETE /api/admin/reports/:id/claim` | api/staff-tools.mjs:118 | S; claimer name reaches the desk queue only | wave 5.52 staff-write pass (+ queue positive control); wave543 |
| Staff-note writes `POST /api/admin/members/:id/notes`, `DELETE …/notes/:noteId` | api/staff-tools.mjs:170, :197 | S; no member-facing read, export, feed, search, MCP tool or head joins `member_notes` | sweep (`STAFFNOTETXT` forbidden on every route, the noted member's own included); wave 5.52 staff-write pass |
| DM reaction writes `PUT/DELETE /api/dm/messages/:id/reaction` | api/dm-reactions.mjs:64 | participants only (404 to anyone else, staff included), banned author's message 404, K (403 either way) | wave 5.44 sweep pin; wave544-dm-reactions |
| DM reactions in the 1:1 thread read | api/chat.mjs:382, api/dm-reactions.mjs:89 | participants only (rides the thread gate), B on reactors, K: the other side's reactions dropped while the pair (or their ban) holds; read-time | wave 5.52 DM reaction pin (both ways + unblock control); mutation-checked |
| Tag list `/api/tags` | api/tags.mjs:121 | staff-written labels only, no post or member data | sweep (all viewers, new v5.52) |
| Tag writes `POST /api/admin/tags`, `DELETE /api/admin/tags/:id` | api/tags.mjs:246 | S, word filter at create | wave 5.52 staff-write pass; wave544-thread-tags |
| A thread's tags `GET/PUT /api/posts/:id/tags` | api/tags.mjs:181 | GET: H B K via `canViewPost` (404); PUT: root, author or staff, `canViewPost` first | sweep (chips on the public root); wave 5.44 sweep pin (hidden, banned, pair = 404) |
| Tag listing `/api/tags/:slug/posts` | api/tags.mjs:218 | H B K roots (`banFilterSql`, `viewablePostSql`, `viewerBlockFilterSql`); hidden off for staff too (public face); reply tally viewer-aware; M | sweep (all viewers); wave 5.44 sweep pin; wave 5.52 staff pass |
| Tag page head `/tag/:slug` | api/seo.mjs:208 | label only, unknown slug = generic noindexed head | sweep (all viewers); wave 5.52 staff pass |
| Thread mute writes `PUT/DELETE /api/posts/:id/mute` | api/thread-mutes.mjs:51 | O; H B K via `canViewPost` (404, no write); roots only | wave 5.52 mute pass (hidden, banned, pair both ways); mutation-checked; wave546-thread-mutes |
| `viewerMuted` on the thread detail | api/posts-feed.mjs:568 | O (caller's own PK probe; guests no field) | wave 5.52 mute pass (5 other viewers incl. owner + admin read false) |
| Thread mute in every fan-out (`mutedThreadSql`) | api/notifications.mjs:65 (insert :88), api/follows.mjs:77 | write-side only; the muted recipient gets no row; label-only rows never match | wave 5.52 mute pass (fan-out control); wave546 |
| Private notes `GET/PUT/DELETE /api/users/:username/note` | api/private-notes.mjs:98 | O (no staff bypass; subject never sees it); banned/block-paired subject unchanged by design. Open owner item L1 (NUL → 500) referenced, not fixed | sweep (`PRIVNOTETXT` owner-only on every route + MCP search); wave 5.42 staff/owner pass (extended v5.47) |
| Export `privateNotes` | api/export.mjs:126 | O (notes the caller wrote) | wave 5.42 owner pass; wave 5.52 export pin |
| Saved searches `GET/POST /api/me/saved-searches`, `DELETE …/:id` | api/saved-searches.mjs:146 | O (no staff bypass; foreign id = 404, row kept). Open owner item L1 referenced | sweep (`SAVEDSEARCHTXT` owner-only); wave 5.42 staff/owner pass (extended v5.48) |
| Export `savedSearches` | api/export.mjs:130 | O | wave 5.42 owner pass; wave 5.52 export pin |
| TL;DR `GET/PUT/DELETE /api/posts/:id/summary` | api/thread-summaries.mjs:107 (read :92) | H B K via `canViewPost` (404), roots only; writer B K (`ACTIVE_BAN_SQL` + `viewerBlockFilterSql` on `updated_by`, staff bypass); writer identity never served | sweep (all viewers); wave 5.50 sweep pin (hidden, banned, pair = 404 + staff controls) |
| Export `threadSummaries` | api/export.mjs:134 | O (summaries the caller wrote) | wave 5.52 export pin |
| Export `dmReactions` | api/export.mjs:122 | O (message ids + values, never text) | wave 5.52 export pin |
| Edit-history word diff (client) | public/js/word-diff.js | renders only what `/api/posts/:id/edits` already returned (H B K via `canViewPost`); no fetch of its own | sweep (edits route, by-id test) |
| Lock flag (`locked` in `POST_SELECT`) | api/core/shapers.mjs:58 | public by design, bind-free EXISTS; the reason and the locker never selected | sweep (`STAFFONLYTXT lock reason` forbidden on every route); wave 5.32 staff pass control |
| Lock reply refusal (web + MCP `reply`) | api/replies.mjs:161, api/mcp.mjs:635 (api/thread-locks.mjs:57) | runs AFTER the H B K target check: a locked thread the member cannot see answers like any unseen thread, never 423; refusal copy carries no reason; staff exempt | wave 5.52 lock-oracle pass (hidden, banned, pair; web + MCP; visible 423 control) |
| Lock writes `PUT/DELETE /api/admin/threads/:id/lock` | api/thread-locks.mjs:118 | S | wave 5.52 staff-write pass; wave551-thread-lock |

## Discovery, page heads and MCP

| Surface | Handler | Filters | Pinned by |
|---|---|---|---|
| Thread page head + JSON-LD (`/posts/:id`) | api/seo.mjs:110 | H B K (non-staff `canViewPost`), M, generic noindexed head otherwise; reply count viewer-aware (v5.32 L1) | sweep (all viewers, heads + by-id); wave531; wave510 L1 |
| Profile page head (`/users/:name`) | api/seo.mjs:136 | B K | sweep; wave531 |
| Site JSON-LD (WebSite, Organization) | api/seo.mjs:164 | branding only | wave531 |
| Sitemap `/sitemap.xml` | api/discovery.mjs:308 | H B roots, unbanned members | sweep; wave531 |
| Markdown `/`, `/c/:board`, `/posts/:id` | api/discovery.mjs:279 | H B (guest `canViewPost`), M titles | sweep |
| Static docs (`/openapi.json`, `/.well-known/*`, `auth.md`) | api/discovery.mjs:690 | no member content | tests/discovery.test.mjs |
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
| Avatar, attachment, GIF, CSS queues | api/avatars.mjs:134, api/attachments.mjs:426, api/gifs.mjs:249, api/profiles.mjs:422 |
| Word filter `/api/admin/filter` | api/filterstore.mjs:91 |
| Staff-pick mod log `/api/admin/staff-picks` (v5.35) | api/staff-picks.mjs:93 |
| Staff notes `/api/admin/members/:id/notes` (v5.43) | api/staff-tools.mjs:158 |
| Report claims in the post-report queue (v5.43) | api/reports.mjs:77 |
| Thread-lock desk read `/api/admin/threads/:id/lock` (v5.51; the reason lives here only) | api/thread-locks.mjs:105 |

## Findings (v5.52)

- **Leaks: none.** Every surface shipped in v5.43–v5.51 applies the shared
  helpers (`canViewPost`, `viewablePostSql`, `banFilterSql`/`ACTIVE_BAN_SQL`,
  `viewerBlockFilterSql`/`blockPairExists`), is owner-keyed on the session's
  id (thread mutes, private notes, saved searches, export sections) or sits
  behind `requireStaff` (notes, claims, slow-mode and lock writes, the lock
  desk read, tag writes). The data export, re-checked as one surface, carries
  only the caller's own rows in all ten sections for six member kinds.
- **Ordering checked:** the lock (423) and slow-mode (429) reply refusals run
  after the target's visibility check on the web route and the MCP `reply`
  tool, so neither is an existence oracle for a hidden, banned-author or
  block-paired thread, and no refusal carries the staff-only reason.
- **Rows whose filter differs from the shared helpers (justified):**
  - api/chat.mjs:382 (`otherHidden`) inlines a both-way blocks EXISTS beside
    `ACTIVE_BAN_SQL("?")` in one probe instead of `blockPairExists` plus a ban
    lookup: it is the wave-40 unread predicate the reaction counts reuse, and
    the predicate is the same both-way EXISTS over `blocks`.
  - The tag listing and the TL;DR keep hidden posts off for staff (tags) or
    follow `canViewPost` (summary, staff bypass) exactly like their siblings
    (the feed's public face and the thread read).
  - Slow mode and `locked` are public flags by design (the thread page shows
    them); only the lock reason and the locker are staff-only.
- **Unpinned rows (now pinned):** the mute flag and the visibility gate on
  mute writes, the mute in the fan-out, the lock-refusal ordering (web + MCP),
  the DM reaction counts across a block pair, the export as a whole, the
  staff-only writes of v5.43–v5.51 and the tag listing as a staff public face
  had no cross-route pin. Behavior was already correct; mutation checks
  (dropping `otherHidden` in the thread read, dropping `canViewPost` in the
  mute gate) each turn the sweep red.
- **Open owner items (referenced, not fixed):** M1 slow-mode check-then-insert
  race; L1 NUL → 500 in private notes / saved searches; O1–O7.

## Findings (v5.42)

- **Leaks: none.** Every surface added in v5.33–v5.41 applies the shared
  helpers (`ACTIVE_BAN_SQL`/`banFilterSql`, `viewerBlockFilterSql`/
  `blockPairExists`, `canViewPost`/`viewablePostSql`, `visibleSavedFilter`,
  the chat predicates) or is owner-keyed. Mutation checks (drop the filter →
  the sweep fails) were run on the newest-members ban and block filters, the
  follow-state pair refusal, the folder owner key and the staff-pick re-check.
- **Rows whose filter differs from the shared helpers (justified):**
  - api/invites.mjs and api/follows.mjs inline a both-direction `PAIR_SQL`
    instead of `viewerBlockFilterSql`: both compare two COLUMNS (inviter vs
    claimant, follower vs followee) inside one statement, which the
    viewer-bound helper cannot express; the predicate is the same both-way
    EXISTS over `blocks`.
  - RSS feeds and llms.txt ignore the session (no K): one cacheable,
    anonymous document; a member's blocks apply on the site itself.
  - The newest-members list may name an invisible member: "invisible" hides
    online status only (presence), never the account.
  - Profile pin and the staff pick keep hidden posts off even for staff:
    they are public faces, like the page head.
- **Unpinned rows (now pinned):** the newest-members list had no ban/block
  pin in the sweep, the follow-state read had no pair pin, the staff-pick
  mod log was missing from the staff-only sweep, and no test drove the new
  public faces or the private stores as staff or as the site owner. Behavior
  was already correct; the v5.42 tests hold it.

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
- (v5.42) RSS feeds are the anonymous feed for everyone (no per-viewer K).
- (v5.42) Private stores (folders, follows, notification preferences) are
  owner-only with no staff bypass.
- (v5.42) The New chip and the staff-pick flag ride visible posts only and
  carry no record of their own.
