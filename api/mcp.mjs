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

// Read-only MCP server (Model Context Protocol, Streamable HTTP transport,
// stateless, JSON responses only — no SSE stream, no sessions). Hand-rolled
// JSON-RPC 2.0: no SDK, no deps. Exposes PUBLIC forum content only — every
// row passes the visibility law (public + author not actively banned + every
// ancestor the same): lists are root posts filtered in SQL, get_post gates
// the post and its ancestors through canViewPost (anonymous viewer), and its
// replies are filtered in SQL on the reply AND its intermediate parent.
// No writes, no auth. The worker routes ALL methods on /mcp here.
import { BOARD_VALUES } from "./boards.mjs";
import { banFilterSql } from "./posts-feed.mjs";
import { canViewPost } from "./core/visibility.mjs";

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const SITE_ORIGIN = "https://wempos-forum.com";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const MAX_QUERY_LENGTH = 100;
const LIST_BODY_CHARS = 500;
const MAX_REPLIES = 100;
const MAX_BODY_BYTES = 65536;
const MAX_BATCH = 20;

const RPC_PARSE_ERROR = -32700;
const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;
const RPC_INTERNAL_ERROR = -32603;

const LIMIT_SCHEMA = Object.freeze({
  type: "integer", minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT,
  description: "Maximum number of posts to return (1-25).",
});

const TOOLS = Object.freeze([
  {
    name: "search_posts",
    title: "Search posts",
    description: "Case-insensitive text search over public topic posts (newest first).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: MAX_QUERY_LENGTH, description: "Text to find (1-100 characters)." },
        limit: LIMIT_SCHEMA,
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "recent_posts",
    title: "Recent posts",
    description: "The newest public topic posts across all boards.",
    inputSchema: {
      type: "object",
      properties: { limit: LIMIT_SCHEMA },
      additionalProperties: false,
    },
  },
  {
    name: "list_board",
    title: "List board",
    description: "The newest public topic posts on one board.",
    inputSchema: {
      type: "object",
      properties: {
        board: { type: "string", enum: BOARD_VALUES, description: "Board to list." },
        limit: LIMIT_SCHEMA,
      },
      required: ["board"],
      additionalProperties: false,
    },
  },
  {
    name: "get_post",
    title: "Get post",
    description: "One public post (full body) plus its public replies.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "integer", minimum: 1, description: "Post id." } },
      required: ["id"],
      additionalProperties: false,
    },
  },
]);

const ROW_SELECT =
  "SELECT p.id, p.author_id, p.parent_id, p.body, p.visibility, p.created_at, p.board, " +
  "u.username AS author_username FROM posts p JOIN users u ON u.id = p.author_id ";
const PUBLIC_ROOT_WHERE =
  "WHERE p.parent_id IS NULL AND p.visibility = 'public' AND " + banFilterSql("p") + " ";

// ---- HTTP edge ----------------------------------------------------------

export async function handleMcp(request, env) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed. This MCP server is stateless: POST JSON-RPC to /mcp." }), {
      status: 405,
      headers: { Allow: "POST", "Content-Type": "application/json" },
    });
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return jsonResponse(rpcError(null, RPC_INVALID_REQUEST, "Request body too large."));
  }
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return jsonResponse(rpcError(null, RPC_PARSE_ERROR, "Parse error: body is not valid JSON."));
  }
  if (Array.isArray(message)) return handleBatch(message, env);
  const reply = await dispatch(message, env);
  return reply === null ? new Response(null, { status: 202 }) : jsonResponse(reply);
}

async function handleBatch(messages, env) {
  if (messages.length === 0 || messages.length > MAX_BATCH) {
    return jsonResponse(rpcError(null, RPC_INVALID_REQUEST, "Batch must hold 1-" + MAX_BATCH + " messages."));
  }
  const replies = [];
  for (const message of messages) {
    const reply = await dispatch(message, env);
    if (reply !== null) replies.push(reply);
  }
  return replies.length === 0 ? new Response(null, { status: 202 }) : jsonResponse(replies);
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// ---- JSON-RPC dispatch --------------------------------------------------

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isValidId(id) {
  return typeof id === "string" || (typeof id === "number" && Number.isFinite(id));
}

// Returns a reply object, or null for a notification (no reply owed).
async function dispatch(message, env) {
  if (!message || typeof message !== "object" || Array.isArray(message) ||
      message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    // A response object sent by a client (result/error, no method) is acked silently.
    const isClientResponse = message && typeof message === "object" && !("method" in message) &&
      ("result" in message || "error" in message);
    return isClientResponse ? null : rpcError(null, RPC_INVALID_REQUEST, "Invalid JSON-RPC 2.0 request.");
  }
  if (!("id" in message)) return null; // notification (incl. notifications/initialized)
  const id = message.id;
  if (!isValidId(id)) return rpcError(null, RPC_INVALID_REQUEST, "Request id must be a string or number.");
  const params = message.params && typeof message.params === "object" ? message.params : {};
  try {
    return await routeMethod(id, message.method, params, env);
  } catch (error) {
    console.error("mcp: internal error", message.method, error && error.stack ? error.stack : error);
    return rpcError(id, RPC_INTERNAL_ERROR, "Internal error.");
  }
}

async function routeMethod(id, method, params, env) {
  switch (method) {
    case "initialize": return rpcResult(id, initializeResult(params, env));
    case "ping": return rpcResult(id, {});
    case "tools/list": return rpcResult(id, { tools: TOOLS });
    case "tools/call": return callTool(id, params, env);
    default: return rpcError(id, RPC_METHOD_NOT_FOUND, "Method not found: " + method);
  }
}

function initializeResult(params, env) {
  const requested = params.protocolVersion;
  return {
    protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "wempos-forum", version: (env && env.VERSION) || "4.4.0" },
    instructions: "Read-only access to public Wempo's Forum posts.",
  };
}

