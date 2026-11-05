// Live chat + online presence (v3.1, Desen's ask): polling-based — one D1
// heartbeat for presence and one flat message stream for chat, no Durable
// Objects. The client polls GET /api/chat?after=<id> for both (messages and
// the online count ride the same response) and POSTs /api/presence as its
// heartbeat. Chat bodies run through the word filter like every other stored
// member-written text; messages by actively banned members vanish at read
// time (the same semantics as posts, banFilterSql's shape scoped to
// chat_messages.user_id); staff can delete any message.
import {
  HttpError,
  assertNotBanned,
  json,
  nowSeconds,
  publicRole,
  rateLimit,
  readJson,
  requireUser,
  requiremod,
} from "./shared.mjs";
import { applyWordFilter } from "./filter.mjs";
import { scheduleTextCheck } from "./textmod.mjs";

// A member counts as online for 3 minutes after their last heartbeat; the
// client pings every 60s.
const PRESENCE_WINDOW_SECONDS = 180;
const CHAT_PAGE_LIMIT = 50;
const CHAT_MAX_CHARS = 500;
const ADMIN_CHAT_PAGE_LIMIT = 100;

// Read-time active-ban filter for chat rows: same shape as banFilterSql, but
// chat_messages keys the author by user_id, not author_id.
const CHAT_BAN_FILTER_SQL =
  "NOT EXISTS (SELECT 1 FROM bans b WHERE b.user_id = c.user_id " +
  "AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > " +
  "CAST(strftime('%s','now') AS INTEGER)))";

const CHAT_SELECT =
  "SELECT c.id, c.body, c.created_at, c.user_id AS author_id, " +
  "u.username AS author_username, u.role AS author_role " +
  "FROM chat_messages c JOIN users u ON u.id = c.user_id ";

// The desk's view adds the active-ban flag so the log can mark (and act on)
// banned authors whose messages the public read already hides.
const CHAT_ADMIN_SELECT =
  "SELECT c.id, c.body, c.created_at, c.user_id AS author_id, " +
  "u.username AS author_username, u.role AS author_role, " +
  "EXISTS (SELECT 1 FROM bans b WHERE b.user_id = c.user_id " +
  "AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > " +
  "CAST(strftime('%s','now') AS INTEGER))) AS author_banned " +
  "FROM chat_messages c JOIN users u ON u.id = c.user_id ";

function publicChatMessage(row) {
  return {
    id: Number(row.id),
    body: row.body,
    createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
    author: {
      id: Number(row.author_id),
      username: row.author_username,
      // Mapped public role ('owner'/'admin'), null for members.
      role: row.author_role ? publicRole(row.author_role) : null,
    },
  };
}

// The poll endpoint: messages after the cursor (latest 50 when absent) plus
// the online count, so one request keeps both halves of the panel fresh.
// Public — guests read the chat; sending requires a session.
async function handleChatReadRoute(request, env, url, path, method) {
  if (path !== "/api/chat" || method !== "GET") return null;
  const db = env.FORUM_DB;
  const afterRaw = url.searchParams.get("after");
  let after = null;
  if (afterRaw !== null && afterRaw !== "") {
    if (!/^[0-9]{1,15}$/.test(afterRaw)) throw new HttpError(400, "That chat cursor is invalid.");
    after = Number(afterRaw);
  }
  const rows = after === null
    // Initial load: newest 50, oldest-first for append-order rendering.
    ? (await db.prepare(
      CHAT_SELECT + "WHERE " + CHAT_BAN_FILTER_SQL + " ORDER BY c.id DESC LIMIT " + CHAT_PAGE_LIMIT,
    ).all()).results || []
    : (await db.prepare(
      CHAT_SELECT + "WHERE c.id > ? AND " + CHAT_BAN_FILTER_SQL +
      " ORDER BY c.id ASC LIMIT " + CHAT_PAGE_LIMIT,
    ).bind(after).all()).results || [];
  const messages = after === null ? rows.reverse() : rows;
  const onlineRow = await db.prepare(
    "SELECT COUNT(*) AS online FROM presence WHERE invisible = 0 AND last_seen > ?",
  ).bind(nowSeconds() - PRESENCE_WINDOW_SECONDS).first();
  return json({
    messages: messages.map(publicChatMessage),
    // lastId drives the next poll's cursor; 0 when the stream is empty.
    lastId: messages.length ? Number(messages[messages.length - 1].id) : (after || 0),
    online: Number(onlineRow?.online || 0),
  });
}

