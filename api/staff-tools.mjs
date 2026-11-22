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

// Staff tools (v5.43.0, migration 0069). Staff only:
//   GET    /api/admin/members/:id/notes          — notes about a member, newest first;
//   POST   /api/admin/members/:id/notes          — add one ({ body }, ≤ 500 chars);
//   DELETE /api/admin/members/:id/notes/:noteId  — remove one (any staff member);
//   POST   /api/admin/reports/:id/claim          — claim an open post report (atomic);
//   DELETE /api/admin/reports/:id/claim          — release it (any staff member);
//   PUT    /api/admin/threads/:id/slowmode       — { seconds } ∈ SLOW_MODE_CHOICES, roots only;
//   DELETE /api/admin/threads/:id/slowmode       — turn it off.
// Reads: requireStaff (signed-in read). Writes: requireStaff (mutating →
// same-origin + X-CSRF-Token, so anonymous is 401 and members 403),
// assertNotBanned and the write limiter. Notes never leave these routes: no
// member-facing read, export, feed, search, MCP tool or page head joins
// member_notes. Claims cover the main post `reports` table only —
// profile_reports and dm_reports are separate tables with their own queues.
// assertSlowModeAllows is the reply-time check shared by the web reply route
// and the MCP reply tool.
import { assertNotBanned, requireStaff } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson, requiredText } from "./core/http.mjs";

export const MEMBER_NOTE_MAX = 500;
export const MEMBER_NOTES_LIMIT = 50;
export const SLOW_MODE_CHOICES = Object.freeze([30, 60, 300, 900]);
export const SLOW_MODE_REFUSAL = "Slow mode is on in this thread. Wait a little before replying again.";

const NOTES_ROUTE = /^\/api\/admin\/members\/([0-9]{1,15})\/notes$/;
const NOTE_ROUTE = /^\/api\/admin\/members\/([0-9]{1,15})\/notes\/([0-9]{1,15})$/;
const CLAIM_ROUTE = /^\/api\/admin\/reports\/([0-9]{1,15})\/claim$/;
const SLOW_MODE_ROUTE = /^\/api\/admin\/threads\/([0-9]{1,15})\/slowmode$/;

const iso = (seconds) => new Date(Number(seconds) * 1000).toISOString();
const isStaffRole = (user) => user?.role === "owner" || user?.role === "admin";

