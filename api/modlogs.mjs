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

// The desk's chat + DM logs (v3.1), lifted verbatim out of api/chat.mjs and
// api/dms.mjs when the site's standalone chat page and DM panel retired (the
// site routes went out; the tables and their moderation stay).
// Everything here is staff-only: the two full logs (unfiltered — messages by
// actively banned members stay visible for review) and the two delete routes
// the logs' in-place cleanup buttons ride. Chat and DMs remain ephemeral:
// no archive copy, deletion permanent.
import { assertNotBanned, requireStaff, requireUser } from "./core/auth.mjs";
import { HttpError, json, rateLimit } from "./core/http.mjs";
import { publicRole } from "./core/roles.mjs";

const ADMIN_CHAT_PAGE_LIMIT = 100;
const ADMIN_DM_PAGE_LIMIT = 100;

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

// The desk's chat log (v3.1): the FULL stream, unfiltered — including
// messages by actively banned members, which the public read hid. Staff
// review everything and can delete in place (the same DELETE route).
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

export async function handleModLogRoutes(request, env, url, path, method) {
  const remove = await handleChatDeleteRoute(request, env, url, path, method);
  if (remove) return remove;
  const dmRemove = await handleDmMessageDeleteRoute(request, env, url, path, method);
  if (dmRemove) return dmRemove;
  const log = await handleAdminChatRoute(request, env, url, path, method);
  if (log) return log;
  const dmLog = await handleAdminDmLogRoute(request, env, url, path, method);
  if (dmLog) return dmLog;
  return null;
}
