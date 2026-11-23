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

// Saturday Fools (owner order, Nov 22): the per-deployment switch and the
// owner's site-wide off switch. The shell carries <meta name="saturday-fools"
// content="on"> only when env SATURDAY_FOOLS is exactly "on" AND the owner has
// not forced it off (site_settings saturday_fools_off = "1"); with no meta the
// client never loads the gag code. GET/POST /api/admin/saturday-fools are
// owner-only (requireAdmin: the owner tier, not regular staff). Members have
// no opt-out (owner order, 23:13). No migration: the switch is one row in the
// existing site_settings table.
import { DEFAULT_SATURDAY_FOOLS, SATURDAY_FOOLS_MODES, SATURDAY_FOOLS_OFF_SETTING } from "../constants.mjs";
import { requireAdmin } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";

// The deployment's mode: "on" only for exactly "on".
export function saturdayFoolsMode(env) {
  return env?.SATURDAY_FOOLS === SATURDAY_FOOLS_MODES.ON ? SATURDAY_FOOLS_MODES.ON : DEFAULT_SATURDAY_FOOLS;
}

// True when the owner forced it off. A failed read logs and reads as forced
// off: a settings hiccup never turns a gag on.
export async function readFoolsForcedOff(env) {
  if (!env?.FORUM_DB) return false;
  try {
    const row = await env.FORUM_DB.prepare("SELECT value FROM site_settings WHERE key = ? LIMIT 1")
      .bind(SATURDAY_FOOLS_OFF_SETTING).first();
    return String(row?.value ?? "") === "1";
  } catch (error) {
    console.error("Could not read the Saturday Fools switch; treating it as off:", error);
    return true;
  }
}

// The shell meta value: "on" or "" (no meta). The env check comes first, so a
// deployment with it off never queries D1 for it.
export async function saturdayFoolsMeta(env) {
  if (saturdayFoolsMode(env) !== SATURDAY_FOOLS_MODES.ON) return "";
  return (await readFoolsForcedOff(env)) ? "" : SATURDAY_FOOLS_MODES.ON;
}

async function foolsState(env) {
  const forcedOff = await readFoolsForcedOff(env);
  const mode = saturdayFoolsMode(env);
  return { mode, forcedOff, active: mode === SATURDAY_FOOLS_MODES.ON && !forcedOff };
}

async function saveFoolsSwitch(request, env) {
  await requireAdmin(request, env);
  await rateLimit(request, env, "write");
  const body = await readJson(request);
  if (!body || typeof body !== "object" || typeof body.forcedOff !== "boolean") {
    throw new HttpError(400, "Send forcedOff as true or false.");
  }
  await env.FORUM_DB.prepare(
    "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).bind(SATURDAY_FOOLS_OFF_SETTING, body.forcedOff ? "1" : "0", nowSeconds()).run();
  return json({ saved: true, ...(await foolsState(env)) });
}

export async function handleSaturdayFoolsRoutes(request, env, url, path, method) {
  if (path !== "/api/admin/saturday-fools") return null;
  if (method === "GET") {
    await requireAdmin(request, env, false);
    return json(await foolsState(env));
  }
  if (method === "POST") return saveFoolsSwitch(request, env);
  return null;
}
