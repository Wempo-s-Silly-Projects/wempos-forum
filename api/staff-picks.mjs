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

// Staff pick of the week (v5.35.0, migration 0065). Staff only:
//   POST   /api/admin/threads/:id/staff-pick — make a public Showcase root the
//          pick (newest pick wins; the current pick again is a 409);
//   DELETE /api/admin/threads/:id/staff-pick — remove every pick of that post
//          (an older remaining pick, if any, becomes current again);
//   GET    /api/admin/staff-picks             — the mod log, newest first.
// Writes: requireStaff (mutating → requireUser → same-origin + X-CSRF-Token,
// so anonymous is 401 and members 403), assertNotBanned, the write limiter,
// and one staff_pick_log row per change. Showing the pick (api/traditions.mjs
// currentStaffPick) re-checks visibility on every read.
import { assertNotBanned, requireStaff } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit } from "./core/http.mjs";
import { ACTIVE_BAN_SQL } from "./core/visibility.mjs";
import { SHOWCASE_BOARD } from "./traditions.mjs";

export const STAFF_PICK_LOG_LIMIT = 50;
const PICK_ROUTE = /^\/api\/admin\/threads\/([0-9]{1,15})\/staff-pick$/;
const LOG_ROUTE = "/api/admin/staff-picks";

const iso = (seconds) => new Date(Number(seconds) * 1000).toISOString();

async function pickableRow(db, postId) {
  const row = await db.prepare(
    "SELECT p.id, p.parent_id, p.board, p.visibility, " + ACTIVE_BAN_SQL("p.author_id") + " AS author_banned " +
    "FROM posts p WHERE p.id = ? LIMIT 1",
  ).bind(postId).first();
  if (!row) throw new HttpError(404, "Thread not found.");
  const isRoot = row.parent_id === null || row.parent_id === undefined;
  if (!isRoot || row.board !== SHOWCASE_BOARD || row.visibility !== "public" || Number(row.author_banned) === 1) {
    throw new HttpError(400, "Only a public Showcase thread can be the staff pick.");
  }
  return row;
}

const logStatement = (db, postId, actorId, action, at) =>
  db.prepare("INSERT INTO staff_pick_log (post_id, actor_id, action, created_at) VALUES (?, ?, ?, ?)")
    .bind(postId, actorId, action, at);

async function pickPost(db, postId, actorId) {
  await pickableRow(db, postId);
  const current = await db.prepare(
    "SELECT post_id FROM featured_posts ORDER BY picked_at DESC, id DESC LIMIT 1",
  ).first();
  if (current && Number(current.post_id) === postId) throw new HttpError(409, "This thread is already the staff pick.");
  const at = nowSeconds();
  await db.batch([
    db.prepare("INSERT INTO featured_posts (post_id, picked_by, picked_at) VALUES (?, ?, ?)").bind(postId, actorId, at),
    logStatement(db, postId, actorId, "pick", at),
  ]);
  return json({ ok: true, staffPick: true });
}

async function unpickPost(db, postId, actorId) {
  const removed = await db.prepare("DELETE FROM featured_posts WHERE post_id = ?").bind(postId).run();
  if (Number(removed.meta?.changes) < 1) throw new HttpError(409, "This thread is not a staff pick.");
  await logStatement(db, postId, actorId, "unpick", nowSeconds()).run();
  return json({ ok: true, staffPick: false });
}

async function handlePickRoute(request, env, path, method) {
  const match = path.match(PICK_ROUTE);
  if (!match) return null;
  if (method !== "POST" && method !== "DELETE") throw new HttpError(405, "That method is not supported.");
  const session = await requireStaff(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write");
  const postId = Number(match[1]);
  const actorId = Number(session.user.id);
  return method === "POST" ? pickPost(env.FORUM_DB, postId, actorId) : unpickPost(env.FORUM_DB, postId, actorId);
}

async function handleLogRoute(request, env, path, method) {
  if (path !== LOG_ROUTE) return null;
  if (method !== "GET") throw new HttpError(405, "That method is not supported.");
  await requireStaff(request, env, false);
  const rows = (await env.FORUM_DB.prepare(
    "SELECT l.id, l.post_id, l.action, l.created_at, u.username FROM staff_pick_log l " +
    "LEFT JOIN users u ON u.id = l.actor_id ORDER BY l.id DESC LIMIT " + STAFF_PICK_LOG_LIMIT,
  ).all()).results || [];
  return json({
    log: rows.map((row) => ({
      id: Number(row.id),
      action: row.action,
      postId: Number(row.post_id),
      actor: row.username ?? null,
      createdAt: iso(row.created_at),
    })),
  });
}

export async function handleStaffPickRoutes(request, env, url, path, method) {
  return (await handlePickRoute(request, env, path, method)) ?? handleLogRoute(request, env, path, method);
}
