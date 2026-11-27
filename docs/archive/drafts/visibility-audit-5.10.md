# Visibility audit — wave 5.10 (v5.10.0)

Re-audit of every surface that returns posts, replies, users or chat to a
non-staff viewer, against `.claude/skills/wempos-forum-visibility-law`
(visible = `visibility='public'`, author not actively banned, every ancestor
passes, no block pair either way; staff bypass). Baseline: the wave-40 audit
(v4.45.0). Between v4.45.0 and v5.9.0, the only server diff was the honest-404
in `worker.mjs`; the client added `board-regulars.js`, `search-summary.js`,
`chat-new-divider.js`, `badge-progress.js`, `tab-unread.js`, `reply-filter.js`
and `wall-reply.js`. So this pass re-read the whole server for leaks the
wave-40 audit missed.

## Surfaces audited (47)

Server (40): `/api/posts` (activity, `sort=new`, `board=`, suggestions,
`unanswered=1`, `mine=1`), `/api/posts/:id`, `/:id/replies`, `/:id/edits`,
poll payload + vote/create gates, reaction/report/subscribe/bookmark write
gates, `/api/search` (users, posts, `in=replies`, `by=`), `/api/users/:name`,
`/:id/threads`, `/:id/wall`, `/:id/profile.css`, `/api/avatars/:id`,
`/api/leaderboard`, `/api/presence`, `/api/chat` (lines, roster, dm/bell
unread), `/api/dm/threads`, `/api/dm/threads/:id`, `/api/dm/groups/:id`,
`/api/dm/images/:id`, `/api/attachments/:id`, `/api/gifs` + `/api/gifs/:id`,
`/api/traditions/qotd`, `/showcase`, `/api/archive`, `/api/me/notifications`
+ `/api/session` badge, `/api/me/bookmarks`, `/api/me/blocks`, export,
`/sitemap.xml`, markdown `/`, `/c/<slug>`, `/posts/<id>`, robots / api-catalog
/ openapi / auth.md / server card (static), Link headers, the honest-404
path, and the MCP tools `search_posts`, `recent_posts`, `list_board`,
`get_post`, `lobby_read`, `list_mentions`, plus the target gates of `reply` and
`create_post`.

Client (7): the seven modules listed above. Each one reads only its own
already-filtered payload: the feed page's posts, the search payload, the DM
payload's visible `unread`, or the own-profile counts. None of them makes a
call of its own.

## Findings

| # | Route / tool | file:line | Leak scenario | Severity | Status |
|---|---|---|---|---|---|
| F1 | `/api/archive` | `api/core/archive.mjs:57` (was `p.visibility`) | The archive kept each row's own `visibility`. Two cases leaked: (a) the author deletes a thread whose root had been hidden, and the members' public replies under it showed on the public archive; (b) an actively-banned member deletes their account, which wipes their ban rows, so the read-time ban filter no longer matches and their posts showed. | MEDIUM | fixed: visibility is now judged over the whole chain when the post is deleted (`publicChainSql`) |
| F2 | `/api/me/notifications`, `/api/session`, `/api/chat` bell badge | `api/notifications.mjs:70-87` | A lobby @mention row is label-only, and its label names the actor ("You were mentioned by X in chat"). It kept showing after X was banned or block-paired with the recipient. | LOW | fixed: the label's actor is resolved by `username_key`; the row drops while the actor is banned or block-paired (read time, no new binds) |
| F3 | `/api/presence`, `/api/chat` `onlineMembers` | `api/chat.mjs:262-268`, `:533-544` | Each side of a block pair saw the other in the online roster. | LOW | fixed: `viewerBlockFilterSql` on both rosters (guests and staff bind nothing extra; the anonymous `online` total is unchanged) |
| F4 | `/api/leaderboard`, `/api/users/:name` counts | `api/leaderboard.mjs:45-48`, `api/profiles.mjs:92-99` | Public replies under a hidden root or a banned author's root counted in leaderboard replies and reactions, and in profile counts for other viewers. | LOW | fixed: new shared `publicChainSql(alias)` in `api/core/visibility.mjs:87-100` (canViewPost's guest twin, binds nothing) |
| N1 | `/api/attachments/:id`, `/api/gifs/:id` | `api/attachments.mjs:355` | Approved image bytes are served by an unguessable UUID without re-checking the post (the response is a public, immutable cache entry). The ids only reach clients through filtered reads. | LOW | no-fix (capability URL; a per-viewer check would break the immutable cache) |
| N2 | `post_archive` data | n/a | Rows archived BEFORE v5.10 with the F1 shape are still `visibility='public'`. Fixing them needs a one-off data `UPDATE`, which the CREATE-only migration law does not allow. | MEDIUM (residual) | owner decision: needs a reviewed data fix through the remote ritual |
| N3 | `/api/posts/:id/edits`, `/api/me/blocks` | `api/posts-write.mjs:415`, `api/blocks.mjs:69` | No `LIMIT` on these lists. Each is bounded by one post's edits or one member's own blocks. Not a visibility issue. | INFO | noted |
| N4 | `/api/dm/threads(/:id)`, group members | `api/chat.mjs`, `api/dm-groups.mjs` | A 1:1 row keeps the other member's name, and a group keeps member names, when that member is block-paired. This is the wave-40 exemption, still an open owner question. | INFO | unchanged |
| N5 | `/api/me/delete` | `migrations/0043_fleet_boosts.sql:21` | `fleet_boosts` still references the retired `gc_messages` table. In a schema without that table (the local test DB), the users `DELETE` fails with "no such table: main.gc_messages". If prod has dropped `gc_messages`, account deletion would 500. | INFO | verify prod schema; out of scope |

Side effect of F4, on purpose: a non-staff viewer now reads 0/0 counts on an
actively-banned member's profile (their posts are hidden). The member
themselves and staff keep the full count.

Bind budget: no statement changed its bind count except the two rosters (+2
for a signed-in non-staff viewer). Every statement stays far below
`D1_MAX_BOUND_PARAMS` (100). CSRF: no write route gap found. Every mutation
reaches `requireUser`, which runs the same-origin and `X-CSRF-Token` check.

## Tests

`tests/wave510-cross-route-visibility.test.mjs` (7 tests). The cross-route
sweep uses the full cast: public root, hidden root, reply under hidden,
banned author, expired-ban author, block pair both ways, staff, guest, DM
non-member, a deleted hidden thread, and a wiped banned account. It covers 28
guest routes and 29 per member, plus 6 MCP calls per viewer and
`list_mentions`, for 142 sweeps. The new routes in it are the edits, gifs,
category feeds, `mine=1`, `by=` search, group DM, and markdown
`/c/suggestions`. Separate tests pin the 404s, the non-member refusals and
the positive controls. Each of F1–F4 has its own pin, and every pin was RED
before its fix. The wave-40 files are unchanged.
