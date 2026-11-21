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

// Recent threads on a profile (wave 2026-11-21-13 F2): GET
// /api/users/:id/threads lists the member's newest root posts that the
// visibility law lets anyone see — public only (hidden roots stay off even
// for staff and the author: this is the public face of the profile), and
// nothing while the author holds an active ban (read-time, so an unban
// restores the list with no write). A block pair refuses the read both ways,
// exactly like the profile and its wall; staff are exempt from that gate.
// Rows are shaped by hand to four fields: no author row is joined at all.
import { readSession } from "./core/auth.mjs";
import { blockPairExists } from "./core/blocks.mjs";
import { HttpError, json } from "./core/http.mjs";
import { banFilterSql } from "./posts-feed.mjs";

export const PROFILE_THREADS_LIMIT = 5;

const isStaff = (viewer) => Boolean(viewer && (viewer.role === "owner" || viewer.role === "admin"));

export async function handleProfileThreadsRoute(request, env, url, path, method) {
  const match = path.match(/^\/api\/users\/([0-9]{1,15})\/threads$/);
  if (!match || method !== "GET") return null;
  const authorId = Number(match[1]);
  const owner = await env.FORUM_DB.prepare("SELECT id FROM users WHERE id = ? LIMIT 1").bind(authorId).first();
  if (!owner) throw new HttpError(404, "Member not found.");
  const session = await readSession(request, env);
  const viewer = session && session.user ? session.user : null;
  if (viewer && !isStaff(viewer) && Number(viewer.id) !== authorId &&
    (await blockPairExists(env, viewer.id, authorId))) {
    throw new HttpError(403, "Those threads are not available.");
  }
  const rows = (await env.FORUM_DB.prepare(
    "SELECT p.id, p.body, p.board, p.created_at FROM posts p " +
    "WHERE p.author_id = ? AND p.parent_id IS NULL AND p.visibility = 'public' AND " +
    banFilterSql("p") + " ORDER BY p.id DESC LIMIT " + PROFILE_THREADS_LIMIT,
  ).bind(authorId).all()).results || [];
  return json({
    threads: rows.map((row) => ({
      id: Number(row.id),
      body: String(row.body ?? ""),
      board: row.board || "general",
      createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
    })),
  });
}
