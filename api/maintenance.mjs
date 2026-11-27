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
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// Site-wide maintenance control. The single site_settings row is the source
// of truth; the Worker checks it before dispatching API traffic. This module
// owns the owner-only switch, not the public maintenance page or its copy.
import { requireAdmin } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { maintenanceEnabled, setMaintenanceCache } from "./core/maintenance-state.mjs";
export { maintenanceEnabled };

export const MAINTENANCE_SETTING = "maintenance_mode";

// D1 writes and their cache updates must commit in the same order. A promise
// tail serializes writes within this isolate; D1 remains the cross-isolate
// source of truth and the shared reader refreshes its short-lived cache.
let maintenanceWriteQueue = Promise.resolve();

async function readMaintenanceState(request, env) {
  await requireAdmin(request, env, false);
  await rateLimit(request, env, "read");
  return json({ enabled: await maintenanceEnabled(env) }, 200, { "Cache-Control": "no-store" });
}

async function saveMaintenanceState(request, env) {
  await requireAdmin(request, env);
  await rateLimit(request, env, "write");
  const body = await readJson(request);
  if (!body || typeof body.enabled !== "boolean" || Object.keys(body).join() !== "enabled") {
    throw new HttpError(400, "Send enabled as true or false.");
  }
  const write = async () => {
    await env.FORUM_DB.prepare(
      "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ).bind(MAINTENANCE_SETTING, body.enabled ? "1" : "0", nowSeconds()).run();
    setMaintenanceCache(body.enabled);
    return json({ saved: true, enabled: body.enabled }, 200, { "Cache-Control": "no-store" });
  };
  const pending = maintenanceWriteQueue.then(write, write);
  maintenanceWriteQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

export async function handleMaintenanceRoutes(request, env, url, path, method) {
  if (path !== "/api/admin/maintenance") return null;
  if (method === "GET") return readMaintenanceState(request, env);
  if (method === "PUT") return saveMaintenanceState(request, env);
  throw new HttpError(405, "That method is not supported.");
}
