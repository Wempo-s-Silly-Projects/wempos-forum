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

// Chat widget API (chat-widget-backend lane): the 1:1 DM surface on the
// existing dm_threads/dm_messages tables (migration 0032 + the 0038 unread
// counters) and the presence heartbeat/roster on the same migration's
// v3.1 presence table — ZERO new migrations. Presence is "online or not": a 300s window
// over last_seen, invisible members heartbeating but never listed, and no
// last_seen timestamp ever leaving the roster. DMs follow the wall's rules:
// word-filtered at intake, ban-hidden at read time, block-pair gated both
// directions, and the unread counters are the canonical thread row's own —
// a send bumps the OTHER side, a read zeroes the viewer's own.
import { assertNotBanned, readSession, requireSignedInRead, requireUser } from "./core/auth.mjs";
import { blockPairExists } from "./core/blocks.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { publicRole } from "./core/roles.mjs";
import { applyWordFilter } from "./filter.mjs";
import { filterWords } from "./filterstore.mjs";

const DM_MAX_BODY_CHARS = 1000;
const DM_MESSAGE_PAGE_LIMIT = 50;
const DM_PREVIEW_MAX_CHARS = 80;
const PRESENCE_WINDOW = 300;

// INSERT OR IGNORE rides the UNIQUE(user_a, user_b) pair: the open-or-return
// replay inserts ZERO rows and the by-pair lookup re-serves the same thread.
const DM_THREAD_OPEN_SQL =
  "INSERT OR IGNORE INTO dm_threads (user_a, user_b, created_at) VALUES (?, ?, ?)";
const DM_THREAD_FIND_SQL =
  "SELECT id, user_a, user_b FROM dm_threads WHERE user_a = ? AND user_b = ? ORDER BY id LIMIT 1";

// Read-time active-ban filter for dm rows: the wall's predicate, keyed on the
// message AUTHOR (m.user_id) — read-time only, so an unban restores the
// message without any write.
const DM_BAN_FILTER_SQL =
  "NOT EXISTS (SELECT 1 FROM bans b WHERE b.user_id = m.user_id " +
  "AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > " +
  "CAST(strftime('%s','now') AS INTEGER)))";

const DM_MESSAGES_SELECT_SQL =
  "SELECT m.id, m.body, m.user_id, m.created_at, u.username AS author_username " +
  "FROM dm_messages m JOIN users u ON u.id = m.user_id " +
  "WHERE m.thread_id = ? AND " + DM_BAN_FILTER_SQL;
const DM_OLDER_PAGES_SQL = " AND m.id < ? ";
const DM_MESSAGES_TAIL_SQL =
  " ORDER BY m.id DESC LIMIT " + DM_MESSAGE_PAGE_LIMIT;

// The heartbeat: last_seen moves every ping; the invisible flag follows the
// body only when the body carries one — the flag arm writes the body's value,
// the flag-less arm moves only last_seen and leaves the stored setting alone
// (a fresh member's insert lands on the column's 0 default).
const PRESENCE_UPSERT_SQL =
  "INSERT INTO presence (user_id, last_seen, invisible) VALUES (?, ?, ?) " +
  "ON CONFLICT(user_id) DO UPDATE SET last_seen = excluded.last_seen, " +
  "invisible = excluded.invisible";
const PRESENCE_KEEP_SQL =
  "INSERT INTO presence (user_id, last_seen, invisible) VALUES (?, ?, 0) " +
  "ON CONFLICT(user_id) DO UPDATE SET last_seen = excluded.last_seen";
const PRESENCE_SELECT_SQL =
  "SELECT u.id, u.username, u.role FROM presence p JOIN users u ON u.id = p.user_id " +
  "WHERE p.invisible = 0 AND p.last_seen >= ? ORDER BY u.id";

function isoTime(seconds) {
  return new Date(Number(seconds) * 1000).toISOString();
}

function threadParticipant(row, viewerId) {
  return Number(row.user_a) === Number(viewerId) || Number(row.user_b) === Number(viewerId);
}

