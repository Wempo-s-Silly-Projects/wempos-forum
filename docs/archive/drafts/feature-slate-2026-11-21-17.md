# Feature slate — wave 2026-11-21-17 (v4.22.0)

A spoiler-path audit (spoilers leaked through previews twice in waves 15 and
16), plus one small member feature. No migration, no new route, nothing new
stored. Masking happens only at output: stored post text never changes.

## F1 — Spoiler-path audit

**One shared mask.** `maskSpoilers` (public/js/markdown.js) follows the
renderer: only spans that parseInline turns into spoilers get masked. The new
`maskedExcerpt(text, max)` (markdown.js) masks **before** it cuts, so a
spoiler split by a preview's character limit is already `▒▒▒`. The worker
imports the same code through `api/core/spoilers.mjs` (a re-export, so
client and server share one implementation; a test checks they are the same
function).

**Scope.** Spoilers render only in post/reply bodies (render.js) and wall
posts (wall.js parseInline). Lobby, DMs and group DMs never render `||x||`
as hidden, so their previews are out of scope (N/A). The forum has no push
or email senders (checked by grep).

### Audit table

| # | Path | Where (file:line at 080e4cc) | Masked before | Fixed |
|---|------|------------------------------|---------------|-------|
| 1 | Feed reply snippets (server cut at 80) | api/posts-feed.mjs:75 `replySnippet` | n (client masked after the cut, so a split spoiler showed) | y → `maskedExcerpt` |
| 2 | Notification previews (server cut at 80) | api/notifications.mjs:85 `postPreview` | partial (client trimmed a leftover `\|\|`) | y → `maskedExcerpt` |
| 3 | Public deletion archive (plain text) | api/archive.mjs:57, shown at public/js/routes/pages.js:102 | n | y → `maskSpoilers` server-side |
| 4 | MCP search_posts / recent_posts / list_board | api/mcp.mjs:497-505 `shapePost` | n | y |
| 5 | MCP get_post (full body + replies) | api/mcp.mjs:497-505 `shapePost` | n | y |
| 6 | MCP list_mentions excerpt | api/mcp.mjs:692 `shapeMention` | n | y |
| 7 | MCP lobby_read | api/mcp.mjs:731 | N/A (chat) | — |
| 8 | Markdown home + board feeds (titles) | api/discovery.mjs:196-198 `titleOf` | n | y (mask, then first line, then cut) |
| 9 | Markdown post page (title, body, replies) | api/discovery.mjs:186 `safeBody`, :244, :274 | n | y (`safeBody` masks first) |
| 10 | Sitemap | api/discovery.mjs:299-318 | N/A (URLs + dates only) | — |
| 11 | Bot's own context | reads through MCP (#4-#6) | n | y (via #4-#6) |
| 12 | Feed reply snippet display | public/js/render.js:183 | y (now gets pre-masked text) | — |
| 13 | "In reply to" parent context | public/js/render.js:293 | y | — |
| 14 | Quote prefill snippet (cut at 120) | public/js/render.js:470 | n | y → `maskSpoilers` before collapse |
| 15 | Edit history (earlier versions, plain text) | public/js/render.js:639 | n | y |
| 16 | Search reply hits | public/js/routes/feed.js:224 | y | — |
| 17 | Notification preview display | public/js/notifications.js:34 | y | — |
| 18 | Profile recent threads excerpt | public/js/profile-extras.js:48 | y | — |
| 19 | QOTD chip / showcase titles | public/js/traditions.js:46,58 (threadExcerpt) | y | — |
| 20 | Read aloud | public/js/read-aloud.js:42 | y | — |
| 21 | WebMCP search excerpts | public/js/webmcp.js:51 | n | y → `maskedExcerpt` |
| 22 | Page title | public/js/app.js:190 | N/A (no post text) | — |
| 23 | DM / group / lobby previews | api/chat.mjs:317, api/dm-groups.mjs:158, chat-widget-threads.js:184 | N/A (chat) | — |
| 24 | Staff desk (reports, member peek, appeals, admin queue) | desk/reports.js:41, desk/member-tools.js:61, desk/appeals.js:43, routes/admin.js:310 | N/A: staff see raw text to moderate | — |

**Counts:** 24 paths in total. 5 are N/A (#7, #10, #22, #23, #24), so 19
show post text. 11 were unmasked or only partly masked (#1-#6, #8, #9, #14,
#15, #21) and all 11 are fixed. The bot's context (#11) is closed by those
fixes, and the other 7 were already masked.

### Regression guard

`tests/wave17-spoiler-paths.test.mjs` (20 tests):
- It drives every server path through the real worker (feed, notifications,
  archive, 5 MCP tools, 3 markdown renderings) with a body whose spoiler is
  split by the 80-char cut and a first-line spoiler title, and asserts that
  no spoiler words come through.
- It checks the client paths (thread excerpt, notification preview, edit
  history via fake-dom) and pins the rest.
- It checks that the stored post and archive bodies are unchanged (masking is
  output-only), and that the server and client masks are the same function.
- **Static sweep:** any line in `api/` or `public/js/` (vendor excluded) that
  cuts body-like text (`body|snippet|preview|excerpt|reply_body|message|text|
  firstLine|flat` + `.slice(0, …)`) must mask on that line or appear in a
  short allow-list with a reason. A new preview path that skips the mask
  fails this test.

## F2 — Show spoilers (members)

A post or reply that has spoilers gets one quiet **Show spoilers** button
next to Copy link. One click reveals every spoiler on that card, never a
nested card's, and the button then hides itself. It is client-only
(`public/js/reveal-spoilers.js`), and `hasSpoilers` uses the shared mask, so
the button appears exactly when the card renders a spoiler.

## Strings

- `render.revealSpoilers`: en "Show spoilers", plus real translations in all
  20 locales (the spoiler wording matches each locale's `markdown.spoiler`).

## Tests

- 352 before → 376 after (wave17-spoiler-paths 20, wave17-reveal-spoilers 4).
- `pnpm exec wrangler deploy --dry-run` is clean. The only warning is the
  existing multi-environment notice.
