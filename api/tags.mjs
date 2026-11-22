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

// Thread tags (v5.44.0, migration 0070):
//   GET    /api/tags                — every tag (public), by label;
//   POST   /api/admin/tags          — staff: { slug, label } (≤ TAG_TOTAL_MAX tags);
//   DELETE /api/admin/tags/:id      — staff: remove a tag (its thread rows cascade);
//   GET    /api/posts/:id/tags      — a thread's tags, when canViewPost passes;
//   PUT    /api/posts/:id/tags      — { tagIds } on a ROOT, author or staff, ≤ THREAD_TAG_MAX;
//   GET    /api/tags/:slug/posts    — the tag listing, a feed variant.
// Writes: session + same-origin + X-CSRF-Token (requireUser / requireStaff),
// assertNotBanned, the write limiter. Labels are word-filtered at create
// (refused, not masked). The listing obeys the visibility law in SQL: roots
// only, public, author not actively banned, and for a signed-in non-staff
// viewer viewablePostSql plus the both-way block filter (staff bypass the
// block filter only — hidden stays off for everyone, this is a public face).
// It pages FEED_PAGE_SIZE rows on the bare-id cursor (`before`, newest
// first) with no caller-supplied size. Binds at worst: 4 (reply tally block
// filters) + 1 (tag) + 6 (viewablePostSql) + 2 (root block filter) + 1
// (cursor) = 14, far under D1_MAX_BOUND_PARAMS. Previews are masked first.
import { FEED_PAGE_SIZE } from "../constants.mjs";
import { assertNotBanned, readSession, requireStaff, requireUser } from "./core/auth.mjs";
import { viewerBlockFilterSql } from "./core/blocks.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { VIEWABLE_POST_BINDS, canViewPost, viewablePostSql } from "./core/visibility.mjs";
import { publicReplyCountSql } from "./discovery.mjs";
import { containsFilteredWord } from "./filter.mjs";
import { filterWords } from "./filterstore.mjs";
import { banFilterSql } from "./posts-feed.mjs";
import { previewExcerpt } from "./traditions.mjs";

export const TAG_TOTAL_MAX = 50;
export const THREAD_TAG_MAX = 3;
export const TAG_LABEL_MAX = 24;
export const TAG_SLUG_PATTERN = /^[a-z0-9-]{2,24}$/;

const ADMIN_TAG_ROUTE = /^\/api\/admin\/tags\/([0-9]{1,15})$/;
const POST_TAGS_ROUTE = /^\/api\/posts\/([0-9]{1,15})\/tags$/;
const TAG_POSTS_ROUTE = /^\/api\/tags\/([^/]+)\/posts$/;
const CURSOR_PATTERN = /^[0-9]{1,15}$/;
const TAG_COLUMNS = "t.id, t.slug, t.label";

const isStaff = (viewer) => Boolean(viewer && (viewer.role === "owner" || viewer.role === "admin"));
const iso = (seconds) => new Date(Number(seconds) * 1000).toISOString();
const shapeTag = (row) => ({ id: Number(row.id), slug: String(row.slug), label: String(row.label) });

async function readViewer(request, env) {
  const session = await readSession(request, env);
  return session && session.user ? session.user : null;
}

async function memberWrite(request, env, staff = false) {
  const session = staff ? await requireStaff(request, env) : await requireUser(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write", String(session.user.id));
  return session;
}

// ---------------------------------------------------------------- staff CRUD

function readNewTag(env, body) {
  const slug = typeof body.slug === "string" ? body.slug : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!TAG_SLUG_PATTERN.test(slug)) {
    throw new HttpError(400, "Tag slugs are 2 to 24 lowercase letters, digits or hyphens.");
  }
  if (!label || [...label].length > TAG_LABEL_MAX) {
    throw new HttpError(400, "Tag labels are 1 to " + TAG_LABEL_MAX + " characters.");
  }
  const words = filterWords(env);
  if (containsFilteredWord(slug, words) || containsFilteredWord(label, words)) {
    throw new HttpError(400, "That tag is not allowed.");
  }
  return { slug, label };
}

