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

// Staff thread lock (v5.51.0, migration 0075). Staff only:
//   PUT    /api/admin/threads/:id/lock  — lock a ROOT thread ({ reason? } ≤ 200 chars);
//   DELETE /api/admin/threads/:id/lock  — unlock it (409 when it is not locked);
//   GET    /api/admin/threads/:id/lock  — the desk read: reason, locker, time.
// Writes: requireStaff (mutating → same-origin + X-CSRF-Token, so anonymous
// is 401 and members 403), assertNotBanned and the write limiter. The reason
// and the locker never leave the GET above: POST_SELECT carries only the
// bind-free EXISTS flag `locked`. assertThreadUnlocked is the reply-time
// check shared by the web reply route and the MCP reply tool: one primary-key
// lookup on the conversation root, staff exempt (no query at all), refusing
// with 423 Locked — distinct from the 403 a member gets on a staff route, so
// the client and agents can tell "locked" from "not allowed". No mod-log
// helper exists (staff_pick_log is pick-specific), so the row's locked_by and
// locked_at are the record.
import { assertNotBanned, requireStaff } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { isRefusedChar } from "./thread-summaries.mjs";
import { THREAD_LOCK_REASON_MAX_CHARS } from "../constants.mjs";

export const THREAD_LOCK_REASON_MAX = THREAD_LOCK_REASON_MAX_CHARS;
export const THREAD_LOCK_STATUS = 423;
export const THREAD_LOCK_REFUSAL = "This thread is locked. Only staff can reply.";
export const THREAD_LOCK_CHECK_SQL = "SELECT 1 AS locked FROM thread_locks WHERE post_id = ? LIMIT 1";

const LOCK_ROUTE = /^\/api\/admin\/threads\/([0-9]{1,15})\/lock$/;
const LOCK_UPSERT_SQL =
  "INSERT INTO thread_locks (post_id, locked_by, reason, locked_at) VALUES (?, ?, ?, ?) " +
  "ON CONFLICT(post_id) DO UPDATE SET locked_by = excluded.locked_by, reason = excluded.reason, locked_at = excluded.locked_at";
const LOCK_READ_SQL =
  "SELECT l.reason, l.locked_at, l.locked_by, u.username FROM thread_locks l " +
  "LEFT JOIN users u ON u.id = l.locked_by WHERE l.post_id = ? LIMIT 1";

const isStaffRole = (user) => user?.role === "owner" || user?.role === "admin";

// Staff are exempt (no query). Members get 423 before anything is written.
export async function assertThreadUnlocked(db, user, rootId) {
  if (isStaffRole(user)) return;
  const hit = await db.prepare(THREAD_LOCK_CHECK_SQL).bind(Number(rootId)).first();
  if (hit) throw new HttpError(THREAD_LOCK_STATUS, THREAD_LOCK_REFUSAL);
}

// Optional: absent, null or blank → null. Otherwise one trimmed line of plain
// text, ≤ 200 code points (the CHECK counts the same), with no C0/C1, line
// separator or bidi embedding/override/isolate controls (v5.50's rule).
export function lockReason(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, "A lock reason must be text.");
  const reason = value.trim();
  if (!reason) return null;
  const chars = [...reason];
  if (chars.length > THREAD_LOCK_REASON_MAX) {
    throw new HttpError(400, "A lock reason can be up to " + THREAD_LOCK_REASON_MAX + " characters.");
  }
  if (chars.some((ch) => isRefusedChar(ch.codePointAt(0)))) {
    throw new HttpError(400, "A lock reason is one line of plain text.");
  }
  return reason;
}

async function rootThread(db, postId) {
  const thread = await db.prepare("SELECT id, parent_id FROM posts WHERE id = ? LIMIT 1").bind(postId).first();
  if (!thread) throw new HttpError(404, "Thread not found.");
  if (thread.parent_id !== null && thread.parent_id !== undefined) {
    throw new HttpError(400, "Only thread roots can be locked.");
  }
  return thread;
}

async function lockThread(request, env, postId, session) {
  const body = await readJson(request);
  const reason = lockReason(body.reason);
  const db = env.FORUM_DB;
  await rootThread(db, postId);
  await db.prepare(LOCK_UPSERT_SQL).bind(postId, Number(session.user.id), reason, nowSeconds()).run();
  return json({ ok: true, locked: true });
}

async function unlockThread(env, postId) {
  const removed = await env.FORUM_DB.prepare("DELETE FROM thread_locks WHERE post_id = ?").bind(postId).run();
  if (Number(removed.meta?.changes) < 1) throw new HttpError(409, "This thread is not locked.");
  return json({ ok: true, locked: false });
}

async function readLock(env, postId) {
  const db = env.FORUM_DB;
  await rootThread(db, postId);
  const row = await db.prepare(LOCK_READ_SQL).bind(postId).first();
  if (!row) return json({ locked: false, reason: null, lockedBy: null, lockedAt: null });
  return json({
    locked: true,
    reason: row.reason ?? null,
    lockedBy: { id: Number(row.locked_by), username: row.username ?? null },
    lockedAt: new Date(Number(row.locked_at) * 1000).toISOString(),
  });
}

export async function handleThreadLockRoutes(request, env, url, path, method) {
  const match = path.match(LOCK_ROUTE);
  if (!match) return null;
  const postId = Number(match[1]);
  if (method === "GET") {
    await requireStaff(request, env, false);
    return readLock(env, postId);
  }
  if (method !== "PUT" && method !== "DELETE") throw new HttpError(405, "That method is not supported.");
  const session = await requireStaff(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write", String(session.user.id));
  return method === "PUT" ? lockThread(request, env, postId, session) : unlockThread(env, postId);
}
