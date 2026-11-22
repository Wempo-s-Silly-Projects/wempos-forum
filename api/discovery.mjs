// Copyright 2026 ItsWempo
//
// This file is part of Wempo's Forum.
//
// Wempo's Forum is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the
// GNU Affero General Public License along with this program.  If not,
// see <https://www.gnu.org/licenses/>.
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// Agent discovery surface: everything an automated reader needs to find and
// read the forum's PUBLIC content, served by the worker ahead of the SPA
// assets fallback (which would otherwise answer every unknown path with
// index.html). Every document here describes only what really exists:
//   GET /robots.txt                        crawler policy + Sitemap line
//   GET /sitemap.xml                       sitemaps.org urlset, built from D1
//   (RSS feeds + /llms.txt live in api/feeds.mjs, v5.34)
//   GET /.well-known/api-catalog           RFC 9727 linkset
//   GET /openapi.json                      OpenAPI 3.1 for the public reads
//   GET /auth.md                           how auth actually works (no OAuth)
//   GET /.well-known/mcp/server-card.json  the /mcp endpoint's card
//   Accept: text/markdown on /, /c/<slug>, /posts/<id>  markdown renderings
//
// Visibility law: a post is public only when visibility = 'public' AND its
// author has no active ban AND every ancestor passes the same test. List
// queries carry it in SQL (banFilterSql is the one active-ban predicate);
// the single-post read goes through canViewPost with a guest viewer.
//
// Self-hosting (v5.17.0): every absolute URL is built on siteOrigin(env,
// request) — the configured SITE_ORIGIN, else the request's own origin.
import { BOARD_VALUES } from "./boards.mjs";
import { banFilterSql } from "./posts-feed.mjs";
import { securityHeaders } from "./core/http.mjs";
import { canViewPost } from "./core/visibility.mjs";
import { maskSpoilers, maskedExcerpt } from "./core/spoilers.mjs";
import { accountsOrigin, siteOrigin } from "./core/site.mjs";
import { siteName } from "./branding.mjs";

const README_URL = "https://github.com/Wempo-s-Silly-Projects/wempos-forum#readme";
const DEFAULT_VERSION = "4.4.0";
const SITEMAP_URL_CAP = 50000;
const MARKDOWN_FEED_LIMIT = 30;
const MARKDOWN_REPLY_LIMIT = 500;
const TITLE_MAX = 100;
// Edge-cacheable: DB-backed renderings (sitemap, markdown) briefly, the
// static documents longer, so repeat hits are served without a D1 read.
const FEED_CACHE = "public, max-age=60, s-maxage=300";
const DOC_CACHE = "public, max-age=300, s-maxage=3600";
const MCP_TOOL_NAMES = ["search_posts", "recent_posts", "list_board", "get_post", "lobby_read"];
// Token-gated (api/mcp.mjs WRITE_TOOLS): listed by name for discovery only;
// tools/list shows them solely to a valid bearer.
const MCP_WRITE_TOOL_NAMES = ["create_post", "reply", "create_suggestion", "list_mentions", "lobby_post", "delete_own_post"];

export const DISCOVERY_LINK_HEADER =
  '</.well-known/api-catalog>; rel="api-catalog", ' +
  '</openapi.json>; rel="service-desc"; type="application/openapi+json", ' +
  "<" + README_URL + '>; rel="service-doc", ' +
  '</auth.md>; rel="describedby"; type="text/markdown"';

// ---- visibility SQL ------------------------------------------------------

const PUBLIC_ROOT_WHERE =
  "p.parent_id IS NULL AND p.visibility = 'public' AND " + banFilterSql("p");

// Public replies under one target (bound twice, both slots = target id):
// direct children, plus grandchildren whose middle post is itself public and
// unbanned. The target's own chain is checked by canViewPost before this runs.
const PUBLIC_REPLIES_SQL =
  "SELECT r.id, r.parent_id, r.body, r.created_at, r.edited_at, u.username AS author_username " +
  "FROM posts r JOIN users u ON u.id = r.author_id LEFT JOIN posts l1 ON l1.id = r.parent_id " +
  "WHERE (r.parent_id = ? OR (l1.parent_id = ? AND l1.visibility = 'public' AND " + banFilterSql("l1") + ")) " +
  "AND r.visibility = 'public' AND " + banFilterSql("r") + " " +
  "ORDER BY r.created_at ASC, r.id ASC LIMIT " + MARKDOWN_REPLY_LIMIT;

