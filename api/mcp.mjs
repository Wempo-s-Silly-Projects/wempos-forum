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
// The worker routes ALL methods on /mcp here.
//
// Agent writes: a request carrying a valid agent bearer token
// (core/agent-auth.mjs) additionally sees and may call the write tools
// (create_post, reply, create_suggestion, list_mentions), acting as that
// forum user. Anonymous clients see only the four read tools, and a write
// call without a valid token is refused with -32001 before any work. Every
// write runs the human routes' gates: assertNotBanned, requiredText length
// cap, the word filter, the staff-only updates board, the write/post-write
// rate-limit tiers keyed by the agent's user id, the visibility law, the
// guarded INSERTs, and the notification/@mention/subscription fan-out.
// Turnstile is the one human gate replaced: the bearer token is the proof.
import { REPLY_BUMP_SQL, THREAD_REPLY_INSERT_SQL } from "../constants.mjs";
import { BOARD_VALUES, GENERAL_BOARD_DEFAULT, SUGGESTIONS_BOARD, UPDATES_BOARD, boardField } from "./boards.mjs";
import { applyWordFilter } from "./filter.mjs";
import { ensureFilterWords, filterWords } from "./filterstore.mjs";
import { mentionFanOutStatements } from "./mentions.mjs";
import { notificationBatchStatements } from "./notifications.mjs";
import { banFilterSql } from "./posts-feed.mjs";
import { MAX_COMPOSER_BODY_CHARS, rootPostInsertSql } from "./posts-write.mjs";
import { runFanOutChunks, subscriptionReplyFanOut } from "./subscriptions.mjs";
import { agentFromRequest } from "./core/agent-auth.mjs";
import { assertNotBanned } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, rateLimit, requireMutationApplied, requiredText } from "./core/http.mjs";
import { postById } from "./core/shapers.mjs";
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
const RPC_UNAUTHORIZED = -32001;

const DEFAULT_MENTION_LIMIT = 20;
const MAX_MENTION_LIMIT = 50;
const MENTION_EXCERPT_CHARS = 200;
// Staff-only boards (posts-write.mjs handlePostCreateRoute: UPDATES_BOARD is
// admin/owner only) are left out of the agent's enum; the role gate still runs.
const AGENT_BOARD_VALUES = Object.freeze(BOARD_VALUES.filter((board) => board !== UPDATES_BOARD));
const BODY_SCHEMA = Object.freeze({
  type: "string", minLength: 1, maxLength: MAX_COMPOSER_BODY_CHARS,
  description: "Markdown body (1-" + MAX_COMPOSER_BODY_CHARS + " characters after trimming).",
});

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

