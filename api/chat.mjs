// Live chat + online presence (v3.1, Desen's ask): polling-based — one D1
// heartbeat for presence and one flat message stream for chat, no Durable
// Objects. The client polls GET /api/chat?after=<id> for both (messages and
// the online count ride the same response) and POSTs /api/presence as its
// heartbeat. Chat bodies run through the word filter like every other stored
// member-written text; messages by actively banned members vanish at read
// time (the same semantics as posts, banFilterSql's shape scoped to
// chat_messages.user_id); staff can delete any message.
import { assertNotBanned, readSession, requireUser, requireStaff } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { publicRole } from "./core/roles.mjs";
import { mentionFanOutStatements } from "./mentions.mjs";
import { applyWordFilter } from "./filter.mjs";
import { filterWords } from "./filterstore.mjs";

// A member counts as online for 3 minutes after their last heartbeat; the
// client pings every 60s.
const PRESENCE_WINDOW_SECONDS = 180;
const CHAT_PAGE_LIMIT = 50;
const CHAT_MAX_CHARS = 500;
const ADMIN_CHAT_PAGE_LIMIT = 100;
// The who's-online roster (v4.4) names at most this many members per poll.
const ONLINE_ROSTER_LIMIT = 60;

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
    "SELECT COUNT(*) AS online FROM presence WHERE invisible = 0 AND last_seen > ? " +
    "AND NOT EXISTS (SELECT 1 FROM bans b WHERE b.user_id = presence.user_id AND b.revoked_at IS NULL " +
    "AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER)))",
  ).bind(nowSeconds() - PRESENCE_WINDOW_SECONDS).first();
  // Who's online (v4.4, owner's ask): the same window, naming the visible
  // (non-lurking) members so the chat page can list them. Actively-banned
  // members drop out at read (heartbeats already stopped at the ban, so this
  // only tightens the lapse window). Invisible members stay off the list,
  // exactly matching the public counter.
  const onlineMemberRows = (await db.prepare(
    "SELECT p.user_id AS id, u.username, u.role " +
    "FROM presence p JOIN users u ON u.id = p.user_id " +
    "WHERE p.invisible = 0 AND p.last_seen > ? " +
    "AND NOT EXISTS (SELECT 1 FROM bans b WHERE b.user_id = u.id AND b.revoked_at IS NULL " +
    "AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER))) " +
    "ORDER BY u.username LIMIT " + ONLINE_ROSTER_LIMIT,
  ).bind(nowSeconds() - PRESENCE_WINDOW_SECONDS).all()).results || [];
  // Signed-in extras (v4.2): the DM unread total and the bell's unread count
  // ride the SAME response, so the global 15s chat poll keeps both badges
  // fresh with no extra requests. Guests get zeros.
  const session = await readSession(request, env).catch(() => null);
  let dmUnread = 0;
  let bellUnread = 0;
  if (session && session.user) {
    const dmRow = await db.prepare(
      "SELECT COALESCE(SUM(CASE WHEN user_a = ? THEN unread_a ELSE unread_b END), 0) AS unread " +
      "FROM dm_threads WHERE (user_a = ? OR user_b = ?) " +
      // Blocks (v4.4): pair-closed threads vanish from the list and 403 on
      // open — their unread must not ride the badge either (it could never
      // clear, the thread's read flush is refused).
      "AND NOT EXISTS (SELECT 1 FROM blocks bk WHERE (bk.blocker_id = ? AND " +
      "bk.blocked_id IN (user_a, user_b)) OR (bk.blocked_id = ? AND " +
      "bk.blocker_id IN (user_a, user_b)))",
    ).bind(session.user.id, session.user.id, session.user.id,
      session.user.id, session.user.id).first();
    dmUnread = Number(dmRow?.unread || 0);
    const bellRow = await db.prepare(
      "SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL",
    ).bind(session.user.id).first();
    bellUnread = Number(bellRow?.unread || 0);
  }
  return json({
    messages: messages.map(publicChatMessage),
    // lastId drives the next poll's cursor; 0 when the stream is empty.
    lastId: messages.length ? Number(messages[messages.length - 1].id) : (after || 0),
    online: Number(onlineRow?.online || 0),
    // Who's online (v4.4): the roster the count describes — same window,
    // same invisible-mode rules. The count can exceed the list's length
    // (roster caps at 60; the count itself is uncapped).
    onlineMembers: onlineMemberRows.map((row) => ({
      id: Number(row.id),
      username: row.username,
      // Mapped public role ('owner'/'admin'); members keep "member" — roles
      // are public here, matching every chat row's author object.
      role: row.role ? publicRole(row.role) : null,
    })),
    dmUnread,
    bellUnread,
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
    filterWords(env),
  );
  if (!message) throw new HttpError(400, "Write a message first.");
  const result = await env.FORUM_DB.prepare(
    "INSERT INTO chat_messages (user_id, body, created_at) VALUES (?, ?, ?)",
  ).bind(session.user.id, message, nowSeconds()).run();
  const row = await env.FORUM_DB.prepare(
    CHAT_SELECT + "WHERE c.id = ? LIMIT 1",
  ).bind(Number(result.meta?.last_row_id)).first();
  // @mention pings (v4.2): chat bodies notify through the same fan-out as
  // posts — label-only rows (no post to click through). Never fails the send.
  try {
    const mentionStatements = await mentionFanOutStatements(env.FORUM_DB, message, {
      actorId: session.user.id, now: nowSeconds(),
      actorUsername: session.user.username,
      label: "You were mentioned by " + session.user.username + " in chat",
    });
    if (mentionStatements.length > 0) await env.FORUM_DB.batch(mentionStatements);
  } catch {
    // Mentions are a convenience, not a chat precondition.
  }
  return json({ message: publicChatMessage(row) }, 201);
}

// Staff cleanup: any chat message, any author. The deletion is immediate and
// permanent (chat is ephemeral by nature — no archive copy, unlike posts).
async function handleChatDeleteRoute(request, env, url, path, method) {
  const match = path.match(/^\/api\/chat\/([0-9]{1,15})$/);
  if (!match) return null;
  if (method !== "DELETE") throw new HttpError(405, "That method is not supported.");
  const session = await requireStaff(request, env);
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
  const session = await requireStaff(request, env, false);
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