// Same reply visibility as above, counted per root for the feed listings.
// `extraWhere` (v5.32) appends a caller's own predicate on rc (the counted
// reply) / rl (its parent) — the page head adds the viewer's block filter.
export function publicReplyCountSql(extraWhere = "") {
  return "(SELECT COUNT(*) FROM posts rc LEFT JOIN posts rl ON rl.id = rc.parent_id " +
    "WHERE (rc.parent_id = p.id OR (rl.parent_id = p.id AND rl.visibility = 'public' AND " + banFilterSql("rl") + ")) " +
    "AND rc.visibility = 'public' AND " + banFilterSql("rc") + extraWhere + ")";
}

export const PUBLIC_REPLY_COUNT_SQL = publicReplyCountSql();

const SITEMAP_POSTS_SQL =
  "SELECT p.id, MAX(p.created_at, COALESCE(p.edited_at, 0)) AS lastmod FROM posts p " +
  "WHERE " + PUBLIC_ROOT_WHERE + " ORDER BY p.id DESC LIMIT ?";

const SITEMAP_USERS_SQL =
  "SELECT u.username FROM users u WHERE EXISTS (SELECT 1 FROM posts p " +
  "WHERE p.author_id = u.id AND " + PUBLIC_ROOT_WHERE + ") ORDER BY u.id ASC LIMIT ?";

// Exported (v5.34): the RSS feeds (api/feeds.mjs) page the same SQL.
export function feedSql(withBoard) {
  return "SELECT p.id, p.body, p.board, p.created_at, u.username AS author_username, " +
    PUBLIC_REPLY_COUNT_SQL + " AS reply_count FROM posts p JOIN users u ON u.id = p.author_id " +
    "WHERE " + PUBLIC_ROOT_WHERE + (withBoard ? " AND p.board = ?" : "") +
    " ORDER BY p.last_activity_at DESC, p.id DESC LIMIT ?";
}

export const POST_ROW_SQL =
  "SELECT p.id, p.author_id, p.parent_id, p.body, p.visibility, p.board, p.created_at, p.edited_at, " +
  "u.username AS author_username FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ? LIMIT 1";

// ---- response helpers ----------------------------------------------------

function respond(request, body, contentType, { status = 200, cache = DOC_CACHE, extra = {} } = {}) {
  const headers = securityHeaders(new Headers(extra));
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", cache);
  headers.set("Access-Control-Allow-Origin", "*");
  const isHead = request.method.toUpperCase() === "HEAD";
  return new Response(isHead ? null : body, { status, headers });
}

function jsonDoc(request, data, contentType) {
  return respond(request, JSON.stringify(data, null, 2), contentType);
}

const MARKDOWN_TYPE = "text/markdown; charset=utf-8";

function markdownReply(request, body, status = 200, path = "") {
  const extra = { Vary: "Accept" };
  if (path === "/") extra.Link = DISCOVERY_LINK_HEADER;
  return respond(request, body, MARKDOWN_TYPE, { status, cache: status === 200 ? FEED_CACHE : "no-store", extra });
}

function noDatabase(request) {
  return respond(request, "The forum database is not configured.\n", "text/plain; charset=utf-8",
    { status: 503, cache: "no-store" });
}

// ---- content negotiation -------------------------------------------------

// q-value of one exact media type in an Accept header (0 when absent).
function acceptQuality(accept, mediaType) {
  let best = 0;
  for (const part of accept.split(",")) {
    const [type, ...params] = part.trim().toLowerCase().split(";");
    if (type.trim() !== mediaType) continue;
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const q = qParam ? Number(qParam.slice(2)) : 1;
    if (Number.isFinite(q) && q > best) best = q;
  }
  return best;
}

export function wantsMarkdown(request) {
  const accept = request.headers.get("Accept") || "";
  const markdownQ = acceptQuality(accept, "text/markdown");
  return markdownQ > 0 && markdownQ >= acceptQuality(accept, "text/html");
}

// The paths that have a markdown rendering (and therefore vary on Accept).
export function markdownTarget(path) {
  if (path === "/") return { kind: "home" };
  const board = path.match(/^\/c\/([a-z0-9-]+)$/);
  if (board) return { kind: "board", board: board[1] };
  const post = path.match(/^\/posts\/([0-9]+)$/);
  if (post) return { kind: "post", id: Number(post[1]) };
  return null;
}

