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

// Bookmark folders (v5.39.0 F1, migration 0067): a member's PRIVATE named
// folders for saved posts, built on the bookmarks list (api/bookmarks.mjs),
// which stays exactly as it was.
//   GET    /api/me/bookmark-folders                      own folders
//   POST   /api/me/bookmark-folders { name }             create (max 20)
//   PATCH  /api/me/bookmark-folders/:id { name }         rename
//   DELETE /api/me/bookmark-folders/:id                  delete (items cascade)
//   PUT    /api/me/bookmark-folders/:id/items/:postId    add a saved post
//   DELETE /api/me/bookmark-folders/:id/items/:postId    remove it
//   GET    /api/me/bookmark-folders/:id/items?before=    contents, paged
// Writes: signed in + CSRF (requireUser), not banned, write limiter. Every
// folder route keys on (id, user_id), so anyone else's folder — staff
// included — is a 404 that says nothing about it. Contents show only posts
// the owner still has bookmarked and that pass the bookmarks list's own
// visibility rule (public, unbanned, visible ancestors, no block pair).
import { assertNotBanned, requireSignedInRead, requireUser } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { postById, POST_SELECT, publicPost } from "./core/shapers.mjs";
import { canViewPost } from "./core/visibility.mjs";
import { attachmentRowsForView } from "./attachments.mjs";
import { visibleSavedFilter } from "./bookmarks.mjs";
import { FEED_PAGE_SIZE } from "../constants.mjs";

export const FOLDER_NAME_MAX = 40;
export const FOLDERS_MAX = 20;
const BASE = "/api/me/bookmark-folders";
// Control characters (C0, DEL, C1) never belong in a folder name.
const CONTROL_CHARS = /\p{Cc}/u;

const folderNotFound = () => new HttpError(404, "Folder not found.");

export function folderNameFrom(raw) {
  if (typeof raw !== "string") throw new HttpError(400, "Folder names are 1 to 40 characters.");
  const name = raw.trim();
  const length = [...name].length;
  if (length < 1 || length > FOLDER_NAME_MAX || CONTROL_CHARS.test(name)) {
    throw new HttpError(400, "Folder names are 1 to 40 characters.");
  }
  return name;
}

const publicFolder = (row) => ({
  id: Number(row.id),
  name: String(row.name),
  createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
});

const idFrom = (raw) => {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) throw folderNotFound();
  return id;
};

async function ownFolder(env, userId, folderId) {
  const row = await env.FORUM_DB.prepare(
    "SELECT id, name, created_at FROM bookmark_folders WHERE id = ? AND user_id = ? LIMIT 1",
  ).bind(folderId, userId).first();
  if (!row) throw folderNotFound();
  return row;
}

async function writer(request, env) {
  const session = await requireUser(request, env);
  const userId = Number(session.user.id);
  await assertNotBanned(env, userId);
  await rateLimit(request, env, "write", String(userId));
  return session.user;
}

const isUniqueClash = (error) => /UNIQUE constraint failed/i.test(String(error?.message || error));
const duplicateName = () => new HttpError(409, "You already have a folder with that name.");

async function listFolders(env, userId) {
  const rows = (await env.FORUM_DB.prepare(
    "SELECT id, name, created_at FROM bookmark_folders WHERE user_id = ? ORDER BY name COLLATE NOCASE, id LIMIT " + FOLDERS_MAX,
  ).bind(userId).all()).results || [];
  return json({ folders: rows.map(publicFolder) });
}

async function createFolder(request, env) {
  const user = await writer(request, env);
  const name = folderNameFrom((await readJson(request))?.name);
  const total = await env.FORUM_DB.prepare("SELECT COUNT(*) AS n FROM bookmark_folders WHERE user_id = ?")
    .bind(user.id).first();
  if (Number(total?.n || 0) >= FOLDERS_MAX) throw new HttpError(400, "You can have up to " + FOLDERS_MAX + " folders.");
  let result;
  try {
    result = await env.FORUM_DB.prepare(
      "INSERT INTO bookmark_folders (user_id, name, created_at) VALUES (?, ?, ?)",
    ).bind(user.id, name, nowSeconds()).run();
  } catch (error) {
    if (isUniqueClash(error)) throw duplicateName();
    throw error;
  }
  const folder = await ownFolder(env, user.id, Number(result.meta.last_row_id));
  return json({ folder: publicFolder(folder) }, 201);
}

async function renameFolder(request, env, folderId) {
  const user = await writer(request, env);
  const name = folderNameFrom((await readJson(request))?.name);
  await ownFolder(env, user.id, folderId);
  try {
    await env.FORUM_DB.prepare("UPDATE bookmark_folders SET name = ? WHERE id = ? AND user_id = ?")
      .bind(name, folderId, user.id).run();
  } catch (error) {
    if (isUniqueClash(error)) throw duplicateName();
    throw error;
  }
  return json({ folder: publicFolder(await ownFolder(env, user.id, folderId)) });
}

async function deleteFolder(request, env, folderId) {
  const user = await writer(request, env);
  const result = await env.FORUM_DB.prepare("DELETE FROM bookmark_folders WHERE id = ? AND user_id = ?")
    .bind(folderId, user.id).run();
  if (Number(result?.meta?.changes) !== 1) throw folderNotFound();
  return json({ ok: true });
}

