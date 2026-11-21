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

// Moderator quality-of-life (wave 2026-11-21-9). Three staff-only routes:
//   GET  /api/admin/users/:id/recent-posts  — the "recent activity" peek on a
//        report card: the member's newest posts in every visibility (the same
//        mod-only posture as the hidden desk, which already shows bodies).
//   POST /api/admin/users/:id/hide-recent   — hide a spam run in one action:
//        the member's newest N PUBLIC posts go hidden and their open reports
//        close as actioned. Reversible through the restore route below.
//   POST /api/admin/posts/unhide            — restore moderator-hidden posts
//        (never an author's staged upload, which publishes on its own path).
// No audit table exists (0039 removed moderation_actions); reports'
// resolved_by is the record the existing desk keeps, and it is written here.
import { assertNotBanned, requireStaff } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { publicRole } from "./core/roles.mjs";

export const PEEK_LIMIT = 10;
export const HIDE_RECENT_MAX = 50;
export const RESTORE_MAX = 50;

const PEEK_ROUTE = /^\/api\/admin\/users\/([0-9]{1,15})\/recent-posts$/;
const HIDE_RECENT_ROUTE = /^\/api\/admin\/users\/([0-9]{1,15})\/hide-recent$/;
const RESTORE_ROUTE = "/api/admin/posts/unhide";

const ACTIVE_BAN_SQL =
  "EXISTS (SELECT 1 FROM bans b WHERE b.user_id = ? AND b.revoked_at IS NULL " +
  "AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER)))";

const isPositiveId = (value) => Number.isSafeInteger(value) && value >= 1;
const placeholders = (count) => new Array(count).fill("?").join(", ");

async function memberById(db, rawId) {
  const id = Number(rawId);
  if (!isPositiveId(id)) throw new HttpError(404, "Member not found.");
  const member = await db.prepare("SELECT id, username, role FROM users WHERE id = ? LIMIT 1").bind(id).first();
  if (!member) throw new HttpError(404, "Member not found.");
  return member;
}

function shapePeekPost(row) {
  const isReply = row.parent_id !== null && row.parent_id !== undefined;
  return {
    id: Number(row.id),
    body: row.body,
    hidden: row.visibility !== "public",
    board: row.board || "general",
    createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
    threadId: isReply ? Number(row.thread_root_id ?? row.parent_id) : Number(row.id),
  };
}

async function handlePeekRoute(request, env, path, method) {
  const match = path.match(PEEK_ROUTE);
  if (!match || method !== "GET") return null;
  await requireStaff(request, env, false);
  const db = env.FORUM_DB;
  const member = await memberById(db, match[1]);
  const [posts, summary] = await Promise.all([
    db.prepare(
      "SELECT p.id, p.body, p.visibility, p.board, p.created_at, p.parent_id, " +
        "(SELECT CASE WHEN parent.parent_id IS NOT NULL THEN parent.parent_id ELSE parent.id END " +
        "FROM posts parent WHERE parent.id = p.parent_id) AS thread_root_id " +
        "FROM posts p WHERE p.author_id = ? ORDER BY p.created_at DESC, p.id DESC LIMIT " + PEEK_LIMIT,
    ).bind(member.id).all(),
    db.prepare(
      "SELECT (SELECT COUNT(*) FROM posts WHERE author_id = ? AND visibility = 'public') AS public_count, " +
        ACTIVE_BAN_SQL + " AS active_ban",
    ).bind(member.id, member.id).first(),
  ]);
  return json({
    member: { id: Number(member.id), username: member.username, role: publicRole(member.role) },
    posts: (posts.results || []).map(shapePeekPost),
    publicCount: Number(summary?.public_count) || 0,
    activeBan: Number(summary?.active_ban) === 1,
  });
}

function readCount(body) {
  const count = body?.count;
  if (!Number.isInteger(count) || count < 1 || count > HIDE_RECENT_MAX) {
    throw new HttpError(400, `Choose between 1 and ${HIDE_RECENT_MAX} posts.`);
  }
  return count;
}

// The hide core (v5.18 extraction, SQL unchanged): hide the author's PUBLIC
// posts among ids and close their open reports as actioned. Shared by the
// hide-recent route and AutoMod (resolverId null); the Restore route below
// reverses either. Returns how many posts actually went hidden.
export async function hidePostsBatch(db, ids, authorId, resolverId) {
  const inList = placeholders(ids.length);
  // The visibility guard keeps a concurrent hide from being double-counted.
  const results = await db.batch([
    db.prepare(
      `UPDATE posts SET visibility = 'hidden' WHERE id IN (${inList}) AND author_id = ? AND visibility = 'public'`,
    ).bind(...ids, authorId),
    db.prepare(
      `UPDATE reports SET status = 'actioned', resolved_at = ?, resolved_by = ? WHERE post_id IN (${inList}) AND status = 'open'`,
    ).bind(nowSeconds(), resolverId, ...ids),
  ]);
  return Number(results[0]?.meta?.changes) || 0;
}

async function handleHideRecentRoute(request, env, path, method) {
  const match = path.match(HIDE_RECENT_ROUTE);
  if (!match || method !== "POST") return null;
  const session = await requireStaff(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write", String(session.user.id));
  const db = env.FORUM_DB;
  const target = await memberById(db, match[1]);
  // Same guard as bans: never the owner, never yourself.
  if (publicRole(target.role) === "owner" || Number(target.id) === Number(session.user.id)) {
    throw new HttpError(403, "That account's posts can't be hidden here.");
  }
  const count = readCount(await readJson(request));
  const picked = await db.prepare(
    "SELECT id FROM posts WHERE author_id = ? AND visibility = 'public' " +
      "ORDER BY created_at DESC, id DESC LIMIT ?",
  ).bind(target.id, count).all();
  const ids = (picked.results || []).map((row) => Number(row.id));
  if (!ids.length) throw new HttpError(409, "This member has no public posts left to hide.");
  const hidden = await hidePostsBatch(db, ids, target.id, session.user.id);
  if (!hidden) throw new HttpError(409, "Those posts were already hidden by another mod.");
  return json({ ok: true, hidden, postIds: ids });
}

function readIds(body) {
  const ids = body?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > RESTORE_MAX || !ids.every(isPositiveId)) {
    throw new HttpError(400, `Send between 1 and ${RESTORE_MAX} post ids.`);
  }
  return [...new Set(ids)];
}

async function handleRestoreRoute(request, env, path, method) {
  if (path !== RESTORE_ROUTE || method !== "POST") return null;
  const session = await requireStaff(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write", String(session.user.id));
  const ids = readIds(await readJson(request));
  const result = await env.FORUM_DB.prepare(
    `UPDATE posts SET visibility = 'public' WHERE id IN (${placeholders(ids.length)}) ` +
      "AND visibility = 'hidden' AND staged_at IS NULL",
  ).bind(...ids).run();
  const restored = Number(result.meta?.changes) || 0;
  if (!restored) throw new HttpError(409, "Nothing there is waiting to be restored.");
  return json({ ok: true, restored });
}

export async function handleModToolRoutes(request, env, url, path, method) {
  return (await handlePeekRoute(request, env, path, method))
    ?? (await handleHideRecentRoute(request, env, path, method))
    ?? (await handleRestoreRoute(request, env, path, method));
}
