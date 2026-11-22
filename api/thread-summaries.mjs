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

// The author's TL;DR (v5.50.0, migration 0074):
//   GET    /api/posts/:id/summary — anyone who can view the thread (canViewPost,
//          else 404); roots only (a reply is 404). { summary: null } = none.
//   PUT    /api/posts/:id/summary — set it; DELETE removes it (idempotent).
// Writes: signed in + CSRF (requireUser), not banned, the shared write rate
// limit, roots only (a reply is 400), the thread's author or staff only. The
// text is public, so it is refused (never masked into storage) when the word
// filter changes it, and refused when it carries bidi embedding/override/
// isolate controls, C0/C1 controls (NUL included) or line separators — text
// the filter would never have seen in reading order (the v5.49 L1 lesson).
// The writer's identity is never served. The feed and POST_SELECT never
// read this table; the thread page fetches it on its own.
import { assertNotBanned, readSession, requireUser } from "./core/auth.mjs";
import { viewerBlockFilterSql } from "./core/blocks.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { postById } from "./core/shapers.mjs";
import { ACTIVE_BAN_SQL, canViewPost } from "./core/visibility.mjs";
import { applyWordFilter } from "./filter.mjs";
import { filterWords } from "./filterstore.mjs";
import { THREAD_SUMMARY_MAX_CHARS } from "../constants.mjs";

const SUMMARY_PATH = /^\/api\/posts\/([0-9]{1,15})\/summary$/;
// Binds: post id, the staff flag, then the viewer id twice when a signed-in
// non-staff viewer brings the block filter (4 at most). A summary written by
// a since-banned or block-paired staff member drops like their own content.
const summarySelectSql = (viewer) =>
  "SELECT s.body, s.updated_at FROM thread_summaries s WHERE s.post_id = ? " +
  "AND (? = 1 OR NOT " + ACTIVE_BAN_SQL("s.updated_by") + ")" + viewerBlockFilterSql(viewer, "s.updated_by") + " LIMIT 1";
// The EXISTS re-checks the root at write time: a thread deleted between the
// read and the write changes nothing (0 rows) instead of failing the FK.
const SUMMARY_UPSERT_SQL =
  "INSERT INTO thread_summaries (post_id, body, updated_by, updated_at) SELECT ?, ?, ?, ? " +
  "WHERE EXISTS (SELECT 1 FROM posts WHERE id = ? AND parent_id IS NULL LIMIT 1) " +
  "ON CONFLICT (post_id) DO UPDATE SET body = excluded.body, updated_by = excluded.updated_by, updated_at = excluded.updated_at";
const SUMMARY_DELETE_SQL = "DELETE FROM thread_summaries WHERE post_id = ?";

const notFound = () => new HttpError(404, "Post not found.");
const isStaff = (user) => Boolean(user && (user.role === "owner" || user.role === "admin"));
const shapeSummary = (row) =>
  row ? { body: row.body, updatedAt: new Date(Number(row.updated_at) * 1000).toISOString() } : null;

// C0 (NUL, tab and line breaks included), DEL and C1, the line/paragraph
// separators, and the bidi embedding/override (U+202A-202E) and isolate
// (U+2066-2069) controls. The plain direction marks U+200E/200F stay allowed.
const isRefusedChar = (code) =>
  code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 ||
  (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);

// The trimmed text, or a 400. Length counts code points, like the CHECK.
export function summaryBody(env, value) {
  if (typeof value !== "string") throw new HttpError(400, "Write a TL;DR, or remove it instead.");
  const body = value.trim();
  if (!body) throw new HttpError(400, "Write a TL;DR, or remove it instead.");
  const chars = [...body];
  if (chars.length > THREAD_SUMMARY_MAX_CHARS) {
    throw new HttpError(400, "A TL;DR can be up to " + THREAD_SUMMARY_MAX_CHARS + " characters.");
  }
  if (chars.some((ch) => isRefusedChar(ch.codePointAt(0)))) {
    throw new HttpError(400, "A TL;DR is one line of plain text.");
  }
  if (applyWordFilter(body, filterWords(env)) !== body) throw new HttpError(400, "That TL;DR can't be used here.");
  return body;
}

async function viewableRoot(env, postId, viewer) {
  const post = await postById(env, postId, viewer ? viewer.id : null);
  if (!post || !(await canViewPost(env, post, viewer))) throw notFound();
  return post;
}

async function readSummary(env, postId, viewer) {
  const staffFlag = isStaff(viewer) ? 1 : 0;
  const binds = [postId, staffFlag];
  if (viewer && viewer.id && !staffFlag) binds.push(Number(viewer.id), Number(viewer.id));
  return shapeSummary(await env.FORUM_DB.prepare(summarySelectSql(viewer)).bind(...binds).first());
}

async function writeSummary(request, env, postId, user) {
  const body = summaryBody(env, (await readJson(request)).body);
  const result = await env.FORUM_DB.prepare(SUMMARY_UPSERT_SQL)
    .bind(postId, body, Number(user.id), nowSeconds(), postId).run();
  if (Number(result.meta?.changes) !== 1) throw notFound();
  return json({ summary: await readSummary(env, postId, user) });
}

export async function handleThreadSummaryRoutes(request, env, url, path, method) {
  const match = path.match(SUMMARY_PATH);
  if (!match) return null;
  const postId = Number(match[1]);
  if (method === "GET") {
    if (!Number.isSafeInteger(postId) || postId < 1) throw notFound();
    const session = await readSession(request, env);
    const viewer = session && session.user ? session.user : null;
    const post = await viewableRoot(env, postId, viewer);
    if (post.parent_id !== null && post.parent_id !== undefined) throw notFound();
    return json({ summary: await readSummary(env, postId, viewer) });
  }
  if (method !== "PUT" && method !== "DELETE") throw new HttpError(405, "That method is not supported.");
  const { user } = await requireUser(request, env);
  await assertNotBanned(env, Number(user.id));
  await rateLimit(request, env, "write", String(user.id));
  if (!Number.isSafeInteger(postId) || postId < 1) throw notFound();
  const post = await viewableRoot(env, postId, user);
  if (post.parent_id !== null && post.parent_id !== undefined) {
    throw new HttpError(400, "Only a thread's first post can have a TL;DR.");
  }
  if (Number(post.author_id) !== Number(user.id) && !isStaff(user)) {
    throw new HttpError(403, "Only the thread's author or staff can change its TL;DR.");
  }
  if (method === "PUT") return writeSummary(request, env, postId, user);
  await env.FORUM_DB.prepare(SUMMARY_DELETE_SQL).bind(postId).run();
  return json({ summary: null });
}
