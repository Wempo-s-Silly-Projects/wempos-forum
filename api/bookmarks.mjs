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

// Bookmarks (C4): PUT/DELETE /api/posts/:id/bookmark (member gates mirroring
// the reaction/subscribe routes; idempotent in both directions — a missing row
// is the state the caller wanted) and the PRIVATE list at /api/me/bookmarks —
// the session's OWN rows only, newest first, guests 401. The list rides
// POST_SELECT with the feed's visibility semantics (public, unbanned rows), so
// a post that later became hidden doesn't leak through somebody's saved list.
import { assertNotBanned, requireSignedInRead, requireUser } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit } from "./core/http.mjs";
import { postById, POST_SELECT, publicPost } from "./core/shapers.mjs";
import { viewerBlockFilterSql } from "./core/blocks.mjs";
import { canViewPost } from "./core/visibility.mjs";
import { attachmentRowsForView } from "./attachments.mjs";
import { banFilterSql } from "./posts-feed.mjs";
import { BOARD_VALUES } from "./boards.mjs";

const SAVED_PAGE_SIZE = 20;
// One "remove all from this board" run removes at most this many rows; the
// response's count lets the client say how many went.
export const SAVED_BOARD_REMOVE_CAP = 500;

// A visible ancestor (wave 36): a saved reply shows only while its parent —
// and, for a level-2 reply, the root — is public with an unbanned author.
// Replies sit at most two levels deep, so two nested probes cover the chain.
// Wave 39: each ancestor's author also passes the viewer's block test (both
// directions, staff bypass) — canViewPost refuses that chain, and the row's
// parent.body would otherwise carry the block-paired member's text.
const visibleAncestorSql = (alias, blockFor) =>
  "(" + alias + ".parent_id IS NULL OR EXISTS (SELECT 1 FROM posts pa WHERE pa.id = " + alias +
  ".parent_id AND pa.visibility = 'public' AND " + banFilterSql("pa") + blockFor("pa.author_id") + " AND " +
  "(pa.parent_id IS NULL OR EXISTS (SELECT 1 FROM posts pg WHERE pg.id = pa.parent_id " +
  "AND pg.visibility = 'public' AND " + banFilterSql("pg") + blockFor("pg.author_id") + "))))";

// Block clauses for the post and its two ancestors: three per-column clauses,
// two `user.id` binds each (all placeholders bind the same id, so their order
// within the tail never matters).
const ANCESTOR_BLOCK_CLAUSES = 3;

// The saved rows a member may see, shared by the list and the board removal
// so "remove all from this board" removes exactly what the list showed.
// v5.39: bookmark folders (api/bookmark-folders.mjs) reuse it unchanged.
// Returns the SQL tail (starts with " AND") and its bind values.
export function visibleSavedFilter(user, board) {
  const blockFor = (column) => viewerBlockFilterSql(user, column);
  const blockFilter = blockFor("p.author_id");
  let sql = " AND p.visibility = 'public' AND " + banFilterSql("p") + " AND " + visibleAncestorSql("p", blockFor);
  const values = blockFilter ? Array(ANCESTOR_BLOCK_CLAUSES * 2).fill(user.id) : [];
  sql += blockFilter;
  if (board) {
    sql += " AND p.board = ?";
    values.push(board);
  }
  return { sql: sql + " ", values };
}

// ?board= is optional on the list and required on the removal; when present
// it must be one of the whitelisted board slugs.
function boardParam(url, required) {
  const raw = url.searchParams.get("board");
  if (raw === null && !required) return null;
  if (raw === null || !BOARD_VALUES.includes(raw)) {
    throw new HttpError(400, "That board is not available.");
  }
  return raw;
}

// The detail/feed flag read: one query for the (member, post) pair.
export const BOOKMARK_EXISTS_SQL =
  "SELECT 1 AS bookmarked FROM bookmarks WHERE user_id = ? AND post_id = ?";

// One batched lookup per page (like the attachments decorator): the viewer's
// saved state for every post id on the page. Guests skip the query entirely —
// call sites must treat an undefined flag as "not for me".
export async function withBookmarkFlags(db, viewer, posts) {
  if (!posts.length || !viewer) return posts;
  const ids = [...new Set(posts.map((post) => Number(post.id)))];
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db.prepare(
    "SELECT post_id FROM bookmarks WHERE user_id = ? AND post_id IN (" + placeholders + ")",
  ).bind(viewer.id, ...ids).all();
  const saved = new Set((result.results || []).map((row) => Number(row.post_id)));
  return posts.map((post) => ({ ...post, viewerBookmarked: saved.has(Number(post.id)) }));
}

export async function bookmarkFlagForViewer(db, viewerId, postId) {
  const existing = await db.prepare(BOOKMARK_EXISTS_SQL).bind(viewerId, postId).first();
  return Boolean(existing);
}

