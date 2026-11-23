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

// Module routes (docs/modules.md).
//   GET /api/site            public: the ids of the modules that are ON (no
//                            env names, secrets or owner rows).
//   GET /api/admin/modules   owner only: every module with its state and why.
//   PUT /api/admin/modules   owner only (CSRF): {id, enabled} stores the
//                            owner's choice in instance_modules.
import { requireAdmin } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson, requireMutationApplied } from "./core/http.mjs";
import {
  MODULES, dependentsOf, forgetModuleStates, moduleById, moduleEnvName, moduleStates, onModuleIds,
} from "./core/modules.mjs";
import { ROLE_OWNER_DB } from "./core/roles.mjs";
import { ACTIVE_BAN_SQL } from "./core/visibility.mjs";

// The write lands only while the caller is still an unbanned owner (stored
// role literal; never user input), so a demotion or ban between the session
// read and the write refuses through requireMutationApplied.
const SAVE_SQL =
  "INSERT INTO instance_modules (id, enabled, updated_at, updated_by) " +
  "SELECT ?, ?, ?, u.id FROM users u WHERE u.id = ? AND u.role = '" + ROLE_OWNER_DB + "' " +
  "AND NOT " + ACTIVE_BAN_SQL("u.id") + " " +
  "ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, " +
  "updated_at = excluded.updated_at, updated_by = excluded.updated_by";

async function moduleList(env, request) {
  const states = await moduleStates(env, request);
  return MODULES.map((module) => {
    const state = states.get(module.id);
    return {
      id: module.id,
      labelKey: module.labelKey,
      descriptionKey: module.descriptionKey,
      default: module.default,
      deps: [...module.deps],
      dependents: dependentsOf(module.id),
      readOnly: module.readOnly,
      envVar: module.envKill ?? moduleEnvName(module.id),
      enabled: state.enabled,
      reason: state.reason,
      stored: state.stored,
    };
  });
}

async function readSite(request, env) {
  await rateLimit(request, env, "read");
  return json({ modules: await onModuleIds(env, request) }, 200, { "Cache-Control": "no-store" });
}

async function readAdminModules(request, env) {
  await requireAdmin(request, env, false);
  await rateLimit(request, env, "read");
  return json({ modules: await moduleList(env, request) }, 200, { "Cache-Control": "no-store" });
}

function parseSave(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Send the module id and whether it is on.");
  }
  const module = typeof body.id === "string" ? moduleById(body.id) : null;
  if (!module) throw new HttpError(400, "That module does not exist.");
  if (module.readOnly) throw new HttpError(400, "That module is set on the server; change it there.");
  if (typeof body.enabled !== "boolean") throw new HttpError(400, "Send whether the module is on as true or false.");
  return { id: module.id, enabled: body.enabled };
}

async function saveAdminModule(request, env) {
  const session = await requireAdmin(request, env);
  await rateLimit(request, env, "write");
  const { id, enabled } = parseSave(await readJson(request));
  const result = await env.FORUM_DB.prepare(SAVE_SQL)
    .bind(id, enabled ? 1 : 0, nowSeconds(), session.user.id).run();
  requireMutationApplied(result);
  forgetModuleStates(request);
  return json({ saved: true, modules: await moduleList(env, request) });
}

export async function handleModuleRoutes(request, env, url, path, method) {
  if (path === "/api/site") {
    if (method !== "GET") throw new HttpError(405, "That method is not supported.");
    return readSite(request, env);
  }
  if (path !== "/api/admin/modules") return null;
  if (method === "GET") return readAdminModules(request, env);
  if (method === "PUT") return saveAdminModule(request, env);
  throw new HttpError(405, "That method is not supported.");
}