async function staffWrite(request, env) {
  const session = await requireStaff(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write", String(session.user.id));
  return session;
}

// ---------------------------------------------------------------- slow mode

// One statement, three binds (root id, author id, now): returns a row only
// when the thread is in slow mode AND the author has a reply in it (direct or
// level-2) younger than the cooldown. The thread row is a primary-key read;
// the author's replies come off idx_posts_author, their parents by rowid.
export const SLOW_MODE_CHECK_SQL =
  "SELECT s.seconds FROM thread_slowmode s WHERE s.post_id = ? AND EXISTS (" +
  "SELECT 1 FROM posts p LEFT JOIN posts par ON par.id = p.parent_id " +
  "WHERE p.author_id = ? AND p.parent_id IS NOT NULL " +
  "AND (p.parent_id = s.post_id OR par.parent_id = s.post_id) " +
  "AND p.created_at > ? - s.seconds) LIMIT 1";

// Staff are exempt (no query at all). Refused at elapsed < seconds; allowed
// from elapsed = seconds on.
export async function assertSlowModeAllows(db, user, rootId) {
  if (isStaffRole(user)) return;
  const hit = await db.prepare(SLOW_MODE_CHECK_SQL).bind(Number(rootId), Number(user.id), nowSeconds()).first();
  if (hit) throw new HttpError(429, SLOW_MODE_REFUSAL);
}

async function setSlowMode(request, env, postId, session) {
  const body = await readJson(request);
  const seconds = body.seconds;
  if (!Number.isInteger(seconds) || !SLOW_MODE_CHOICES.includes(seconds)) {
    throw new HttpError(400, "Choose 30 seconds, 1 minute, 5 minutes or 15 minutes.");
  }
  const db = env.FORUM_DB;
  const thread = await db.prepare("SELECT id, parent_id FROM posts WHERE id = ? LIMIT 1").bind(postId).first();
  if (!thread) throw new HttpError(404, "Thread not found.");
  if (thread.parent_id !== null && thread.parent_id !== undefined) {
    throw new HttpError(400, "Only thread roots can have slow mode.");
  }
  await db.prepare(
    "INSERT INTO thread_slowmode (post_id, seconds, set_by, set_at) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(post_id) DO UPDATE SET seconds = excluded.seconds, set_by = excluded.set_by, set_at = excluded.set_at",
  ).bind(postId, seconds, Number(session.user.id), nowSeconds()).run();
  return json({ ok: true, slowModeSeconds: seconds });
}

async function clearSlowMode(env, postId) {
  const removed = await env.FORUM_DB.prepare("DELETE FROM thread_slowmode WHERE post_id = ?").bind(postId).run();
  if (Number(removed.meta?.changes) < 1) throw new HttpError(409, "Slow mode is not on for this thread.");
  return json({ ok: true, slowModeSeconds: null });
}

async function handleSlowModeRoute(request, env, path, method) {
  const match = path.match(SLOW_MODE_ROUTE);
  if (!match) return null;
  if (method !== "PUT" && method !== "DELETE") throw new HttpError(405, "That method is not supported.");
  const session = await staffWrite(request, env);
  const postId = Number(match[1]);
  return method === "PUT" ? setSlowMode(request, env, postId, session) : clearSlowMode(env, postId);
}

// ---------------------------------------------------------------- report claims

async function claimReport(env, reportId, staffId) {
  const db = env.FORUM_DB;
  const inserted = await db.prepare(
    "INSERT INTO report_claims (report_id, staff_id, claimed_at) " +
    "SELECT r.id, ?, ? FROM reports r WHERE r.id = ? AND r.status = 'open' " +
    "ON CONFLICT(report_id) DO NOTHING",
  ).bind(staffId, nowSeconds(), reportId).run();
  if (Number(inserted.meta?.changes) === 1) return json({ ok: true, claimed: true });
  const row = await db.prepare(
    "SELECT r.status, c.staff_id FROM reports r LEFT JOIN report_claims c ON c.report_id = r.id WHERE r.id = ? LIMIT 1",
  ).bind(reportId).first();
  if (!row || row.status !== "open") throw new HttpError(404, "Open report not found.");
  if (Number(row.staff_id) === staffId) return json({ ok: true, claimed: true });
  throw new HttpError(409, "Another staff member already claimed this report.");
}

async function releaseReport(env, reportId) {
  const removed = await env.FORUM_DB.prepare("DELETE FROM report_claims WHERE report_id = ?").bind(reportId).run();
  if (Number(removed.meta?.changes) < 1) throw new HttpError(409, "This report is not claimed.");
  return json({ ok: true, claimed: false });
}

async function handleClaimRoute(request, env, path, method) {
  const match = path.match(CLAIM_ROUTE);
  if (!match) return null;
  if (method !== "POST" && method !== "DELETE") throw new HttpError(405, "That method is not supported.");
  const session = await staffWrite(request, env);
  const reportId = Number(match[1]);
  return method === "POST" ? claimReport(env, reportId, Number(session.user.id)) : releaseReport(env, reportId);
}

// ---------------------------------------------------------------- staff notes

const shapeNote = (row) => ({
  id: Number(row.id),
  body: row.body,
  createdAt: iso(row.created_at),
  author: { id: Number(row.author_id), username: row.author_username ?? null },
});

async function listNotes(env, memberId) {
  const db = env.FORUM_DB;
  const member = await db.prepare("SELECT id, username FROM users WHERE id = ? LIMIT 1").bind(memberId).first();
  if (!member) throw new HttpError(404, "Member not found.");
  const rows = (await db.prepare(
    "SELECT n.id, n.body, n.created_at, n.author_id, a.username AS author_username FROM member_notes n " +
    "LEFT JOIN users a ON a.id = n.author_id WHERE n.member_id = ? " +
    "ORDER BY n.created_at DESC, n.id DESC LIMIT " + MEMBER_NOTES_LIMIT,
  ).bind(memberId).all()).results || [];
  return json({ member: { id: Number(member.id), username: member.username }, notes: rows.map(shapeNote) });
}

async function addNote(request, env, memberId, session) {
  const body = await readJson(request);
  const text = requiredText(body.body, "note", MEMBER_NOTE_MAX);
  const at = nowSeconds();
  const authorId = Number(session.user.id);
  const result = await env.FORUM_DB.prepare(
    "INSERT INTO member_notes (member_id, author_id, body, created_at) " +
    "SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)",
  ).bind(memberId, authorId, text, at, memberId).run();
  if (Number(result.meta?.changes) !== 1) throw new HttpError(404, "Member not found.");
  const note = shapeNote({ id: result.meta.last_row_id, body: text, created_at: at, author_id: authorId, author_username: session.user.username });
  return json({ ok: true, note }, 201);
}

async function handleNotesRoute(request, env, path, method) {
  const match = path.match(NOTES_ROUTE);
  if (!match) return null;
  const memberId = Number(match[1]);
  if (method === "GET") {
    await requireStaff(request, env, false);
    return listNotes(env, memberId);
  }
  if (method !== "POST") throw new HttpError(405, "That method is not supported.");
  const session = await staffWrite(request, env);
  return addNote(request, env, memberId, session);
}

async function handleNoteRoute(request, env, path, method) {
  const match = path.match(NOTE_ROUTE);
  if (!match) return null;
  if (method !== "DELETE") throw new HttpError(405, "That method is not supported.");
  await staffWrite(request, env);
  const removed = await env.FORUM_DB.prepare("DELETE FROM member_notes WHERE id = ? AND member_id = ?")
    .bind(Number(match[2]), Number(match[1])).run();
  if (Number(removed.meta?.changes) < 1) throw new HttpError(404, "Note not found.");
  return json({ ok: true });
}

export async function handleStaffToolRoutes(request, env, url, path, method) {
  return (await handleNotesRoute(request, env, path, method))
    ?? (await handleNoteRoute(request, env, path, method))
    ?? (await handleClaimRoute(request, env, path, method))
    ?? handleSlowModeRoute(request, env, path, method);
}
