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

// Newest members (v5.35.0): GET /api/members/newest — the home page's short
// "Newest members" list, so new arrivals get noticed. Read-only; no
// notifications, no emails, nothing stored.
// Visibility law: a member with an ACTIVE ban is never listed (read-time; an
// unban restores them with no write), and a signed-in viewer never sees a
// member they are block-paired with in either direction (staff bypass the
// block filter, like every list). Only the name and avatar URL leave the
// server — the join time itself is never sent; the order alone is the point.
import { NEWEST_MEMBERS_LIMIT } from "../constants.mjs";
import { viewerBlockFilterSql } from "./core/blocks.mjs";
import { HttpError, json } from "./core/http.mjs";
import { ACTIVE_BAN_SQL } from "./core/visibility.mjs";
import { readViewer } from "./traditions.mjs";

export async function handleNewcomerRoutes(request, env, url, path, method) {
  if (path !== "/api/members/newest") return null;
  if (method !== "GET") throw new HttpError(405, "That method is not supported.");
  const viewer = await readViewer(request, env);
  const blockClause = viewerBlockFilterSql(viewer, "u.id");
  const rows = (await env.FORUM_DB.prepare(
    "SELECT u.id, u.username, u.avatar_mime, u.avatar_version FROM users u WHERE NOT " + ACTIVE_BAN_SQL("u.id") +
    blockClause + " ORDER BY u.created_at DESC, u.id DESC LIMIT " + NEWEST_MEMBERS_LIMIT,
  ).bind(...(blockClause ? [viewer.id, viewer.id] : [])).all()).results || [];
  return json({
    members: rows.map((row) => ({
      username: String(row.username),
      avatarUrl: row.avatar_mime ? "/api/avatars/" + Number(row.id) + "?v=" + row.avatar_version : null,
    })),
  });
}
