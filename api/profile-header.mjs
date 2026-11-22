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

// Batch I items 5 + 6: the profile header decoration a member picks (plain,
// a tint from their own avatar, or a static pattern). Opt-in: no
// profile_header_styles row (migration 0084) means plain. PUT
// /api/me/profile-header is the only write — signed in, CSRF-checked
// (requireUser), not banned, rate-limited on the shared write tier — and ""
// deletes the row. The value is one key from PROFILE_HEADER_STYLES, never
// free text; reads ride the profile payload (api/profiles.mjs).
import { PROFILE_HEADER_STYLES } from "../constants.mjs";
import { assertNotBanned, requireUser } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";

const HEADER_STYLE_INVALID = "Pick one of the listed profile header styles.";

// The stored style, or "" when the member never picked one.
export async function readProfileHeader(db, userId) {
  const row = await db.prepare("SELECT header_style FROM profile_header_styles WHERE user_id = ? LIMIT 1")
    .bind(Number(userId)).first();
  const style = row ? String(row.header_style) : "";
  return PROFILE_HEADER_STYLES.includes(style) ? style : "";
}

export async function handleProfileHeaderRoutes(request, env, url, path, method) {
  if (path !== "/api/me/profile-header" || method !== "PUT") return null;
  const session = await requireUser(request, env);
  const userId = Number(session.user.id);
  await assertNotBanned(env, userId);
  await rateLimit(request, env, "write", String(userId));
  const body = await readJson(request);
  const style = body ? body.style : undefined;
  if (typeof style !== "string" || !PROFILE_HEADER_STYLES.includes(style)) {
    throw new HttpError(400, HEADER_STYLE_INVALID);
  }
  const db = env.FORUM_DB;
  if (style === "") {
    await db.prepare("DELETE FROM profile_header_styles WHERE user_id = ?").bind(userId).run();
    return json({ style: "" });
  }
  await db.prepare(
    "INSERT INTO profile_header_styles (user_id, header_style, updated_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(user_id) DO UPDATE SET header_style = excluded.header_style, updated_at = excluded.updated_at",
  ).bind(userId, style, nowSeconds()).run();
  return json({ style });
}
