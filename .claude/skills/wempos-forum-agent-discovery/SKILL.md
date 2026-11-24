---
name: wempos-forum-agent-discovery
description: "Use when touching robots.txt, sitemap.xml, markdown-for-agents (Accept: text/markdown), /.well-known/api-catalog, openapi.json, auth.md, Link headers, the MCP server card, or WebMCP — or when an agent-readiness scanner (isitagentready) reports failures"
metadata:
  version: "1.1.0"
  source: local-git-analysis + session (re-verified 2026-11-21 at v5.0.0)
---

# Agent discovery surface

`worker.mjs` answers `/mcp` (`handleMcp`) and `handleDiscovery` BEFORE the `env.ASSETS` fallback — otherwise the SPA returns index.html with 200 (the original bug).

| Path | Source | Type |
|---|---|---|
| `/robots.txt` | static `public/robots.txt` | text/plain |
| `/sitemap.xml` | `api/discovery.mjs`, built from D1 per request | application/xml |
| `/`, `/c/<slug>`, `/posts/<id>` with `Accept: text/markdown` | `api/discovery.mjs` | text/markdown + `Vary: Accept` |
| `/.well-known/api-catalog` | discovery.mjs | application/linkset+json (RFC 9727) |
| `/openapi.json` | discovery.mjs | OpenAPI 3.1, public READ endpoints only (incl. `/api/version`) |
| `/auth.md` | discovery.mjs | honest auth description (no OAuth) |
| `/.well-known/mcp/server-card.json` | discovery.mjs | card for `/mcp` |
| Link header on HTML | `withDiscoveryHeaders` (discovery.mjs), applied in worker.mjs | api-catalog, service-desc, service-doc, describedby |
| WebMCP | `public/js/webmcp.js` | feature-detected `navigator.modelContext` |

## Rules
- robots.txt policy (owner): search yes, AI training no. RFC 9309: a crawler follows ONE best-matching group, so every group repeats the private-path Disallows.
- Sitemap, markdown and MCP obey the visibility law (wempos-forum-visibility-law) and spoiler masking (`maskedExcerpt`/`maskSpoilers`, `api/core/spoilers.mjs`).
- Honesty: describe only what exists. NO OAuth server, so never publish oauth-authorization-server / openid-configuration / oauth-protected-resource. Web Bot Auth doesn't apply (the forum sends no bot traffic).
- A new tool or public route → update the server card, auth.md and openapi.json in the same commit.
- Re-check with `POST https://isitagentready.com/api/scan {"url":"https://wempos-forum.com"}`; quick local check `curl -sI https://wempos-forum.com/ | grep -i ^link`.