// Adds Vary: Accept to every negotiable page and the discovery Link header to
// the homepage, keeping every header the response already carries.
export function withDiscoveryHeaders(response, path) {
  if (!markdownTarget(path)) return response;
  const headers = new Headers(response.headers);
  headers.append("Vary", "Accept");
  if (path === "/") headers.append("Link", DISCOVERY_LINK_HEADER);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// ---- markdown rendering --------------------------------------------------

function mdInline(text) {
  return String(text).replace(/[\\`*_[\]<>|#]/g, "\\$&");
}

// A user body line that would open markdown structure at column 0 (heading,
// blockquote, HTML block, code fence, thematic break / setext underline).
const STRUCTURAL_LINE = /^ {0,3}(?:[#><]|```|~~~|[-*_=][-*_=\s]*$)/;

// Escapes the leading marker of structural lines with a backslash, so a post
// body can never forge a "## Replies" section, a separator, or an attribution
// heading; ordinary prose, lists, links, and emphasis render unchanged.
// Spoilers are masked first (wave 17): markdown readers get no reveal click.
function safeBody(text) {
  return maskSpoilers(text).split("\n")
    .map((line) => (STRUCTURAL_LINE.test(line) ? line.replace(/^( {0,3})/, "$1\\") : line))
    .join("\n");
}

function isoDate(seconds) {
  return new Date(Number(seconds) * 1000).toISOString();
}

export function titleOf(row) {
  const firstLine = maskSpoilers(row.body).split("\n").map((line) => line.trim()).find(Boolean) || "";
  if (!firstLine) return "Post #" + row.id;
  return maskedExcerpt(firstLine, TITLE_MAX);
}

function userLink(username, origin) {
  return "[" + mdInline(username) + "](" + origin + "/users/" + encodeURIComponent(username) + ")";
}

function feedLine(row, origin) {
  const replies = Number(row.reply_count || 0);
  return "- [" + mdInline(titleOf(row)) + "](" + origin + "/posts/" + row.id + ") — by " +
    userLink(row.author_username, origin) + " in [" + row.board + "](" + origin + "/c/" + row.board + ") · " +
    replies + (replies === 1 ? " reply" : " replies") + " · " + isoDate(row.created_at);
}

async function recentRoots(env, board) {
  const statement = env.FORUM_DB.prepare(feedSql(Boolean(board)));
  const bound = board ? statement.bind(board, MARKDOWN_FEED_LIMIT) : statement.bind(MARKDOWN_FEED_LIMIT);
  const result = await bound.all();
  return result.results || [];
}

function feedSection(rows, origin) {
  return rows.length ? rows.map((row) => feedLine(row, origin)).join("\n") : "_No public posts yet._";
}

async function homeMarkdown(env, origin) {
  const rows = await recentRoots(env, null);
  const name = await siteName(env);
  const boards = BOARD_VALUES.map((slug) => "- [" + slug + "](" + origin + "/c/" + slug + ")").join("\n");
  return "# " + name + "\n\n" +
    "A community forum. This is the markdown rendering of " + origin + "/ for automated readers.\n\n" +
    "## Boards\n\n" + boards + "\n\n" +
    "## Recent public posts\n\n" + feedSection(rows, origin) + "\n\n" +
    "## More\n\n- Sitemap: " + origin + "/sitemap.xml\n- API description: " + origin + "/openapi.json\n" +
    "- MCP endpoint: " + origin + "/mcp\n- Auth notes: " + origin + "/auth.md\n";
}

async function boardMarkdown(env, board, origin) {
  const rows = await recentRoots(env, board);
  return "# " + (await siteName(env)) + " — " + board + "\n\n" +
    "Recent public posts in the " + board + " board (" + origin + "/c/" + board + ").\n\n" +
    feedSection(rows, origin) + "\n";
}

function replyBlock(reply, depth, origin) {
  const heading = depth === 1 ? "### " : "#### ↳ ";
  return heading + mdInline(reply.author_username) + " · " + isoDate(reply.created_at) +
    " · " + origin + "/posts/" + reply.id + "\n\n" + safeBody(reply.body) + "\n";
}

function repliesSection(targetId, replies, origin) {
  if (!replies.length) return "## Replies (0)\n\n_No public replies._\n";
  const children = new Map();
  for (const reply of replies) {
    const key = Number(reply.parent_id);
    children.set(key, [...(children.get(key) || []), reply]);
  }
  const blocks = (children.get(targetId) || []).flatMap((reply) => [
    replyBlock(reply, 1, origin),
    ...(children.get(Number(reply.id)) || []).map((child) => replyBlock(child, 2, origin)),
  ]);
  return "## Replies (" + replies.length + ")\n\n" + blocks.join("\n");
}

async function postMarkdown(env, id, origin) {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const row = await env.FORUM_DB.prepare(POST_ROW_SQL).bind(id).first();
  if (!row || !(await canViewPost(env, row, null))) return null;
  const result = await env.FORUM_DB.prepare(PUBLIC_REPLIES_SQL).bind(id, id).all();
  const meta = [
    "- Author: " + userLink(row.author_username, origin),
    "- Board: [" + row.board + "](" + origin + "/c/" + row.board + ")",
    "- Posted: " + isoDate(row.created_at) + (row.edited_at ? " (edited " + isoDate(row.edited_at) + ")" : ""),
    "- URL: " + origin + "/posts/" + row.id,
    ...(row.parent_id ? ["- In reply to: " + origin + "/posts/" + row.parent_id] : []),
  ];
  return "# " + mdInline(titleOf(row)) + "\n\n" + meta.join("\n") + "\n\n---\n\n" +
    safeBody(row.body) + "\n\n---\n\n" + repliesSection(id, result.results || [], origin);
}

const NOT_FOUND_MARKDOWN = "# Not found\n\nNo public page exists at this address.\n";

export async function markdownResponse(request, env, path) {
  const target = markdownTarget(path);
  if (!target) return null;
  if (!env.FORUM_DB) return noDatabase(request);
  const origin = siteOrigin(env, request);
  if (target.kind === "home") return markdownReply(request, await homeMarkdown(env, origin), 200, path);
  if (target.kind === "board") {
    if (!BOARD_VALUES.includes(target.board)) return markdownReply(request, NOT_FOUND_MARKDOWN, 404);
    return markdownReply(request, await boardMarkdown(env, target.board, origin));
  }
  const body = await postMarkdown(env, target.id, origin);
  return body === null ? markdownReply(request, NOT_FOUND_MARKDOWN, 404) : markdownReply(request, body);
}

// ---- sitemap -------------------------------------------------------------

export function xmlEscape(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function urlEntry(loc, lastmod) {
  return "<url><loc>" + xmlEscape(loc) + "</loc>" +
    (lastmod ? "<lastmod>" + xmlEscape(lastmod) + "</lastmod>" : "") + "</url>";
}

export async function buildSitemap(env, origin) {
  const fixed = [origin + "/", origin + "/week", ...BOARD_VALUES.map((slug) => origin + "/c/" + slug)];
  const postBudget = SITEMAP_URL_CAP - fixed.length;
  const posts = (await env.FORUM_DB.prepare(SITEMAP_POSTS_SQL).bind(postBudget).all()).results || [];
  const userBudget = postBudget - posts.length;
  const users = userBudget > 0
    ? (await env.FORUM_DB.prepare(SITEMAP_USERS_SQL).bind(userBudget).all()).results || []
    : [];
  const entries = [
    ...fixed.map((loc) => urlEntry(loc)),
    ...posts.map((row) => urlEntry(origin + "/posts/" + row.id, row.lastmod ? isoDate(row.lastmod) : null)),
    ...users.map((row) => urlEntry(origin + "/users/" + encodeURIComponent(row.username))),
  ];
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + entries.join("\n") + "\n</urlset>\n";
}

// ---- static discovery documents -----------------------------------------

export function apiCatalog(origin) {
  return {
    linkset: [{
      anchor: origin + "/api/",
      "service-desc": [{ href: origin + "/openapi.json", type: "application/openapi+json" }],
      "service-doc": [{ href: README_URL, type: "text/html" }, { href: origin + "/llms.txt", type: "text/plain" }],
      // v5.34: the RSS feed of the latest public topics (per board: /c/<board>/feed.xml).
      alternate: [{ href: origin + "/feed.xml", type: "application/rss+xml" }],
      status: [{ href: origin + "/api/version", type: "application/json" }],
    }],
  };
}

export function serverCard(env, origin) {
  return {
    serverInfo: { name: "wempos-forum", version: typeof env.VERSION === "string" && env.VERSION ? env.VERSION : DEFAULT_VERSION },
    transport: { type: "streamable-http", endpoint: origin + "/mcp" },
    capabilities: { tools: {} },
    description: "Public read tools for everyone; write tools only for the forum's own authorized bot " +
      "via bearer token (no public registration); token-gated write tools: " + MCP_WRITE_TOOL_NAMES.join(", "),
    tools: MCP_TOOL_NAMES.map((name) => ({ name })),
  };
}

// Accounts unset (a self-hosted copy that has not configured ACCOUNTS_ORIGIN
// yet) names no address rather than someone else's.
export function authMarkdown(origin, accounts) {
  const accountsAt = accounts ? "Wempo Accounts (" + accounts + ")" : "Wempo Accounts";
  return `# Wempo's Forum auth.md

How authentication works on ${origin}, for people and for automated agents.

## Agents: no credentials needed for reading

All public content can be read without signing in. There is no OAuth
authorization server, no agent registration API, and no API keys are issued
to the public.
Do not look for oauth-protected-resource or oauth-authorization-server
documents — none are published, because none exist.

Public, unauthenticated read surfaces:

- \`GET /api/posts\` — recent public threads (optional \`board\`, \`before\` cursor)
- \`GET /api/posts/{id}\` — one public post with its public replies
- \`GET /api/posts/{id}/replies\` — paginated public replies
- \`GET /api/search?q=...\` — search members and public posts
- \`GET /api/version\` — deployed version
- \`/mcp\` — MCP endpoint (streamable HTTP; public read tools: ${MCP_TOOL_NAMES.join(", ")})
- \`Accept: text/markdown\` on \`/\`, \`/c/<board>\`, \`/posts/<id>\` — markdown renderings
- \`GET /sitemap.xml\` — every public thread, board, and author page
- \`GET /openapi.json\` — OpenAPI description of the read endpoints above

Hidden posts and content by banned members are never served on any of these.

## People: sign in through Wempo Accounts

Humans sign in at ${accountsAt}. After sign-in, Accounts
sends the browser back to the forum with a one-time code that the forum
redeems for its own session cookie. Posting, reacting, and every other write
needs that browser session.

## The forum's own bot: bearer token

The MCP endpoint's write tools (posting, replying, lobby chat, mentions,
deleting the bot's own posts: ${MCP_WRITE_TOOL_NAMES.join(", ")}) are
available only to the forum's own authorized bot account, which presents a
bearer token issued by the forum operator. There is no public registration
and no way to request a token; every other client gets the public read tools.
`;
}

// RFC 9309 crawler policy (owner: search yes, AI training no). A crawler
// follows only the ONE group that best matches its name, so every group
// repeats the private-path rules.
const ROBOTS_PRIVATE_PATHS = ["/api/", "/admin", "/login", "/setup", "/notifications", "/bookmarks"]
  .map((path) => "Disallow: " + path).join("\n");

export function robotsTxt(origin) {
  return `# Wempo's Forum — ${origin}
# Policy: search engines and AI search/answer tools may index and cite the
# forum; AI model-training crawlers may not use members' posts.
# Note (RFC 9309): a crawler follows only the ONE group that best matches its
# name, so every group repeats the private-path rules.
# Summary for AI assistants: ${origin}/llms.txt
# RSS feed of the latest public topics: ${origin}/feed.xml

# Everyone else (classic search engines included).
User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=no
Allow: /
${ROBOTS_PRIVATE_PATHS}

# AI search and answer tools: allowed to read and cite public pages.
User-agent: OAI-SearchBot
User-agent: ChatGPT-User
User-agent: Claude-SearchBot
User-agent: Claude-User
User-agent: Claude-Web
User-agent: PerplexityBot
User-agent: Perplexity-User
Content-Signal: search=yes, ai-input=yes, ai-train=no
Allow: /
${ROBOTS_PRIVATE_PATHS}

# AI model-training crawlers: not allowed.
User-agent: GPTBot
User-agent: ClaudeBot
User-agent: anthropic-ai
User-agent: Google-Extended
User-agent: Applebot-Extended
User-agent: CCBot
User-agent: Bytespider
User-agent: meta-externalagent
Content-Signal: search=no, ai-input=no, ai-train=no
Disallow: /

Sitemap: ${origin}/sitemap.xml
`;
}

// ---- OpenAPI 3.1 (public, unauthenticated reads only) --------------------

const nullableString = { type: ["string", "null"] };
const isoString = { type: "string", format: "date-time" };
const ref = (name) => ({ $ref: "#/components/schemas/" + name });
const errorResponse = (description) => ({
  description,
  content: { "application/json": { schema: ref("Error") } },
});
const okJson = (schema) => ({
  description: "OK",
  content: { "application/json": { schema } },
});
const postIdParam = { name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } };

const OPENAPI_SCHEMAS = {
  Error: { type: "object", required: ["error"], properties: { error: { type: "string" } } },
  Author: {
    type: "object",
    required: ["id", "username"],
    properties: {
      id: { type: "integer" },
      username: { type: "string" },
      flair: nullableString,
      profileAccent: nullableString,
      role: { type: ["string", "null"], description: "'owner' or 'admin' for staff, null for members" },
      avatarUrl: nullableString,
    },
  },
  Attachment: {
    type: "object",
    properties: {
      id: { type: "integer" },
      status: { type: "string" },
      mime: { type: "string" },
      version: { type: "integer" },
      awaiting: { type: "boolean" },
      width: { type: ["integer", "null"], description: "pixel width from the image header, when known" },
      height: { type: ["integer", "null"], description: "pixel height from the image header, when known" },
    },
  },
  Post: {
    type: "object",
    required: ["id", "body", "board", "createdAt", "author"],
    properties: {
      id: { type: "integer" },
      body: { type: "string" },
      visibility: { type: "string", enum: ["public"] },
      board: { type: "string", enum: BOARD_VALUES },
      suggestionStatus: nullableString,
      viewCount: { type: "integer" },
      createdAt: isoString,
      lastActivityAt: { type: ["string", "null"], format: "date-time" },
      editedAt: { type: ["string", "null"], format: "date-time" },
      author: ref("Author"),
      parent: {
        type: ["object", "null"],
        properties: { id: { type: "integer" }, body: { type: "string" } },
      },
      likeCount: { type: "integer" },
      dislikeCount: { type: "integer" },
      viewerReaction: nullableString,
      pinnedAt: { type: ["string", "null"], format: "date-time" },
      publicLevel: { type: "integer", enum: [0, 1, 2] },
      attachments: { type: "array", items: ref("Attachment") },
    },
  },
  LatestReply: {
    type: "object",
    properties: {
      id: { type: "integer" },
      authorUsername: { type: "string" },
      avatarUrl: nullableString,
      snippet: { type: "string" },
      createdAt: isoString,
      subReplyCount: { type: "integer" },
    },
  },
  FeedPost: {
    allOf: [ref("Post"), {
      type: "object",
      properties: {
        replyCount: { type: "integer" },
        latestReplies: { type: "array", items: ref("LatestReply") },
      },
    }],
  },
  Reply: {
    allOf: [ref("Post"), { type: "object", properties: { subReplyCount: { type: "integer" } } }],
  },
  Poll: {
    type: "object",
    properties: {
      question: { type: "string" },
      options: {
        type: "array",
        items: { type: "object", properties: { id: { type: "integer" }, label: { type: "string" }, count: { type: "integer" } } },
      },
      totalVotes: { type: "integer" },
    },
  },
  PostDetail: {
    allOf: [ref("Post"), {
      type: "object",
      properties: {
        replies: { type: "array", items: ref("Reply") },
        repliesNextBefore: { type: ["integer", "null"] },
        subscribed: { type: "boolean" },
        poll: ref("Poll"),
      },
    }],
  },
  User: {
    type: "object",
    properties: {
      id: { type: "integer" },
      username: { type: "string" },
      role: { type: "string" },
      bio: { type: "string" },
      socials: { type: "object", additionalProperties: { type: "string" } },
      polytoriaUsername: nullableString,
      profileAccent: { type: "string" },
      avatarStatus: nullableString,
      avatarUrl: nullableString,
    },
  },
};

const OPENAPI_PATHS = {
  "/api/posts": {
    get: {
      operationId: "listPosts",
      summary: "Recent public threads (root posts), newest activity first; suggestions sort by score",
      parameters: [
        { name: "board", in: "query", required: false, schema: { type: "string", enum: BOARD_VALUES } },
        { name: "before", in: "query", required: false, description: "Opaque cursor from a previous page's nextBefore", schema: { type: "string" } },
      ],
      responses: {
        200: okJson({
          type: "object",
          required: ["posts", "nextBefore"],
          properties: { posts: { type: "array", items: ref("FeedPost") }, nextBefore: nullableString },
        }),
        400: errorResponse("Unknown board or invalid cursor"),
      },
    },
  },
  "/api/posts/{id}": {
    get: {
      operationId: "getPost",
      summary: "One public post with its first page of public replies",
      parameters: [postIdParam],
      responses: { 200: okJson(ref("PostDetail")), 404: errorResponse("Post not found or not public") },
    },
  },
  "/api/posts/{id}/replies": {
    get: {
      operationId: "listReplies",
      summary: "Public direct replies to a post, 100 per page",
      parameters: [postIdParam, { name: "before", in: "query", required: false, schema: { type: "integer", minimum: 1 } }],
      responses: {
        200: okJson({
          type: "object",
          required: ["replies", "nextBefore"],
          properties: { replies: { type: "array", items: ref("Reply") }, nextBefore: { type: ["integer", "null"] } },
        }),
        400: errorResponse("Invalid cursor"),
        404: errorResponse("Post not found or not public"),
      },
    },
  },
  "/api/search": {
    get: {
      operationId: "search",
      summary: "Search members and public thread text (optionally reply text)",
      parameters: [
        { name: "q", in: "query", required: true, schema: { type: "string", minLength: 1, maxLength: 100 } },
        { name: "by", in: "query", required: false, description: "Limit post results to one member's username", schema: { type: "string" } },
        { name: "in", in: "query", required: false, description: "'replies' also searches reply text", schema: { type: "string", enum: ["replies"] } },
      ],
      responses: {
        200: okJson({
          type: "object",
          required: ["users", "posts"],
          properties: {
            users: { type: "array", items: ref("User") },
            posts: { type: "array", items: ref("FeedPost") },
            replies: {
              type: "array",
              items: { allOf: [ref("Post"), { type: "object", properties: { threadId: { type: "integer" } } }] },
            },
          },
        }),
        400: errorResponse("Query longer than 100 characters or bad 'in' value"),
      },
    },
  },
  "/api/version": {
    get: {
      operationId: "getVersion",
      summary: "Deployed version and commit",
      responses: {
        200: okJson({
          type: "object",
          required: ["version", "commit"],
          properties: { version: { type: "string" }, commit: { type: "string" } },
        }),
      },
    },
  },
};

export function openApiDocument(env, origin, name) {
  return {
    openapi: "3.1.0",
    info: {
      title: name + " public read API",
      version: typeof env.VERSION === "string" && env.VERSION ? env.VERSION : DEFAULT_VERSION,
      description: "Unauthenticated read endpoints for public forum content. Hidden posts and " +
        "content by banned members are never returned. Writes require a browser session and are not described here.",
      license: { name: "AGPL-3.0-or-later", identifier: "AGPL-3.0-or-later" },
    },
    externalDocs: { url: README_URL },
    servers: [{ url: origin }],
    paths: OPENAPI_PATHS,
    components: { schemas: OPENAPI_SCHEMAS },
  };
}

// ---- dispatcher ----------------------------------------------------------

const DOCUMENT_ROUTES = {
  "/robots.txt": (request, env, origin) => respond(request, robotsTxt(origin), "text/plain; charset=utf-8"),
  "/.well-known/api-catalog": (request, env, origin) => jsonDoc(request, apiCatalog(origin), "application/linkset+json"),
  "/openapi.json": async (request, env, origin) =>
    jsonDoc(request, openApiDocument(env, origin, await siteName(env)), "application/openapi+json"),
  "/auth.md": (request, env, origin) => respond(request, authMarkdown(origin, accountsOrigin(env)), MARKDOWN_TYPE),
  "/.well-known/mcp/server-card.json": (request, env, origin) => jsonDoc(request, serverCard(env, origin), "application/json"),
  "/sitemap.xml": async (request, env, origin) => env.FORUM_DB
    ? respond(request, await buildSitemap(env, origin), "application/xml; charset=utf-8", { cache: FEED_CACHE })
    : noDatabase(request),
};

// Answers a discovery request, or null so the caller falls through to the
// SPA assets. Only GET/HEAD are claimed.
export async function handleDiscovery(request, env, path) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return null;
  const route = DOCUMENT_ROUTES[path];
  if (route) return route(request, env, siteOrigin(env, request));
  if (wantsMarkdown(request)) return markdownResponse(request, env, path);
  return null;
}
