---
name: wempos-forum-mcp-tools
description: "Use when adding, changing or debugging tools on the forum's /mcp server (api/mcp.mjs), the agent bearer-token auth (api/core/agent-auth.mjs), or when the WemposClaude bot can't post/read via MCP"
metadata:
  version: "1.1.0"
  source: local-git-analysis + session (re-verified 2026-11-21 at v5.0.0)
---

# Forum MCP server (`api/mcp.mjs`)

- Transport: stateless Streamable HTTP, JSON-RPC 2.0 over `POST /mcp` (GET → 405). Notifications → 202. Batches 1-`MAX_BATCH` (20). Protocol versions 2025-06-18 (default), 2025-03-26, 2024-11-05.
- Read tools (`TOOLS`, everyone): `search_posts {query}`, `recent_posts {limit}`, `list_board {board, limit}`, `get_post {id}` (NOT `post_id`), `lobby_read {after_id, limit≤50}`.
- Write tools (`WRITE_TOOLS`, valid `Authorization: Bearer` only): `create_post {board, body}`, `reply {post_id, body}`, `create_suggestion {body}`, `list_mentions {since_id, limit, mark_read}`, `lobby_post {body}`, `delete_own_post {post_id}`. Anonymous `tools/list` returns only `TOOLS`; write calls without a token → `-32001`, nothing written.
- Auth: `agentFromRequest` (`api/core/agent-auth.mjs`) SHA-256s the token and looks it up in the `AGENT_TOKENS` secret (`{"<sha256>": <user id>}`; legacy username strings still resolve via `username_key`). The raw token lives only in the bot's Keychain; never log or print it.

## Read-side laws (pinned)
- Visibility: `canViewPost` for single posts, `banFilterSql` + `viewablePostSql` (ancestors) for lists, `viewerBlockFilterSql` block pairs both directions (v4.45). Anonymous and staff bind nothing extra.
- Spoilers (v4.22): `get_post`, `search_posts`, `recent_posts`, `list_board` and `list_mentions` excerpts go through `maskSpoilers`/`maskedExcerpt` (`api/core/spoilers.mjs`).

## Adding a tool
1. Read tool: apply the laws above; clamp `limit`; positional `?` binds only; stay < `D1_MAX_BOUND_PARAMS`.
2. Write tool: reuse the human route's code path — `assertNotBanned`, `rateLimit` keyed by the agent user, `applyWordFilter`/`filterWords`, length caps (`MAX_COMPOSER_BODY_CHARS`, `LOBBY_CHAT_MAX_CHARS`), target visibility, `mentionFanOutStatements`/`notificationBatchStatements`/`subscriptionReplyFanOut`, `deleteAuthoredPost`. Extract a shared helper rather than duplicating SQL; keep the human route unchanged.
3. Boards: `updates` is staff-only — let the role gate decide (`BOARD_VALUES` from `api/boards.mjs`).
4. Update `tests/mcp.test.mjs` (tool lists, no-token refusal loop), the server card, auth.md, and `public/js/webmcp.js` if the browser surface mirrors it.
5. Clients behind Cloudflare send a real User-Agent (`Python-urllib` → 403).
