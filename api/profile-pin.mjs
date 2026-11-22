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

// Pinned thread on a profile (v5.38.0 F1, migration 0066). One pin per
// member; PUT /api/me/profile-pin { postId } pins (re-pin replaces), DELETE
// unpins. Writes are signed in + CSRF (requireUser), not banned, rate limited.
// Only the member's OWN public root thread can be pinned: another member's
// thread or a missing one is 404, a reply or a hidden thread is 400.
// The read (readPinnedThread) re-checks everything on every request, like
// api/profile-threads.mjs — the member's own root, public (even for staff:
// this is the public face), no active ban — so a hide or a ban drops the pin
// with no write and an unban restores it. Block pairs never reach it: the
// profile payload refuses the pair before any read runs.
import { assertNotBanned, requireUser } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { banFilterSql } from "./posts-feed.mjs";

export async function readPinnedThread(env, userId) {
  const row = await env.FORUM_DB.prepare(
    "SELECT p.id, p.body, p.board, p.created_at FROM profile_pins pin JOIN posts p ON p.id = pin.post_id " +
    "WHERE pin.user_id = ? AND p.author_id = pin.user_id AND p.parent_id IS NULL AND p.visibility = 'public' AND " +
    banFilterSql("p") + " LIMIT 1",
  ).bind(Number(userId)).first();
  if (!row) return null;
  return {
    id: Number(row.id),
    body: String(row.body ?? ""),
    board: row.board || "general",
    createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
  };
}

function postIdFrom(body) {
  const postId = body?.postId;
  if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(400, "Choose one of your threads to pin.");
  return postId;
}

async function assertPinnable(env, userId, postId) {
  const post = await env.FORUM_DB.prepare(
    "SELECT author_id, parent_id, visibility FROM posts WHERE id = ? LIMIT 1",
  ).bind(postId).first();
  if (!post || Number(post.author_id) !== userId) throw new HttpError(404, "Post not found.");
  if (post.parent_id !== null && post.parent_id !== undefined) {
    throw new HttpError(400, "Only a thread you started can be pinned.");
  }
  if (post.visibility !== "public") throw new HttpError(400, "Only a public thread can be pinned.");
}

export async function handleProfilePinRoutes(request, env, url, path, method) {
  if (path !== "/api/me/profile-pin" || (method !== "PUT" && method !== "DELETE")) return null;
  const session = await requireUser(request, env);
  const userId = Number(session.user.id);
  await assertNotBanned(env, userId);
  await rateLimit(request, env, "write", String(userId));
  const db = env.FORUM_DB;
  if (method === "DELETE") {
    await db.prepare("DELETE FROM profile_pins WHERE user_id = ?").bind(userId).run();
    return json({ ok: true });
  }
  const postId = postIdFrom(await readJson(request));
  await assertPinnable(env, userId, postId);
  await db.prepare(
    "INSERT INTO profile_pins (user_id, post_id, pinned_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(user_id) DO UPDATE SET post_id = excluded.post_id, pinned_at = excluded.pinned_at",
  ).bind(userId, postId, nowSeconds()).run();
  return json({ pinned: await readPinnedThread(env, userId) });
}
