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

// All-time leaderboard (v2.5 weekly → permanent, owner's call): the top ten
// contributors ever — threads started (×2), replies written, and reactions
// RECEIVED on their content; the score is transparent addition. Currently
// banned members are excluded (their content is hidden; the leaderboard
// mirrors). Zero-activity members never appear.
import { readSession } from "./core/auth.mjs";
import { json } from "./core/http.mjs";
import { viewerBlockFilterSql } from "./core/blocks.mjs";
import { ACTIVE_BAN_SQL, publicChainSql } from "./core/visibility.mjs";

const LEADERBOARD_SIZE = 10;

export async function handleLeaderboardRoutes(request, env, url, path, method) {
  if (path !== "/api/leaderboard" || method !== "GET") return null;
  const session = await readSession(request, env);
  // Wave 40: only what a guest could see counts — public posts, and
  // reactions on public posts by members who are not actively banned — and a
  // signed-in non-staff viewer never sees a block-paired member listed.
  // Wave 5.10: "public" means the whole chain (publicChainSql) — a public
  // reply under a hidden or banned-author root counts nowhere.
  const viewer = session && session.user ? session.user : null;
  const blocks = viewerBlockFilterSql(viewer, "u.id");
  const result = await env.FORUM_DB.prepare(
    "SELECT id, username, threads, replies, reactions_received FROM (" +
    "SELECT u.id, u.username, u.username_key, " +
    "(SELECT COUNT(*) FROM posts WHERE author_id = u.id AND parent_id IS NULL AND visibility = 'public') AS threads, " +
    "(SELECT COUNT(*) FROM posts lr WHERE lr.author_id = u.id AND lr.parent_id IS NOT NULL AND " +
    publicChainSql("lr") + ") AS replies, " +
    "(SELECT COUNT(*) FROM reactions rr JOIN posts p ON p.id = rr.post_id " +
    "WHERE p.author_id = u.id AND " + publicChainSql("p") + " AND NOT " + ACTIVE_BAN_SQL("rr.user_id") +
    ") AS reactions_received " +
    "FROM users u WHERE u.role IN ('member', 'moderator', 'admin') " +
    "AND NOT " + ACTIVE_BAN_SQL("u.id") + blocks +
    ") WHERE threads + replies + reactions_received > 0 " +
    "ORDER BY 2 * threads + replies + reactions_received DESC, username_key ASC LIMIT " + LEADERBOARD_SIZE,
  ).bind(...(blocks ? [viewer.id, viewer.id] : [])).all();
  return json({
    allTime: {
      leaderboard: (result.results || []).map((row) => ({
        userId: Number(row.id),
        username: row.username,
        threads: Number(row.threads),
        replies: Number(row.replies),
        reactionsReceived: Number(row.reactions_received),
        score: 2 * Number(row.threads) + Number(row.replies) + Number(row.reactions_received),
      })),
    },
  });
}