// The cap rides the INSERT itself (one statement, no read-then-write race);
// a duplicate slug is DO NOTHING. 0 changes = which of the two, then 409.
async function createTag(request, env) {
  const session = await memberWrite(request, env, true);
  const { slug, label } = readNewTag(env, await readJson(request));
  const db = env.FORUM_DB;
  const inserted = await db.prepare(
    "INSERT INTO forum_tags (slug, label, created_by, created_at) " +
    "SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM forum_tags) < " + TAG_TOTAL_MAX + " " +
    "ON CONFLICT(slug) DO NOTHING",
  ).bind(slug, label, Number(session.user.id), nowSeconds()).run();
  if (Number(inserted.meta?.changes) !== 1) {
    const taken = await db.prepare("SELECT 1 AS hit FROM forum_tags WHERE slug = ? LIMIT 1").bind(slug).first();
    throw new HttpError(409, taken ? "That tag already exists." : "The forum already has " + TAG_TOTAL_MAX + " tags.");
  }
  const id = Number(inserted.meta?.last_row_id);
  return json({ tag: { id, slug, label } }, 201);
}

async function deleteTag(request, env, tagId) {
  await memberWrite(request, env, true);
  const removed = await env.FORUM_DB.prepare("DELETE FROM forum_tags WHERE id = ?").bind(tagId).run();
  if (Number(removed.meta?.changes) !== 1) throw new HttpError(404, "Tag not found.");
  return json({ ok: true });
}

async function listTags(env) {
  const rows = (await env.FORUM_DB.prepare(
    "SELECT " + TAG_COLUMNS + " FROM forum_tags t ORDER BY t.label COLLATE NOCASE, t.id LIMIT " + TAG_TOTAL_MAX,
  ).all()).results || [];
  return json({ tags: rows.map(shapeTag) });
}

// ---------------------------------------------------------------- a thread's tags

async function threadTags(db, postId) {
  const rows = (await db.prepare(
    "SELECT " + TAG_COLUMNS + " FROM thread_tags tt JOIN forum_tags t ON t.id = tt.tag_id " +
    "WHERE tt.post_id = ? ORDER BY t.label COLLATE NOCASE, t.id LIMIT " + THREAD_TAG_MAX,
  ).bind(postId).all()).results || [];
  return rows.map(shapeTag);
}

async function viewablePost(env, postId, viewer) {
  const post = await env.FORUM_DB.prepare(
    "SELECT id, parent_id, author_id, visibility FROM posts WHERE id = ? LIMIT 1",
  ).bind(postId).first();
  if (!(await canViewPost(env, post, viewer))) throw new HttpError(404, "Post not found.");
  return post;
}

function readTagIds(body) {
  const ids = body.tagIds;
  const valid = Array.isArray(ids) && ids.every((id) => Number.isSafeInteger(id) && id > 0);
  if (!valid || new Set(ids).size !== ids.length) throw new HttpError(400, "Choose tags from the list.");
  if (ids.length > THREAD_TAG_MAX) throw new HttpError(400, "A thread can have up to " + THREAD_TAG_MAX + " tags.");
  return ids;
}

async function setThreadTags(request, env, postId) {
  const session = await memberWrite(request, env);
  const viewer = session.user;
  const post = await viewablePost(env, postId, viewer);
  if (post.parent_id !== null && post.parent_id !== undefined) {
    throw new HttpError(400, "Only thread roots can have tags.");
  }
  if (Number(post.author_id) !== Number(viewer.id) && !isStaff(viewer)) {
    throw new HttpError(403, "Only the author or staff can tag this thread.");
  }
  const tagIds = readTagIds(await readJson(request));
  const db = env.FORUM_DB;
  if (tagIds.length) {
    const known = await db.prepare(
      "SELECT COUNT(*) AS n FROM forum_tags WHERE id IN (" + tagIds.map(() => "?").join(", ") + ")",
    ).bind(...tagIds).first();
    if (Number(known?.n) !== tagIds.length) throw new HttpError(400, "Choose tags from the list.");
  }
  await db.batch([
    db.prepare("DELETE FROM thread_tags WHERE post_id = ?").bind(postId),
    ...tagIds.map((tagId) => db.prepare(
      "INSERT INTO thread_tags (post_id, tag_id) SELECT ?, id FROM forum_tags WHERE id = ?",
    ).bind(postId, tagId)),
  ]);
  return json({ tags: await threadTags(db, postId) });
}