async function handleChatCreateRoute(request, env, url, path, method, ctx) {
  if (path !== "/api/chat" || method !== "POST") return null;
  const session = await requireUser(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write");
  const body = await readJson(request);
  const message = applyWordFilter(
    String(body.body ?? "").trim().slice(0, CHAT_MAX_CHARS),
    env.FILTERED_WORDS,
  );
  if (!message) throw new HttpError(400, "Write a message first.");
  const result = await env.FORUM_DB.prepare(
    "INSERT INTO chat_messages (user_id, body, created_at) VALUES (?, ?, ?)",
  ).bind(session.user.id, message, nowSeconds()).run();
  const row = await env.FORUM_DB.prepare(
    CHAT_SELECT + "WHERE c.id = ? LIMIT 1",
  ).bind(Number(result.meta?.last_row_id)).first();
  // Text auto-mod (v3.1): the message scores in the background; a trip
  // deletes it (chat has no hidden state — the same permanence as staff
  // deletion) and records an appealable action. The send never waits.
  scheduleTextCheck(ctx, env, {
    kind: "chat", entityId: Number(result.meta?.last_row_id),
    userId: session.user.id, text: message,
  });
  return json({ message: publicChatMessage(row) }, 201);
}

// Staff cleanup: any chat message, any author. The deletion is immediate and
// permanent (chat is ephemeral by nature — no archive copy, unlike posts).
async function handleChatDeleteRoute(request, env, url, path, method) {
  const match = path.match(/^\/api\/chat\/([0-9]{1,15})$/);
  if (!match) return null;
  if (method !== "DELETE") throw new HttpError(405, "That method is not supported.");
  const session = await requiremod(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write");
  const deleted = await env.FORUM_DB.prepare("DELETE FROM chat_messages WHERE id = ?")
    .bind(Number(match[1])).run();
  if (Number(deleted.meta?.changes) !== 1) throw new HttpError(404, "Message not found.");
  return json({ ok: true });
}

// Presence heartbeat (signed-in only): one row per member, refreshed on every
// ping. The invisible flag rides each heartbeat, so toggling it takes effect
// immediately — no lurking member is ever counted before they opt out.
async function handlePresenceRoute(request, env, url, path, method) {
  if (path !== "/api/presence" || method !== "POST") return null;
  const session = await requireUser(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write");
  const body = await readJson(request);
  const invisible = body.invisible === true || body.invisible === "true" ? 1 : 0;
  await env.FORUM_DB.prepare(
    "INSERT INTO presence (user_id, last_seen, invisible) VALUES (?, ?, ?) " +
    "ON CONFLICT(user_id) DO UPDATE SET last_seen = excluded.last_seen, invisible = excluded.invisible",
  ).bind(session.user.id, nowSeconds(), invisible).run();
  return json({ ok: true, invisible: invisible === 1 });
}

// The desk's chat log (v3.1): the FULL stream, unfiltered — including
// messages by actively banned members, which the public read hides. Staff
// review everything and can delete in place (the same DELETE route). Chat is
// ephemeral: deletion is permanent, with no archive copy (unlike posts —
// posts are the record, chat is the hallway).
async function handleAdminChatRoute(request, env, url, path, method) {
  if (path !== "/api/admin/chat" || method !== "GET") return null;
  const session = await requiremod(request, env, false);
  await assertNotBanned(env, session.user.id);
  const beforeRaw = url.searchParams.get("before");
  let before = null;
  if (beforeRaw !== null && beforeRaw !== "") {
    if (!/^[0-9]{1,15}$/.test(beforeRaw)) throw new HttpError(400, "That page cursor is invalid.");
    before = Number(beforeRaw);
  }
  const rows = before === null
    ? (await env.FORUM_DB.prepare(
      CHAT_ADMIN_SELECT + "ORDER BY c.id DESC LIMIT " + (ADMIN_CHAT_PAGE_LIMIT + 1),
    ).all()).results || []
    : (await env.FORUM_DB.prepare(
      CHAT_ADMIN_SELECT + "WHERE c.id < ? ORDER BY c.id DESC LIMIT " + (ADMIN_CHAT_PAGE_LIMIT + 1),
    ).bind(before).all()).results || [];
  const hasMore = rows.length > ADMIN_CHAT_PAGE_LIMIT;
  const page = rows.slice(0, ADMIN_CHAT_PAGE_LIMIT);
  return json({
    messages: page.map((row) => ({
      ...publicChatMessage(row),
      authorBanned: Number(row.author_banned) === 1,
    })),
    nextBefore: hasMore && page.length ? Number(page[page.length - 1].id) : null,
  });
}

export async function handleChatRoutes(request, env, url, path, method, ctx) {
  const presence = await handlePresenceRoute(request, env, url, path, method);
  if (presence) return presence;
  const read = await handleChatReadRoute(request, env, url, path, method);
  if (read) return read;
  const create = await handleChatCreateRoute(request, env, url, path, method, ctx);
  if (create) return create;
  const remove = await handleChatDeleteRoute(request, env, url, path, method);
  if (remove) return remove;
  const log = await handleAdminChatRoute(request, env, url, path, method);
  if (log) return log;
  return null;
}
