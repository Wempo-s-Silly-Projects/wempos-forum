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

// Mute a thread (v5.46.0, migration 0071): PUT/DELETE /api/posts/:id/mute.
// A member mutes a thread ROOT they can see; every notification fan-out that
// originates in that thread then skips them inside its own INSERT…SELECT
// (api/notifications.mjs mutedThreadSql). Gates mirror the subscribe route:
// requireUser (same origin + CSRF), not banned, the write rate limit tier,
// then canViewPost (invisible = 404) and the root-only rule (reply = 400).
// Both directions are idempotent. The rows are the member's own and are
// never shown to anyone else.
import { assertNotBanned, requireUser } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit } from "./core/http.mjs";
import { postById } from "./core/shapers.mjs";
import { canViewPost } from "./core/visibility.mjs";

const MUTE_PATH = /^\/api\/posts\/([0-9]{1,15})\/mute$/;
const MUTE_INSERT_SQL =
  "INSERT INTO thread_mutes (user_id, post_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING";
const MUTE_DELETE_SQL = "DELETE FROM thread_mutes WHERE user_id = ? AND post_id = ?";
// The detail payload's flag: one primary-key probe.
const MUTE_EXISTS_SQL = "SELECT 1 AS muted FROM thread_mutes WHERE user_id = ? AND post_id = ? LIMIT 1";

const notFound = () => new HttpError(404, "Post not found.");

// The thread detail's viewerMuted: true only for a member who muted this
// root. The caller adds the field for signed-in viewers on roots only.
export async function threadMuteFlagForViewer(db, viewerId, postId) {
  const row = await db.prepare(MUTE_EXISTS_SQL).bind(Number(viewerId), Number(postId)).first();
  return Boolean(row);
}

async function muteGate(request, env, rawId) {
  const session = await requireUser(request, env);
  const userId = Number(session.user.id);
  await assertNotBanned(env, userId);
  await rateLimit(request, env, "write", String(userId));
  const postId = Number(rawId);
  if (!Number.isSafeInteger(postId) || postId < 1) throw notFound();
  const post = await postById(env, postId, userId);
  if (!post || !(await canViewPost(env, post, session.user))) throw notFound();
  if (post.parent_id !== null && post.parent_id !== undefined) {
    throw new HttpError(400, "Only thread roots can be muted.");
  }
  return { userId, postId };
}

export async function handleThreadMuteRoutes(request, env, url, path, method) {
  const match = path.match(MUTE_PATH);
  if (!match) return null;
  if (method !== "PUT" && method !== "DELETE") throw new HttpError(405, "That method is not supported.");
  const { userId, postId } = await muteGate(request, env, match[1]);
  const db = env.FORUM_DB;
  if (method === "PUT") {
    await db.prepare(MUTE_INSERT_SQL).bind(userId, postId, nowSeconds()).run();
    return json({ ok: true, muted: true });
  }
  await db.prepare(MUTE_DELETE_SQL).bind(userId, postId).run();
  return json({ ok: true, muted: false });
}
