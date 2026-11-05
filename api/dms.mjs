// 1:1 DMs (v3.1): private threads between two members — built on the same
// rules as the public chat and posts: bodies run through the word filter,
// messages by actively banned members vanish at read time, authors can delete
// their own messages, and staff can delete anything. Per the owner's call
// ("same scrutiny as posts"), the desk also gets the full DM LOG — every
// message with both participants named — so DMs are reviewable, not a blind
// spot. No unread tracking in v1: the conversation list sorts by the latest
// message.
import { assertNotBanned, requireSignedInRead, requireUser, requireStaff } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { publicRole } from "./core/roles.mjs";
import { userByUsernameKey } from "./core/shapers.mjs";
import { applyWordFilter } from "./filter.mjs";
import { scheduleTextCheck } from "./textmod.mjs";

const DM_PAGE_LIMIT = 50;
const DM_MAX_CHARS = 1000;
const ADMIN_DM_PAGE_LIMIT = 100;

// Read-time active-ban filter for DM rows (chat_messages shape adapted to
// dm_messages.user_id).
const DM_BAN_FILTER_SQL =
  "NOT EXISTS (SELECT 1 FROM bans b WHERE b.user_id = m.user_id " +
  "AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > " +
  "CAST(strftime('%s','now') AS INTEGER)))";

const DM_MESSAGE_SELECT =
  "SELECT m.id, m.thread_id, m.user_id AS author_id, m.body, m.created_at, " +
  "u.username AS author_username, u.role AS author_role " +
  "FROM dm_messages m JOIN users u ON u.id = m.user_id ";

function publicDmMessage(row) {
  return {
    id: Number(row.id),
    threadId: Number(row.thread_id),
    body: row.body,
    createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
    author: {
      id: Number(row.author_id),
      username: row.author_username,
      role: row.author_role ? publicRole(row.author_role) : null,
    },
  };
}

// The other participant of a thread, from the viewer's perspective.
function otherParticipant(thread, viewerId) {
  const otherId = Number(thread.user_a) === Number(viewerId) ? thread.user_b : thread.user_a;
  const otherName = Number(thread.user_a) === Number(viewerId)
    ? thread.user_b_name : thread.user_a_name;
  return { id: Number(otherId), username: otherName };
}

async function dmThreadFor(env, threadId) {
  return env.FORUM_DB.prepare(
    "SELECT t.id, t.user_a, t.user_b, a.username AS user_a_name, b.username AS user_b_name " +
    "FROM dm_threads t JOIN users a ON a.id = t.user_a JOIN users b ON b.id = t.user_b " +
    "WHERE t.id = ? LIMIT 1",
  ).bind(threadId).first();
}

// The member's conversation list: every thread they participate in, sorted by
// the latest message (empty threads sort last), each with the other member
// and a last-message preview.
async function handleDmListRoute(request, env, url, path, method) {
  if (path !== "/api/dms" || method !== "GET") return null;
  // GETs carry no CSRF header (the frontend only attaches one to mutating
  // methods), so reads authenticate session-only.
  const session = await requireSignedInRead(request, env);
  const rows = (await env.FORUM_DB.prepare(
    "SELECT t.id, t.user_a, t.user_b, a.username AS user_a_name, b.username AS user_b_name, " +
    "(SELECT MAX(m2.id) FROM dm_messages m2 WHERE m2.thread_id = t.id) AS last_message_id, " +
    "(SELECT m2.body FROM dm_messages m2 WHERE m2.thread_id = t.id ORDER BY m2.id DESC LIMIT 1) AS last_body, " +
    "(SELECT m2.created_at FROM dm_messages m2 WHERE m2.thread_id = t.id ORDER BY m2.id DESC LIMIT 1) AS last_at " +
    "FROM dm_threads t JOIN users a ON a.id = t.user_a JOIN users b ON b.id = t.user_b " +
    "WHERE t.user_a = ? OR t.user_b = ? ORDER BY last_message_id DESC",
  ).bind(session.user.id, session.user.id).all()).results || [];
  return json({
    threads: rows.map((row) => ({
      id: Number(row.id),
      otherUser: otherParticipant(row, session.user.id),
      lastBody: row.last_body || null,
      lastAt: row.last_at === null || row.last_at === undefined
        ? null
        : new Date(Number(row.last_at) * 1000).toISOString(),
    })),
  });
}