async function handlePostTagsRoute(request, env, path, method) {
  const match = path.match(POST_TAGS_ROUTE);
  if (!match) return null;
  const postId = Number(match[1]);
  if (method === "PUT") return setThreadTags(request, env, postId);
  if (method !== "GET") throw new HttpError(405, "That method is not supported.");
  await viewablePost(env, postId, await readViewer(request, env));
  return json({ tags: await threadTags(env.FORUM_DB, postId) });
}

// ---------------------------------------------------------------- the tag listing

// The visibility law for the listing, with its binds in text order.
function listingVisibilitySql(viewer) {
  const member = viewer && !isStaff(viewer);
  const blockClause = viewerBlockFilterSql(viewer, "p.author_id");
  return {
    sql: "p.parent_id IS NULL AND p.visibility = 'public' AND " + banFilterSql("p") +
      (member ? " AND " + viewablePostSql("p.id") : "") + blockClause + " ",
    values: [
      ...(member ? Array(VIEWABLE_POST_BINDS).fill(viewer.id) : []),
      ...(blockClause ? [viewer.id, viewer.id] : []),
    ],
  };
}

function replyTallySql(viewer) {
  const blocks = viewerBlockFilterSql(viewer, "rc.author_id") + viewerBlockFilterSql(viewer, "rl.author_id");
  return { sql: publicReplyCountSql(blocks), values: blocks ? [viewer.id, viewer.id, viewer.id, viewer.id] : [] };
}

export async function findTagBySlug(db, slug) {
  if (typeof slug !== "string" || !TAG_SLUG_PATTERN.test(slug)) return null;
  const row = await db.prepare("SELECT " + TAG_COLUMNS + " FROM forum_tags t WHERE t.slug = ? LIMIT 1").bind(slug).first();
  return row ? shapeTag(row) : null;
}

async function tagListing(request, env, url, slug) {
  const tag = await findTagBySlug(env.FORUM_DB, slug);
  if (!tag) throw new HttpError(404, "Tag not found.");
  const beforeRaw = url.searchParams.get("before");
  if (beforeRaw !== null && !CURSOR_PATTERN.test(beforeRaw)) throw new HttpError(400, "That page cursor is invalid.");
  const viewer = await readViewer(request, env);
  const tally = replyTallySql(viewer);
  const visible = listingVisibilitySql(viewer);
  const rows = (await env.FORUM_DB.prepare(
    "SELECT p.id, p.body, p.board, p.created_at, p.last_activity_at, u.username, " + tally.sql + " AS reply_count " +
    "FROM thread_tags tt JOIN posts p ON p.id = tt.post_id JOIN users u ON u.id = p.author_id " +
    "WHERE tt.tag_id = ? AND " + visible.sql + (beforeRaw === null ? "" : "AND p.id < ? ") +
    "ORDER BY p.id DESC LIMIT " + (FEED_PAGE_SIZE + 1),
  ).bind(...tally.values, tag.id, ...visible.values, ...(beforeRaw === null ? [] : [Number(beforeRaw)])).all()).results || [];
  const shown = rows.slice(0, FEED_PAGE_SIZE);
  const threads = shown.map((row) => ({
    id: Number(row.id),
    excerpt: previewExcerpt(row.body),
    board: row.board || "general",
    authorName: String(row.username ?? ""),
    replyCount: Number(row.reply_count || 0),
    createdAt: iso(row.created_at),
    lastActivityAt: iso(row.last_activity_at ?? row.created_at),
  }));
  const hasMore = rows.length > FEED_PAGE_SIZE;
  return json({ tag, threads, nextBefore: hasMore && threads.length ? threads[threads.length - 1].id : null });
}

export async function handleTagRoutes(request, env, url, path, method) {
  if (path === "/api/tags") {
    if (method !== "GET") throw new HttpError(405, "That method is not supported.");
    return listTags(env);
  }
  if (path === "/api/admin/tags") {
    if (method !== "POST") throw new HttpError(405, "That method is not supported.");
    return createTag(request, env);
  }
  const adminMatch = path.match(ADMIN_TAG_ROUTE);
  if (adminMatch) {
    if (method !== "DELETE") throw new HttpError(405, "That method is not supported.");
    return deleteTag(request, env, Number(adminMatch[1]));
  }
  const listing = path.match(TAG_POSTS_ROUTE);
  if (listing) {
    if (method !== "GET") throw new HttpError(405, "That method is not supported.");
    return tagListing(request, env, url, listing[1]);
  }
  return handlePostTagsRoute(request, env, path, method);
}
