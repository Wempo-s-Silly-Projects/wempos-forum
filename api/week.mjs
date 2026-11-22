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

// The "This week" page (v5.35.0): GET /api/week — three read-only lists over
// data the forum already holds, nothing new stored or tracked:
//   staffPick — the current staff pick of the week (api/traditions.mjs
//               currentStaffPick; re-checked on every read);
//   threads   — up to FEED_PAGE_SIZE public roots created or active in the
//               last 7 days, most replied first (ties: most recent activity);
//   showcase  — the newest Showcase builds of the last 7 days (the gallery
//               query with a window).
// Visibility law, in SQL: the anonymous feed's root filter (public, author not
// actively banned) plus the viewer's block filter both ways (staff bypass the
// block filter, like every feed list; hidden stays off for everyone — this is
// a public face). The reply tally counts only replies a reader of the thread
// could see: public, unbanned, a public unbanned parent for sub-replies, and
// none across the viewer's block pairs. Previews are masked before the cut.
// Binds: 2 (root block filter) + 4 (tally block filters) + 1 (window) — far
// under D1_MAX_BOUND_PARAMS at any page.
import { FEED_PAGE_SIZE, WEEK_WINDOW_SECONDS } from "../constants.mjs";
import { viewerBlockFilterSql } from "./core/blocks.mjs";
import { HttpError, json } from "./core/http.mjs";
import { publicReplyCountSql } from "./discovery.mjs";
import { currentStaffPick, previewExcerpt, readViewer, showcaseGallery, visibleRootSql } from "./traditions.mjs";

const isoFromSeconds = (seconds) => new Date(Number(seconds) * 1000).toISOString();

function replyTallySql(viewer) {
  const blocks = viewerBlockFilterSql(viewer, "rc.author_id") + viewerBlockFilterSql(viewer, "rl.author_id");
  return { sql: publicReplyCountSql(blocks), values: blocks ? [viewer.id, viewer.id, viewer.id, viewer.id] : [] };
}

async function weekThreads(env, viewer, since) {
  const tally = replyTallySql(viewer);
  const visible = visibleRootSql(viewer);
  const rows = (await env.FORUM_DB.prepare(
    "SELECT p.id, p.body, p.board, p.created_at, p.last_activity_at, u.username, " + tally.sql + " AS reply_count " +
    "FROM posts p JOIN users u ON u.id = p.author_id WHERE " + visible.sql +
    "AND (p.created_at >= ? OR p.last_activity_at >= ?) " +
    "ORDER BY reply_count DESC, p.last_activity_at DESC, p.id DESC LIMIT " + FEED_PAGE_SIZE,
  ).bind(...tally.values, ...visible.values, since, since).all()).results || [];
  return rows.map((row) => ({
    id: Number(row.id),
    excerpt: previewExcerpt(row.body),
    board: row.board || "general",
    authorName: String(row.username ?? ""),
    replyCount: Number(row.reply_count || 0),
    createdAt: isoFromSeconds(row.created_at),
    lastActivityAt: isoFromSeconds(row.last_activity_at ?? row.created_at),
  }));
}

export async function handleWeekRoutes(request, env, url, path, method) {
  if (path !== "/api/week") return null;
  if (method !== "GET") throw new HttpError(405, "That method is not supported.");
  const viewer = await readViewer(request, env);
  const since = Math.floor(Date.now() / 1000) - WEEK_WINDOW_SECONDS;
  const [staffPick, threads, showcase] = await Promise.all([
    currentStaffPick(env, viewer),
    weekThreads(env, viewer, since),
    showcaseGallery(env, viewer, { since }),
  ]);
  return json({ staffPick, threads, showcase });
}