function otherMember(row, viewerId) {
  return Number(row.user_a) === Number(viewerId)
    ? { id: Number(row.user_b), username: row.b_username, role: publicRole(row.b_role) }
    : { id: Number(row.user_a), username: row.a_username, role: publicRole(row.a_role) };
}

function viewerUnread(row, viewerId) {
  return Number(row.user_a) === Number(viewerId) ? Number(row.unread_a) : Number(row.unread_b);
}

function dmMessageShape(row, viewerId) {
  return {
    id: Number(row.id),
    body: row.body,
    authorId: Number(row.user_id),
    authorUsername: row.author_username,
    mine: Number(row.user_id) === Number(viewerId),
    createdAt: isoTime(row.created_at),
  };
}

// POST /api/presence — the heartbeat. Signed-in only: a guest has no
// presence to keep alive.
async function handlePresenceWriteRoute(request, env, url, path, method) {
  if (path !== "/api/presence" || method !== "POST") return null;
  const session = await requireUser(request, env);
  await rateLimit(request, env, "write");
  const body = await readJson(request);
  let invisible = null;
  if (body.invisible !== undefined) {
    invisible = body.invisible === true || body.invisible === 1 ? 1 :
      body.invisible === false || body.invisible === 0 ? 0 : null;
    if (invisible === null) throw new HttpError(400, "That presence flag is not valid.");
  }
  if (invisible !== null) {
    await env.FORUM_DB.prepare(PRESENCE_UPSERT_SQL)
      .bind(session.user.id, nowSeconds(), invisible).run();
    return json({ ok: true, invisible });
  }
  await env.FORUM_DB.prepare(PRESENCE_KEEP_SQL)
    .bind(session.user.id, nowSeconds()).run();
  const row = await env.FORUM_DB.prepare(
    "SELECT invisible FROM presence WHERE user_id = ? LIMIT 1",
  ).bind(session.user.id).first();
  return json({ ok: true, invisible: Number(row.invisible) });
}

// GET /api/presence — the roster. Guests read; the window and the invisible
// flag live entirely in the statement, and the payload carries roles but
// never a last_seen timestamp.
async function handlePresenceReadRoute(request, env, url, path, method) {
  if (path !== "/api/presence" || method !== "GET") return null;
  await readSession(request, env);
  const now = nowSeconds();
  const rows = (await env.FORUM_DB.prepare(PRESENCE_SELECT_SQL)
    .bind(now - PRESENCE_WINDOW).all()).results || [];
  return json({
    now,
    online: rows.map((row) => ({
      id: Number(row.id), username: row.username, role: publicRole(row.role),
    })),
  });
}

// GET /api/dm/threads — the signed-in member's thread list, newest activity
// first (a thread with no messages sorts last). The preview reads the newest
// dm_messages row verbatim — stored bodies, no read-time filtering.
async function handleThreadListRoute(request, env, url, path, method) {
  if (path !== "/api/dm/threads" || method !== "GET") return null;
  const session = await requireSignedInRead(request, env);
  const viewerId = session.user.id;
  const rows = (await env.FORUM_DB.prepare(
    "SELECT t.id, t.user_a, t.user_b, t.unread_a, t.unread_b, " +
    "u.username AS other_username, u.role AS other_role, " +
    "(SELECT m.body FROM dm_messages m WHERE m.thread_id = t.id " +
    "ORDER BY m.id DESC LIMIT 1) AS last_body, " +
    "(SELECT m.created_at FROM dm_messages m WHERE m.thread_id = t.id " +
    "ORDER BY m.id DESC LIMIT 1) AS last_at " +
    "FROM dm_threads t JOIN users u ON u.id = " +
    "(CASE WHEN t.user_a = ? THEN t.user_b ELSE t.user_a END) " +
    "WHERE t.user_a = ? OR t.user_b = ? " +
    "ORDER BY (SELECT m.id FROM dm_messages m WHERE m.thread_id = t.id " +
    "ORDER BY m.id DESC LIMIT 1) DESC",
  ).bind(viewerId, viewerId, viewerId).all()).results || [];
  return json({
    threads: rows.map((row) => {
      const preview = String(row.last_body ?? "").trim();
      const viewerIsUserA = Number(row.user_a) === Number(viewerId);
      return {
        id: Number(row.id),
        other: viewerIsUserA
          ? { id: Number(row.user_b), username: row.other_username, role: publicRole(row.other_role) }
          : { id: Number(row.user_a), username: row.other_username, role: publicRole(row.other_role) },
        unread: viewerUnread(row, viewerId),
        lastMessageAt: row.last_at ? isoTime(row.last_at) : null,
        lastMessagePreview: preview.length > DM_PREVIEW_MAX_CHARS
          ? preview.slice(0, DM_PREVIEW_MAX_CHARS) : preview,
      };
    }),
  });
}