// ---- tools --------------------------------------------------------------

const TOOL_HANDLERS = Object.freeze({
  search_posts: searchPosts,
  recent_posts: recentPosts,
  list_board: listBoard,
  get_post: getPost,
});

async function callTool(id, params, env) {
  const handler = Object.hasOwn(TOOL_HANDLERS, params.name) ? TOOL_HANDLERS[params.name] : null;
  if (!handler) return rpcError(id, RPC_INVALID_PARAMS, "Unknown tool: " + String(params.name));
  const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
    ? params.arguments : {};
  const outcome = await handler(env, args);
  return rpcResult(id, outcome.error ? toolError(outcome.error) : toolText(outcome.data));
}

function toolText(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }], isError: false };
}

function toolError(text) {
  return { content: [{ type: "text", text }], isError: true };
}

// Returns { limit } or { error }.
function parseLimit(raw) {
  if (raw === undefined || raw === null) return { limit: DEFAULT_LIMIT };
  if (!Number.isInteger(raw) || raw < 1 || raw > MAX_LIMIT) {
    return { error: "limit must be an integer from 1 to " + MAX_LIMIT + "." };
  }
  return { limit: raw };
}

async function searchPosts(env, args) {
  const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
  if (!query || query.length > MAX_QUERY_LENGTH) {
    return { error: "query must be a string of 1-" + MAX_QUERY_LENGTH + " characters." };
  }
  const parsed = parseLimit(args.limit);
  if (parsed.error) return parsed;
  // Mirrors api/search.mjs / listRootPosts: instr(lower(body), ?) — no LIKE
  // wildcards to escape.
  const sql = ROW_SELECT + PUBLIC_ROOT_WHERE + "AND instr(lower(p.body), ?) > 0 ORDER BY p.id DESC LIMIT ?";
  return { data: await listRows(env, sql, [query, parsed.limit]) };
}

async function recentPosts(env, args) {
  const parsed = parseLimit(args.limit);
  if (parsed.error) return parsed;
  const sql = ROW_SELECT + PUBLIC_ROOT_WHERE + "ORDER BY p.id DESC LIMIT ?";
  return { data: await listRows(env, sql, [parsed.limit]) };
}

async function listBoard(env, args) {
  if (!BOARD_VALUES.includes(args.board)) {
    return { error: "board must be one of: " + BOARD_VALUES.join(", ") + "." };
  }
  const parsed = parseLimit(args.limit);
  if (parsed.error) return parsed;
  const sql = ROW_SELECT + PUBLIC_ROOT_WHERE + "AND p.board = ? ORDER BY p.id DESC LIMIT ?";
  return { data: await listRows(env, sql, [args.board, parsed.limit]) };
}

async function listRows(env, sql, values) {
  const result = await env.FORUM_DB.prepare(sql).bind(...values).all();
  return (result.results || []).map((row) => shapePost(row, LIST_BODY_CHARS));
}

async function getPost(env, args) {
  if (!Number.isInteger(args.id) || args.id < 1) return { error: "id must be an integer >= 1." };
  const row = await env.FORUM_DB.prepare(ROW_SELECT + "WHERE p.id = ? LIMIT 1").bind(args.id).first();
  // The visibility law for an anonymous viewer: public, author unbanned, and
  // every ancestor the same.
  if (!row || !(await canViewPost(env, row, null))) return { error: "Post not found." };
  return { data: { ...shapePost(row, null), replies: await publicReplies(env, args.id) } };
}

// Direct replies plus level-2 replies (replies to a direct reply). The target
// post is already gated; l1 is each reply's parent (the target itself, or the
// intermediate reply) and must pass the same law in SQL.
async function publicReplies(env, postId) {
  const sql =
    "SELECT p.id, p.author_id, p.parent_id, p.body, p.visibility, p.created_at, p.board, " +
    "u.username AS author_username FROM posts p JOIN users u ON u.id = p.author_id " +
    "JOIN posts l1 ON l1.id = p.parent_id " +
    "WHERE (p.parent_id = ? OR l1.parent_id = ?) " +
    "AND p.visibility = 'public' AND " + banFilterSql("p") + " " +
    "AND l1.visibility = 'public' AND " + banFilterSql("l1") + " " +
    "ORDER BY p.id ASC LIMIT ?";
  const result = await env.FORUM_DB.prepare(sql).bind(postId, postId, MAX_REPLIES).all();
  return (result.results || []).map((row) => ({ ...shapePost(row, null), parent_id: Number(row.parent_id) }));
}

function shapePost(row, maxChars) {
  const body = typeof row.body === "string" ? row.body : "";
  const truncated = maxChars !== null && body.length > maxChars;
  return {
    id: Number(row.id),
    url: SITE_ORIGIN + "/posts/" + Number(row.id),
    board: row.board || null,
    author: row.author_username || null,
    created_at: new Date(Number(row.created_at) * 1000).toISOString(),
    body: truncated ? body.slice(0, maxChars) + "…" : body,
    ...(truncated ? { truncated: true } : {}),
  };
}