// The private list: POST_SELECT payloads (reply metadata + attachments
// decorated, exactly like a feed page), newest bookmark first. Hidden/banned
// rows are skipped — mirroring the feed instead of leaking. Capped at 100.
async function handleBookmarkListRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/me/bookmarks" && method === "GET") {
    const user = (await requireSignedInRead(request, env)).user;
    // Pagination (fix round 1): a `before` cursor walks the list's OWN sort key
    // — (bookmarked_at, post id) — in the composite seconds_id format the
    // activity feed established (both keys DESC, strictly exclusive). The
    // cursor's seconds half is the BOOKMARK stamp, so the response's nextBefore
    // resolves it from the boundary bookmark's row (POST_SELECT projections
    // don't carry b.created_at; one tiny follow-up read, only when a next page
    // exists).
    const beforeRaw = url.searchParams.get("before");
    let before = null;
    if (beforeRaw !== null) {
      const cursorMatch = /^([0-9]{1,10})_([0-9]{1,10})$/.exec(beforeRaw);
      if (!cursorMatch) throw new HttpError(400, "That page cursor is invalid.");
      before = { seconds: Number(cursorMatch[1]), id: Number(cursorMatch[2]) };
    }
    const board = boardParam(url, false);
    // Blocks (v4.4): a saved post whose author is now block-paired with the
    // viewer drops from the list (both directions). Staff keep their saved
    // rows. Board filter + visible ancestors: wave 36 (visibleSavedFilter).
    const filter = visibleSavedFilter(user, board);
    let sql = POST_SELECT + "JOIN bookmarks b ON b.post_id = p.id WHERE b.user_id = ?" + filter.sql;
    const values = [user.id, user.id, ...filter.values];
    if (before) {
      sql += "AND (b.created_at < ? OR (b.created_at = ? AND p.id < ?)) ";
      values.push(before.seconds, before.seconds, before.id);
    }
    sql += "ORDER BY b.created_at DESC, p.id DESC LIMIT " + (SAVED_PAGE_SIZE + 1);
    const result = await db.prepare(sql).bind(...values).all();
    const rows = result.results || [];
    const hasMore = rows.length > SAVED_PAGE_SIZE;
    const shown = rows.slice(0, SAVED_PAGE_SIZE);
    let nextBefore = null;
    if (hasMore && shown.length) {
      const boundaryId = Number(shown[shown.length - 1].id);
      const stamp = await db.prepare(
        "SELECT created_at FROM bookmarks WHERE user_id = ? AND post_id = ? LIMIT 1",
      ).bind(user.id, boundaryId).first();
      nextBefore = stamp ? Number(stamp.created_at) + "_" + boundaryId : null;
    }
    const posts = shown.map((row) => ({
      ...publicPost(row, undefined),
      viewerBookmarked: true,
    }));
    const attachments = await attachmentRowsForView(
      db, posts.map((post) => post.id), user,
    );
    return json({
      bookmarks: posts.map((post) => ({ ...post, attachments: attachments.get(post.id) || [] })),
      nextBefore,
    });
  }
  if (path === "/api/me/bookmarks" && method === "DELETE") return removeSavedBoard(request, env, url);
  if (path === "/api/me/bookmarks") throw new HttpError(405, "That method is not supported.");
  return null;
}

// DELETE /api/me/bookmarks?board=<slug> (wave 36): the member's OWN saved
// rows in one board — only the ones the list shows, so hidden/banned/blocked
// rows stay saved and come back when that state lifts. Same member gates as
// the per-post toggle (session + Origin + CSRF, not banned, write limiter).
async function removeSavedBoard(request, env, url) {
  const session = await requireUser(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write", String(session.user.id));
  const board = boardParam(url, true);
  const filter = visibleSavedFilter(session.user, board);
  const result = await env.FORUM_DB.prepare(
    "DELETE FROM bookmarks WHERE user_id = ? AND post_id IN (" +
      "SELECT b.post_id FROM bookmarks b JOIN posts p ON p.id = b.post_id WHERE b.user_id = ?" +
      filter.sql + "LIMIT " + SAVED_BOARD_REMOVE_CAP + ")",
  ).bind(session.user.id, session.user.id, ...filter.values).run();
  return json({ ok: true, removed: Number(result.meta?.changes || 0) });
}

async function handleBookmarkToggleRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const match = path.match(/^\/api\/posts\/([0-9]+)\/bookmark$/);
  if (!match) return null;
  // The method gate runs before any session work so a stray PATCH is a 405
  // with zero database reads (mirrors the reaction DELETE route's gate).
  if (method !== "PUT" && method !== "DELETE") {
    throw new HttpError(405, "That method is not supported.");
  }
  const session = await requireUser(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write", String(session.user.id));
  const postId = Number(match[1]);
  if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
  const post = await postById(env, postId, session.user.id);
  if (!(await canViewPost(env, post, session.user))) throw new HttpError(404, "Post not found.");
  const now = nowSeconds();
  if (method === "PUT") {
    // Idempotent by construction: an existing (member, post) row changes 0 rows
    // and still answers the wanted state.
    await db.prepare(
      "INSERT INTO bookmarks (user_id, post_id, created_at) " +
        "SELECT ?, ?, ? WHERE NOT EXISTS (" +
        "SELECT 1 FROM bookmarks WHERE user_id = ? AND post_id = ? LIMIT 1)",
    ).bind(session.user.id, postId, now, session.user.id, postId).run();
    return json({ ok: true, bookmarked: true });
  }
  await db.prepare(
    "DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?",
  ).bind(session.user.id, postId).run();
  return json({ ok: true, bookmarked: false });
}

export async function handleBookmarkRoutes(request, env, url, path, method) {
  const listed = await handleBookmarkListRoute(request, env, url, path, method);
  if (listed) return listed;
  const toggled = await handleBookmarkToggleRoute(request, env, url, path, method);
  if (toggled) return toggled;
  return null;
}