// Find-or-create a thread with a named member. Canonical participant ordering
// (user_a < user_b) makes the UNIQUE pair the key, so both members always
// land in the same thread no matter who started it.
async function handleDmStartRoute(request, env, url, path, method) {
  if (path !== "/api/dms" || method !== "POST") return null;
  const session = await requireUser(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write");
  const body = await readJson(request);
  const target = await userByUsernameKey(env, String(body.username || "").toLowerCase());
  if (!target) throw new HttpError(404, "That member does not exist.");
  const targetId = Number(target.id);
  if (targetId === Number(session.user.id)) {
    throw new HttpError(400, "You cannot DM yourself.");
  }
  const pair = [
    Math.min(Number(session.user.id), targetId),
    Math.max(Number(session.user.id), targetId),
  ];
  await env.FORUM_DB.prepare(
    "INSERT INTO dm_threads (user_a, user_b, created_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(user_a, user_b) DO NOTHING",
  ).bind(pair[0], pair[1], nowSeconds()).run();
  const thread = await env.FORUM_DB.prepare(
    "SELECT id, user_a, user_b FROM dm_threads WHERE user_a = ? AND user_b = ? LIMIT 1",
  ).bind(pair[0], pair[1]).first();
  return json({ thread: { id: Number(thread.id), otherUser: { id: targetId, username: target.username } } }, 201);
}

// One thread's messages — participant-only, polled with the same after=<id>
// cursor shape as the public chat. The response carries the other member so
// the panel can render the conversation header.
async function handleDmThreadRoute(request, env, url, path, method, ctx) {
  const threadMatch = path.match(/^\/api\/dms\/([0-9]{1,15})$/);
  if (!threadMatch) return null;
  // GET reads session-only; POST is a mutation and keeps the CSRF gate.
  const session = method === "GET"
    ? await requireSignedInRead(request, env)
    : await requireUser(request, env);
  await assertNotBanned(env, session.user.id);
  const threadId = Number(threadMatch[1]);
  const thread = await dmThreadFor(env, threadId);
  if (!thread) throw new HttpError(404, "That conversation does not exist.");
  const isParticipant = Number(thread.user_a) === Number(session.user.id) ||
    Number(thread.user_b) === Number(session.user.id);
  if (!isParticipant) throw new HttpError(403, "That conversation is not yours to read.");

  if (method === "GET") {
    const afterRaw = url.searchParams.get("after");
    let after = null;
    if (afterRaw !== null && afterRaw !== "") {
      if (!/^[0-9]{1,15}$/.test(afterRaw)) throw new HttpError(400, "That chat cursor is invalid.");
      after = Number(afterRaw);
    }
    const rows = after === null
      ? (await env.FORUM_DB.prepare(
        DM_MESSAGE_SELECT + "WHERE m.thread_id = ? AND " + DM_BAN_FILTER_SQL +
        " ORDER BY m.id DESC LIMIT " + DM_PAGE_LIMIT,
      ).bind(threadId).all()).results || []
      : (await env.FORUM_DB.prepare(
        DM_MESSAGE_SELECT + "WHERE m.thread_id = ? AND m.id > ? AND " + DM_BAN_FILTER_SQL +
        " ORDER BY m.id ASC LIMIT " + DM_PAGE_LIMIT,
      ).bind(threadId, after).all()).results || [];
    const messages = after === null ? rows.reverse() : rows;
    return json({
      messages: messages.map(publicDmMessage),
      lastId: messages.length ? Number(messages[messages.length - 1].id) : (after || 0),
      otherUser: otherParticipant(thread, session.user.id),
    });
  }

  if (method === "POST") {
    await rateLimit(request, env, "write");
    const body = await readJson(request);
    const message = applyWordFilter(
      String(body.body ?? "").trim().slice(0, DM_MAX_CHARS),
      env.FILTERED_WORDS,
    );
    if (!message) throw new HttpError(400, "Write a message first.");
    const result = await env.FORUM_DB.prepare(
      "INSERT INTO dm_messages (thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?)",
    ).bind(threadId, session.user.id, message, nowSeconds()).run();
    const row = await env.FORUM_DB.prepare(
      DM_MESSAGE_SELECT + "WHERE m.id = ? LIMIT 1",
    ).bind(Number(result.meta?.last_row_id)).first();
    // Text auto-mod (v3.1): the message scores in the background; a trip
    // deletes it (DMs have no hidden state — same permanence as staff
    // deletion) and records an appealable action. The send never waits.
    scheduleTextCheck(ctx, env, {
      kind: "dm", entityId: Number(result.meta?.last_row_id),
      userId: session.user.id, text: message,
    });
    return json({ message: publicDmMessage(row) }, 201);
  }

  throw new HttpError(405, "That method is not supported.");
}

// DM message deletion: the author's own message, or any message for staff —
// the same author/staff split as post deletion. Permanent (DMs are not
// archived).
async function handleDmMessageDeleteRoute(request, env, url, path, method) {
  const match = path.match(/^\/api\/dm-messages\/([0-9]{1,15})$/);
  if (!match) return null;
  if (method !== "DELETE") throw new HttpError(405, "That method is not supported.");
  const session = await requireUser(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write");
  const messageId = Number(match[1]);
  const row = await env.FORUM_DB.prepare(
    "SELECT m.user_id FROM dm_messages m WHERE m.id = ? LIMIT 1",
  ).bind(messageId).first();
  if (!row) throw new HttpError(404, "Message not found.");
  const isAuthor = Number(row.user_id) === Number(session.user.id);
  const isStaff = session.user.role === "owner" || session.user.role === "admin";
  if (!isAuthor && !isStaff) throw new HttpError(403, "Only the author or admins can delete that message.");
  await env.FORUM_DB.prepare("DELETE FROM dm_messages WHERE id = ?").bind(messageId).run();
  return json({ ok: true });
}

// The desk's DM log (v3.1): the FULL stream, newest first — every message with
// both participants named and the author's active-ban state, unfiltered by
// the read-time ban filter. Same review-and-delete posture as the chat log.
async function handleAdminDmLogRoute(request, env, url, path, method) {
  if (path !== "/api/admin/dms" || method !== "GET") return null;
  await requireStaff(request, env, false);
  const beforeRaw = url.searchParams.get("before");
  let before = null;
  if (beforeRaw !== null && beforeRaw !== "") {
    if (!/^[0-9]{1,15}$/.test(beforeRaw)) throw new HttpError(400, "That page cursor is invalid.");
    before = Number(beforeRaw);
  }
  const adminSelect =
    "SELECT m.id, m.thread_id, m.user_id AS author_id, m.body, m.created_at, " +
    "u.username AS author_username, u.role AS author_role, " +
    "a.username AS user_a_name, b.username AS user_b_name, " +
    "EXISTS (SELECT 1 FROM bans ba WHERE ba.user_id = m.user_id AND ba.revoked_at IS NULL " +
    "AND (ba.expires_at IS NULL OR ba.expires_at > CAST(strftime('%s','now') AS INTEGER))) AS author_banned " +
    "FROM dm_messages m JOIN users u ON u.id = m.user_id " +
    "JOIN dm_threads t ON t.id = m.thread_id " +
    "JOIN users a ON a.id = t.user_a JOIN users b ON b.id = t.user_b ";
  const rows = before === null
    ? (await env.FORUM_DB.prepare(
      adminSelect + "ORDER BY m.id DESC LIMIT " + (ADMIN_DM_PAGE_LIMIT + 1),
    ).all()).results || []
    : (await env.FORUM_DB.prepare(
      adminSelect + "WHERE m.id < ? ORDER BY m.id DESC LIMIT " + (ADMIN_DM_PAGE_LIMIT + 1),
    ).bind(before).all()).results || [];
  const hasMore = rows.length > ADMIN_DM_PAGE_LIMIT;
  const page = rows.slice(0, ADMIN_DM_PAGE_LIMIT);
  return json({
    messages: page.map((row) => ({
      ...publicDmMessage(row),
      between: [row.user_a_name, row.user_b_name],
      authorBanned: Number(row.author_banned) === 1,
    })),
    nextBefore: hasMore && page.length ? Number(page[page.length - 1].id) : null,
  });
}

export async function handleDmRoutes(request, env, url, path, method, ctx) {
  const start = await handleDmStartRoute(request, env, url, path, method);
  if (start) return start;
  const list = await handleDmListRoute(request, env, url, path, method);
  if (list) return list;
  const thread = await handleDmThreadRoute(request, env, url, path, method, ctx);
  if (thread) return thread;
  const remove = await handleDmMessageDeleteRoute(request, env, url, path, method);
  if (remove) return remove;
  const log = await handleAdminDmLogRoute(request, env, url, path, method);
  if (log) return log;
  return null;
}