// GET /api/dm/threads/:id — one thread with its newest 50 messages (newest
// first); ?after=<id> walks OLDER pages for scrollback. Messages by an
// actively-banned author vanish at read time.
async function handleThreadReadRoute(request, env, url, path, method) {
  const match = path.match(/^\/api\/dm\/threads\/([0-9]{1,15})$/);
  if (!match || method !== "GET") return null;
  const session = await requireSignedInRead(request, env);
  const viewerId = session.user.id;
  const threadId = Number(match[1]);
  const row = await loadThreadRow(env, threadId);
  if (!threadParticipant(row, viewerId)) {
    throw new HttpError(403, "That conversation is not available.");
  }
  const after = Number(url.searchParams.get("after") || 0);
  const older = Number.isInteger(after) && after > 0;
  const statement = DM_MESSAGES_SELECT_SQL + (older ? DM_OLDER_PAGES_SQL : "") +
    DM_MESSAGES_TAIL_SQL;
  const bound = older
    ? env.FORUM_DB.prepare(statement).bind(threadId, after)
    : env.FORUM_DB.prepare(statement).bind(threadId);
  const rows = (await bound.all()).results || [];
  return json({
    id: Number(row.id),
    other: otherMember(row, viewerId),
    unread: viewerUnread(row, viewerId),
    messages: rows.map((message) => dmMessageShape(message, viewerId)),
  });
}

function loadThreadRow(env, threadId) {
  return env.FORUM_DB.prepare(
    "SELECT t.id, t.user_a, t.user_b, t.unread_a, t.unread_b, " +
    "ua.username AS a_username, ua.role AS a_role, " +
    "ub.username AS b_username, ub.role AS b_role " +
    "FROM dm_threads t JOIN users ua ON ua.id = t.user_a " +
    "JOIN users ub ON ub.id = t.user_b WHERE t.id = ? LIMIT 1",
  ).bind(threadId).first().then((row) => {
    if (!row) throw new HttpError(404, "That conversation does not exist.");
    return row;
  });
}

// POST /api/dm/threads/:id — the send. Gates mirror the wall's intake order:
// auth, ban, rate, existence, participant, block pair, word filter, then the
// insert and exactly one unread bump on the opposite side.
async function handleThreadSendRoute(request, env, url, path, method) {
  const match = path.match(/^\/api\/dm\/threads\/([0-9]{1,15})$/);
  if (!match || method !== "POST") return null;
  const session = await requireUser(request, env);
  const viewerId = session.user.id;
  const threadId = Number(match[1]);
  const row = await loadThreadRow(env, threadId);
  if (!threadParticipant(row, viewerId)) {
    throw new HttpError(403, "That conversation is not available.");
  }
  await assertNotBanned(env, viewerId);
  await rateLimit(request, env, "write");
  if (await blockPairExists(env, viewerId,
    Number(row.user_a) === Number(viewerId) ? Number(row.user_b) : Number(row.user_a))) {
    throw new HttpError(403, "That conversation is not available.");
  }
  const body = await readJson(request);
  const message = applyWordFilter(
    String(body.body ?? "").trim().slice(0, DM_MAX_BODY_CHARS),
    filterWords(env),
  );
  if (!message) throw new HttpError(400, "Write something first.");
  const result = await env.FORUM_DB.prepare(
    "INSERT INTO dm_messages (thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?)",
  ).bind(threadId, viewerId, message, nowSeconds()).run();
  const bumpColumn = Number(row.user_a) === Number(viewerId) ? "unread_b" : "unread_a";
  await env.FORUM_DB.prepare(
    "UPDATE dm_threads SET " + bumpColumn + " = " + bumpColumn +
    " + 1 WHERE id = ?",
  ).bind(threadId).run();
  return json({
    message: {
      id: Number(result.meta?.last_row_id),
      body: message,
      authorId: viewerId,
      authorUsername: session.user.username,
      mine: true,
      createdAt: isoTime(nowSeconds()),
    },
  }, 201);
}