const WRITE_TOOLS = Object.freeze([
  {
    name: "create_post",
    title: "Create post",
    description: "Start a new public topic on a board as the authenticated agent account.",
    inputSchema: {
      type: "object",
      properties: {
        board: { type: "string", enum: AGENT_BOARD_VALUES, description: "Board to post on." },
        body: BODY_SCHEMA,
      },
      required: ["board", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "reply",
    title: "Reply",
    description: "Reply to a public topic or to a direct reply (replies go at most two levels deep).",
    inputSchema: {
      type: "object",
      properties: {
        post_id: { type: "integer", minimum: 1, description: "Topic or level-1 reply id to answer." },
        body: BODY_SCHEMA,
      },
      required: ["post_id", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "create_suggestion",
    title: "Create suggestion",
    description: "Start a new topic on the suggestions board.",
    inputSchema: {
      type: "object",
      properties: { body: BODY_SCHEMA },
      required: ["body"],
      additionalProperties: false,
    },
  },
  {
    name: "list_mentions",
    title: "List mentions",
    description: "The agent account's newest notifications (mentions and replies), newest first.",
    inputSchema: {
      type: "object",
      properties: {
        since_id: { type: "integer", minimum: 0, description: "Only notifications with an id above this." },
        limit: { type: "integer", minimum: 1, maximum: MAX_MENTION_LIMIT, default: DEFAULT_MENTION_LIMIT },
        mark_read: { type: "boolean", default: false, description: "Mark the returned notifications read." },
      },
      additionalProperties: false,
    },
  },
]);
const AGENT_TOOLS = Object.freeze([...TOOLS, ...WRITE_TOOLS]);

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
  const ctx = { request, agent: await agentFromRequest(request, env) };
  if (Array.isArray(message)) return handleBatch(message, env, ctx);
  const reply = await dispatch(message, env, ctx);
  return reply === null ? new Response(null, { status: 202 }) : jsonResponse(reply);
}

async function handleBatch(messages, env, ctx) {
  if (messages.length === 0 || messages.length > MAX_BATCH) {
    return jsonResponse(rpcError(null, RPC_INVALID_REQUEST, "Batch must hold 1-" + MAX_BATCH + " messages."));
  }
  const replies = [];
  for (const message of messages) {
    const reply = await dispatch(message, env, ctx);
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
async function dispatch(message, env, ctx) {
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
    return await routeMethod(id, message.method, params, env, ctx);
  } catch (error) {
    console.error("mcp: internal error", message.method, error && error.stack ? error.stack : error);
    return rpcError(id, RPC_INTERNAL_ERROR, "Internal error.");
  }
}

async function routeMethod(id, method, params, env, ctx) {
  switch (method) {
    case "initialize": return rpcResult(id, initializeResult(params, env));
    case "ping": return rpcResult(id, {});
    case "tools/list": return rpcResult(id, { tools: ctx.agent ? AGENT_TOOLS : TOOLS });
    case "tools/call": return callTool(id, params, env, ctx);
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

const WRITE_TOOL_HANDLERS = Object.freeze({
  create_post: createPost,
  reply: createReply,
  create_suggestion: createSuggestion,
  list_mentions: listMentions,
});

async function callTool(id, params, env, ctx) {
  const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
    ? params.arguments : {};
  if (Object.hasOwn(WRITE_TOOL_HANDLERS, params.name)) {
    if (!ctx.agent) return rpcError(id, RPC_UNAUTHORIZED, "Unauthorized");
    return rpcResult(id, await runWriteTool(WRITE_TOOL_HANDLERS[params.name], env, args, ctx));
  }
  const handler = Object.hasOwn(TOOL_HANDLERS, params.name) ? TOOL_HANDLERS[params.name] : null;
  if (!handler) return rpcError(id, RPC_INVALID_PARAMS, "Unknown tool: " + String(params.name));
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

// ---- agent write tools -------------------------------------------------

// The human routes refuse with HttpError (status + user-facing message); a
// write tool surfaces that message as a tool error. Anything else bubbles to
// dispatch's -32603 handler.
async function runWriteTool(handler, env, args, ctx) {
  try {
    return toolText(await handler(env, args, ctx));
  } catch (error) {
    if (error instanceof HttpError) return toolError(error.message);
    throw error;
  }
}

// Mirrors posts-write.mjs handlePostCreateRoute / replies.mjs
// handleReplyCreateRoute: ban gate, then requiredText + word filter.
async function filteredBody(env, agent, raw, field) {
  await assertNotBanned(env, agent.id);
  await ensureFilterWords(env);
  return applyWordFilter(requiredText(raw, field, MAX_COMPOSER_BODY_CHARS), filterWords(env));
}

async function writeRateLimits(env, ctx) {
  await rateLimit(ctx.request, env, "write");
  await rateLimit(ctx.request, env, "post-write", String(ctx.agent.id));
}

function createPost(env, args, ctx) {
  return createRootPost(env, ctx, args.body, args.board);
}

function createSuggestion(env, args, ctx) {
  return createRootPost(env, ctx, args.body, SUGGESTIONS_BOARD);
}

// Text-only root post, no idempotency key, no attachments (both NULL binds).
async function createRootPost(env, ctx, rawBody, rawBoard) {
  const db = env.FORUM_DB;
  const agent = ctx.agent;
  const message = await filteredBody(env, agent, rawBody, "post");
  const board = boardField(rawBoard);
  if (board === UPDATES_BOARD && agent.role !== "owner" && agent.role !== "admin") {
    throw new HttpError(403, "Only admins can post updates.");
  }
  await writeRateLimits(env, ctx);
  const now = nowSeconds();
  const result = await db.prepare(rootPostInsertSql("'public'"))
    .bind(agent.id, message, now, now, board, null, null, null, agent.id, now, null, agent.id, null).run();
  requireMutationApplied(result);
  const postId = Number(result.meta.last_row_id);
  try {
    const mentionStatements = await mentionFanOutStatements(db, message, {
      actorId: agent.id,
      actorUsername: agent.username,
      targetPostId: postId,
      replyId: postId,
      now,
      excludeIds: [],
    });
    if (mentionStatements.length > 0) await db.batch(mentionStatements);
  } catch (error) {
    console.error("mcp: mention fan-out failed", postId, error && error.message ? error.message : error);
  }
  return { id: postId, url: SITE_ORIGIN + "/posts/" + postId, board };
}

const REPLY_TARGET_REFUSAL = "Replies must be attached to a public conversation, not another reply.";

// Resolves { target, bumpTargetId, threadBoard } with the reply route's depth
// and visibility refusals, in the same order.
async function resolveReplyTarget(env, agent, targetId) {
  const target = await postById(env, targetId, agent.id);
  if (!target || target.visibility !== "public") throw new HttpError(400, REPLY_TARGET_REFUSAL);
  let bumpTargetId = Number(target.id);
  let threadBoard = target.board || GENERAL_BOARD_DEFAULT;
  if (target.parent_id !== null && target.parent_id !== undefined) {
    const parent = await postById(env, Number(target.parent_id), agent.id);
    if (!parent || parent.visibility !== "public") throw new HttpError(400, REPLY_TARGET_REFUSAL);
    if (parent.parent_id !== null && parent.parent_id !== undefined) {
      throw new HttpError(400, "Replies only go one level deep.");
    }
    bumpTargetId = Number(parent.id);
    threadBoard = parent.board || GENERAL_BOARD_DEFAULT;
  }
  if (!(await canViewPost(env, target, agent))) {
    throw new HttpError(400, "Replies are closed while this conversation's author is banned.");
  }
  return { target, bumpTargetId, threadBoard };
}

async function createReply(env, args, ctx) {
  const db = env.FORUM_DB;
  const agent = ctx.agent;
  const targetId = args.post_id;
  if (!Number.isSafeInteger(targetId) || targetId < 1) throw new HttpError(404, "Post not found.");
  const message = await filteredBody(env, agent, args.body, "reply");
  await writeRateLimits(env, ctx);
  const { target, bumpTargetId, threadBoard } = await resolveReplyTarget(env, agent, targetId);
  const now = nowSeconds();
  const results = await db.batch([
    db.prepare(THREAD_REPLY_INSERT_SQL).bind(
      agent.id, targetId, message, now, now, threadBoard, null, null, null,
      targetId, agent.id, now, null, agent.id, null),
    db.prepare(REPLY_BUMP_SQL).bind(now, bumpTargetId),
  ]);
  if (Number(results[0]?.meta?.changes) !== 1) {
    throw new HttpError(409, "The conversation is no longer public or your account cannot post.");
  }
  const replyId = Number(results[0].meta.last_row_id);
  const recipientId = target.author_id === null || target.author_id === undefined ? null : Number(target.author_id);
  await replyFanOut(db, { agent, message, targetId, replyId, recipientId, bumpTargetId, now });
  return { id: replyId, url: SITE_ORIGIN + "/posts/" + replyId, parent_id: targetId };
}

// Best-effort, exactly the reply route's three fan-out sources.
async function replyFanOut(db, { agent, message, targetId, replyId, recipientId, bumpTargetId, now }) {
  try {
    const statements = notificationBatchStatements(db, recipientId, agent.id, targetId, replyId, now);
    statements.push(...await mentionFanOutStatements(db, message, {
      actorId: agent.id,
      actorUsername: agent.username,
      targetPostId: targetId,
      replyId,
      now,
      excludeIds: [recipientId],
    }));
    statements.push(...await subscriptionReplyFanOut(db, {
      rootPostId: bumpTargetId,
      replyAuthorId: agent.id,
      replyTargetId: recipientId,
      targetPostId: targetId,
      replyId,
      now,
    }));
    await runFanOutChunks(db, statements);
  } catch (error) {
    console.error("mcp: reply fan-out failed", replyId, error && error.message ? error.message : error);
  }
}

// The member-shape gating of notifications.mjs NOTIFICATION_SELECT_FILTERED
// (public reply, author unbanned, no block pair) applied to the row itself,
// plus the reply author's username. Post-targeted rows only (replies,
// mentions, thread-subscription replies); label-only rows are skipped.
// Bind order: recipient, since_id, recipient (blocks), recipient (blocks), limit.
const MENTIONS_SQL =
  "SELECT n.id, n.target_post_id, n.reply_id, n.created_at, n.read_at, n.label, " +
    "p.body AS reply_body, u.username AS author_username " +
  "FROM notifications n JOIN posts p ON p.id = n.reply_id JOIN users u ON u.id = p.author_id " +
  "WHERE n.user_id = ? AND n.id > ? AND n.target_post_id IS NOT NULL AND p.visibility = 'public' AND " +
    "NOT EXISTS (SELECT 1 FROM bans b WHERE b.user_id = p.author_id AND b.revoked_at IS NULL " +
    "AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER))) AND " +
    "NOT EXISTS (SELECT 1 FROM blocks bk WHERE (bk.blocker_id = ? AND bk.blocked_id = p.author_id) " +
    "OR (bk.blocker_id = p.author_id AND bk.blocked_id = ?)) " +
  "ORDER BY n.id DESC LIMIT ?";

// notifications.mjs read-one route: own rows only, unread only.
const MARK_READ_SQL =
  "UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL";

function parseMentionArgs(args) {
  const sinceId = args.since_id === undefined || args.since_id === null ? 0 : args.since_id;
  if (!Number.isSafeInteger(sinceId) || sinceId < 0) throw new HttpError(400, "since_id must be an integer >= 0.");
  const limit = args.limit === undefined || args.limit === null ? DEFAULT_MENTION_LIMIT : args.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MENTION_LIMIT) {
    throw new HttpError(400, "limit must be an integer from 1 to " + MAX_MENTION_LIMIT + ".");
  }
  if (args.mark_read !== undefined && typeof args.mark_read !== "boolean") {
    throw new HttpError(400, "mark_read must be a boolean.");
  }
  return { sinceId, limit, markRead: args.mark_read === true };
}

function shapeMention(row) {
  const body = typeof row.reply_body === "string" ? row.reply_body : "";
  return {
    id: Number(row.id),
    post_id: Number(row.reply_id),
    target_post_id: Number(row.target_post_id),
    post_url: SITE_ORIGIN + "/posts/" + Number(row.reply_id),
    author: row.author_username || null,
    label: row.label !== null && row.label !== undefined ? String(row.label) : null,
    excerpt: body.length > MENTION_EXCERPT_CHARS ? body.slice(0, MENTION_EXCERPT_CHARS) + "…" : body,
    read: row.read_at !== null && row.read_at !== undefined,
    created_at: new Date(Number(row.created_at) * 1000).toISOString(),
  };
}

async function listMentions(env, args, ctx) {
  const db = env.FORUM_DB;
  const userId = ctx.agent.id;
  const { sinceId, limit, markRead } = parseMentionArgs(args);
  const result = await db.prepare(MENTIONS_SQL).bind(userId, sinceId, userId, userId, limit).all();
  const mentions = (result.results || []).map(shapeMention);
  const unread = mentions.filter((mention) => !mention.read);
  if (markRead && unread.length > 0) {
    const now = nowSeconds();
    await db.batch(unread.map((mention) => db.prepare(MARK_READ_SQL).bind(now, mention.id, userId)));
  }
  return { mentions, marked_read: markRead ? unread.length : 0 };
}
