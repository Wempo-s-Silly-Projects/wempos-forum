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

// Optional pronouns (v5.23.0 F2). Opt-in and empty by default: a member with
// no profile_pronouns row has none. PUT /api/me/pronouns is the only write —
// signed in, CSRF-checked (requireUser), not banned, rate-limited per member
// on the shared write tier — and an empty value deletes the row. Reads ride
// the profile payload (api/profiles.mjs), which already refuses block pairs,
// and the Download-my-data export (api/export.mjs).
import { assertNotBanned, requireUser } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { applyWordFilter, containsFilteredWord, normalizeUsernameForFilter } from "./filter.mjs";
import { filterWords } from "./filterstore.mjs";

export const PRONOUNS_PATTERN = /^[A-Za-z][A-Za-z /-]{0,23}$/;
const PRONOUNS_INVALID = "Pronouns can use letters, spaces, / and - only, up to 24 characters.";
const PRONOUNS_NOT_ALLOWED = "Those pronouns can't be used here.";

// "" = clear (empty, blank or null); the trimmed value when it passes the
// pattern; null = invalid. Pure, so the validation table tests it directly.
export function normalizePronouns(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return "";
  return PRONOUNS_PATTERN.test(trimmed) ? trimmed : null;
}

// The member's own pronouns, or "" when they never set any.
export async function readPronouns(db, userId) {
  const row = await db.prepare("SELECT pronouns FROM profile_pronouns WHERE user_id = ? LIMIT 1")
    .bind(Number(userId)).first();
  return row ? String(row.pronouns) : "";
}

// Identity text like a social handle: a filtered word is refused, never
// masked (masked #s would also fail the pattern on the next save).
function assertNotFiltered(env, pronouns) {
  const words = filterWords(env);
  if (applyWordFilter(pronouns, words) !== pronouns ||
      containsFilteredWord(normalizeUsernameForFilter(pronouns), words)) {
    throw new HttpError(400, PRONOUNS_NOT_ALLOWED);
  }
}

export async function handlePronounsRoutes(request, env, url, path, method) {
  if (path !== "/api/me/pronouns" || method !== "PUT") return null;
  const session = await requireUser(request, env);
  const userId = Number(session.user.id);
  await assertNotBanned(env, userId);
  await rateLimit(request, env, "write", String(userId));
  const body = await readJson(request);
  const pronouns = normalizePronouns(body?.pronouns);
  if (pronouns === null) throw new HttpError(400, PRONOUNS_INVALID);
  const db = env.FORUM_DB;
  if (pronouns === "") {
    await db.prepare("DELETE FROM profile_pronouns WHERE user_id = ?").bind(userId).run();
    return json({ pronouns: "" });
  }
  assertNotFiltered(env, pronouns);
  await db.prepare(
    "INSERT INTO profile_pronouns (user_id, pronouns, updated_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(user_id) DO UPDATE SET pronouns = excluded.pronouns, updated_at = excluded.updated_at",
  ).bind(userId, pronouns, nowSeconds()).run();
  return json({ pronouns });
}
