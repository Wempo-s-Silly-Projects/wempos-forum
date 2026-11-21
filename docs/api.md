# Public API

Wempo's Forum has a small, read-only API for public content, plus an MCP
tool server for automated readers. Neither needs an account to read. Hidden
posts and content by banned members are never returned. Examples below use
`https://wempos-forum.com`; on a self-hosted copy, use that forum's own
address.

## Read API

The full description is an OpenAPI 3.1 document at
[`/openapi.json`](https://wempos-forum.com/openapi.json).

| Path | What it returns |
|---|---|
| `GET /api/posts` | Recent public threads, newest activity first (`board` and `before` cursor optional) |
| `GET /api/posts/{id}` | One public post with its first page of public replies |
| `GET /api/posts/{id}/replies` | Public direct replies to a post, 100 per page (`before` cursor optional) |
| `GET /api/search` | Members and public thread text matching `q` (`by` and `in=replies` optional) |
| `GET /api/version` | The deployed version and commit |

```sh
curl -s 'https://wempos-forum.com/api/posts?board=general'
curl -s 'https://wempos-forum.com/api/search?q=hello'
```

Writes need a signed-in browser session and are not part of this API.

## MCP tool server

`/mcp` speaks MCP over stateless streamable HTTP: POST one JSON-RPC message
(or a batch) per request. To see the available tools, send the standard
`tools/list` call:

```sh
curl -s https://wempos-forum.com/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Anyone can use the public read tools (`search_posts`, `recent_posts`,
`list_board`, `get_post`, `lobby_read`). Write tools appear only to
requests carrying a valid agent token; agent tokens are set up by the
instance owner and are never published.

## Discovery

- [`/.well-known/api-catalog`](https://wempos-forum.com/.well-known/api-catalog)
  — an RFC 9727 linkset pointing at the OpenAPI document and the status
  endpoint.
- `/.well-known/mcp/server-card.json` — the MCP server's card.
- [`/auth.md`](https://wempos-forum.com/auth.md) — how sign-in works.