// POST /api/dm/threads/:id/read — zero the viewer's own counter; the WHERE
// keeps the update a no-op for the other side's counter by construction.
async function handleThreadReadMarkRoute(request, env, url, path, method) {
  const match = path.match(/^\/api\/dm\/threads\/([0-9]{1,15})\/read$/);
  if (!match || method !== "POST") return null;
  const session = await requireUser(request, env);
  const viewerId = session.user.id;
  const threadId = Number(match[1]);
  const row = await loadThreadRow(env, threadId);
  if (!threadParticipant(row, viewerId)) {
    throw new HttpError(403, "That conversation is not available.");
  }
  const column = Number(row.user_a) === Number(viewerId) ? "unread_a" : "unread_b";
  await env.FORUM_DB.prepare(
    "UPDATE dm_threads SET " + column + " = 0 WHERE id = ?",
  ).bind(threadId).run();
  return json({ ok: true });
}

// POST /api/dm/threads — open-or-return on the canonical (MIN(id), MAX(id))
// pair. INSERT OR IGNORE against the UNIQUE pair, then the by-pair lookup
// answers either arm.
async function handleThreadOpenRoute(request, env, url, path, method) {
  if (path !== "/api/dm/threads" || method !== "POST") return null;
  const session = await requireUser(request, env);
  const viewerId = session.user.id;
  await rateLimit(request, env, "write");
  const body = await readJson(request);
  // Accept EITHER {userId} OR {username}: the username resolves through the
  // users table's normalized key (trim + lowercase, the session.mjs idiom),
  // never raw text.
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  let target;
  if (username) {
    target = await env.FORUM_DB.prepare(
      "SELECT id, username, role FROM users WHERE username_key = ? LIMIT 1",
    ).bind(username).first();
    if (!target) throw new HttpError(400, "That member does not exist.");
  } else {
    target = null;
  }
  const targetId = target ? Number(target.id) : Number(body.userId);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw new HttpError(400, "That member does not exist.");
  }
  if (targetId === viewerId) {
    throw new HttpError(400, "You cannot message yourself.");
  }
  if (!target) {
    target = await env.FORUM_DB.prepare(
      "SELECT id, username, role FROM users WHERE id = ? LIMIT 1",
    ).bind(targetId).first();
    if (!target) throw new HttpError(400, "That member does not exist.");
  }
  if (await blockPairExists(env, viewerId, targetId)) {
    throw new HttpError(403, "That conversation is not available.");
  }
  const userA = Math.min(viewerId, targetId);
  const userB = Math.max(viewerId, targetId);
  await env.FORUM_DB.prepare(DM_THREAD_OPEN_SQL)
    .bind(userA, userB, nowSeconds()).run();
  const row = await env.FORUM_DB.prepare(DM_THREAD_FIND_SQL)
    .bind(userA, userB).first();
  return json({
    id: Number(row.id),
    other: { id: Number(target.id), username: target.username, role: publicRole(target.role) },
  });
}

export async function handleChatRoutes(request, env, url, path, method, ctx) {
  const handlers = [
    handlePresenceWriteRoute,
    handlePresenceReadRoute,
    handleThreadListRoute,
    handleThreadReadRoute,
    handleThreadSendRoute,
    handleThreadReadMarkRoute,
    handleThreadOpenRoute,
  ];
  for (const handler of handlers) {
    const response = await handler(request, env, url, path, method, ctx);
    if (response) return response;
  }
  return null;
}

export { DM_MAX_BODY_CHARS, PRESENCE_WINDOW, PRESENCE_UPSERT_SQL, PRESENCE_KEEP_SQL, DM_THREAD_OPEN_SQL, DM_THREAD_FIND_SQL };