// Add: the post must be one the member has bookmarked and can still see.
async function addItem(env, user, folderId, postId) {
  const saved = await env.FORUM_DB.prepare(
    "SELECT 1 AS hit FROM bookmarks WHERE user_id = ? AND post_id = ? LIMIT 1",
  ).bind(user.id, postId).first();
  if (!saved) throw new HttpError(404, "Post not found.");
  const post = await postById(env, postId, user.id);
  if (!(await canViewPost(env, post, user))) throw new HttpError(404, "Post not found.");
  await env.FORUM_DB.prepare(
    "INSERT INTO bookmark_folder_items (folder_id, post_id, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
  ).bind(folderId, postId, nowSeconds()).run();
  return json({ ok: true, inFolder: true });
}

async function itemRoute(request, env, method, folderId, rawPostId) {
  if (method !== "PUT" && method !== "DELETE") throw new HttpError(405, "That method is not supported.");
  const user = await writer(request, env);
  await ownFolder(env, user.id, folderId);
  const postId = Number(rawPostId);
  if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
  if (method === "PUT") return addItem(env, user, folderId, postId);
  await env.FORUM_DB.prepare("DELETE FROM bookmark_folder_items WHERE folder_id = ? AND post_id = ?")
    .bind(folderId, postId).run();
  return json({ ok: true, inFolder: false });
}

function cursorFrom(url) {
  const raw = url.searchParams.get("before");
  if (raw === null) return null;
  const match = /^([0-9]{1,10})_([0-9]{1,10})$/.exec(raw);
  if (!match) throw new HttpError(400, "That page cursor is invalid.");
  return { seconds: Number(match[1]), id: Number(match[2]) };
}

// Contents: newest added first, FEED_PAGE_SIZE per page on the composite
// (added_at, post id) cursor. Binds: viewer reaction, saved-by owner, folder,
// the six block binds, and three cursor binds at most — well under 100.
async function folderItems(request, env, url, folderId) {
  const user = (await requireSignedInRead(request, env)).user;
  const folder = await ownFolder(env, user.id, folderId);
  const before = cursorFrom(url);
  const filter = visibleSavedFilter(user, null);
  let sql = POST_SELECT + "JOIN bookmark_folder_items fi ON fi.post_id = p.id " +
    "JOIN bookmarks b ON b.post_id = p.id AND b.user_id = ? WHERE fi.folder_id = ?" + filter.sql;
  const values = [user.id, user.id, folderId, ...filter.values];
  if (before) {
    sql += "AND (fi.added_at < ? OR (fi.added_at = ? AND p.id < ?)) ";
    values.push(before.seconds, before.seconds, before.id);
  }
  sql += "ORDER BY fi.added_at DESC, p.id DESC LIMIT " + (FEED_PAGE_SIZE + 1);
  const rows = (await env.FORUM_DB.prepare(sql).bind(...values).all()).results || [];
  const shown = rows.slice(0, FEED_PAGE_SIZE);
  let nextBefore = null;
  if (rows.length > FEED_PAGE_SIZE && shown.length) {
    const boundaryId = Number(shown[shown.length - 1].id);
    const stamp = await env.FORUM_DB.prepare(
      "SELECT added_at FROM bookmark_folder_items WHERE folder_id = ? AND post_id = ? LIMIT 1",
    ).bind(folderId, boundaryId).first();
    nextBefore = stamp ? Number(stamp.added_at) + "_" + boundaryId : null;
  }
  const posts = shown.map((row) => ({ ...publicPost(row, undefined), viewerBookmarked: true }));
  const attachments = await attachmentRowsForView(env.FORUM_DB, posts.map((post) => post.id), user);
  return json({
    folder: { id: Number(folder.id), name: String(folder.name) },
    posts: posts.map((post) => ({ ...post, attachments: attachments.get(post.id) || [] })),
    nextBefore,
  });
}

export async function handleBookmarkFolderRoutes(request, env, url, path, method) {
  if (path === BASE) {
    if (method === "GET") return listFolders(env, (await requireSignedInRead(request, env)).user.id);
    if (method === "POST") return createFolder(request, env);
    throw new HttpError(405, "That method is not supported.");
  }
  if (!path.startsWith(BASE + "/")) return null;
  const parts = path.slice(BASE.length + 1).split("/");
  const folderId = idFrom(/^[0-9]{1,15}$/.test(parts[0]) ? parts[0] : "");
  if (parts.length === 1) {
    if (method === "PATCH") return renameFolder(request, env, folderId);
    if (method === "DELETE") return deleteFolder(request, env, folderId);
    throw new HttpError(405, "That method is not supported.");
  }
  if (parts.length === 2 && parts[1] === "items") {
    if (method !== "GET") throw new HttpError(405, "That method is not supported.");
    return folderItems(request, env, url, folderId);
  }
  if (parts.length === 3 && parts[1] === "items" && /^[0-9]{1,15}$/.test(parts[2])) {
    return itemRoute(request, env, method, folderId, parts[2]);
  }
  throw folderNotFound();
}
