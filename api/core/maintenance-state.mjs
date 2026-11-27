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

// Shared maintenance-state reader. Kept below auth and route composition so
// session creation can enforce owner-only sign-in without a circular import.
import { HttpError } from "./http.mjs";

export const MAINTENANCE_SETTING = "maintenance_mode";
const CACHE_MS = 2000;
let cachedState = null;
let cachedAt = 0;

export async function maintenanceEnabled(env) {
  const now = Date.now();
  if (cachedState !== null && now - cachedAt < CACHE_MS) return cachedState;
  try {
    const row = await env.FORUM_DB.prepare(
      "SELECT value FROM site_settings WHERE key = ? LIMIT 1",
    ).bind(MAINTENANCE_SETTING).first();
    cachedState = String(row?.value ?? "") === "1";
    cachedAt = now;
    return cachedState;
  } catch (error) {
    console.error("Could not read maintenance state; preserving the last known state:", error);
    // Unknown must not silently reopen a forum that may already be in
    // maintenance. A cold isolate starts closed until D1 confirms otherwise.
    if (cachedState === null) cachedState = true;
    cachedAt = now;
    return cachedState;
  }
}

export async function setMaintenanceCache(enabled) {
  cachedState = enabled === true;
  cachedAt = Date.now();
}

export async function assertMaintenanceLoginAllowed(env, userId) {
  if (userId === null || !(await maintenanceEnabled(env))) return;
  // users.role is the frozen database vocabulary: 'admin' means the public
  // owner role; 'moderator' means a public admin and is intentionally denied.
  const row = await env.FORUM_DB.prepare(
    "SELECT role FROM users WHERE id = ? LIMIT 1",
  ).bind(Number(userId)).first();
  if (row?.role !== "admin") {
    throw new HttpError(503, "The forum is in maintenance mode. Only the owner can sign in right now.", {
      "Retry-After": "60",
    });
  }
}
