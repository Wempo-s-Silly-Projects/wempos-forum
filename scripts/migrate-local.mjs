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

// `pnpm run db:migrate:local`: applies migrations to the local forum database
// and, when wrangler.toml binds SEARCH_DB, to the local search database too.
// Plain Node instead of `${VAR:-default}` so it also runs under Windows' shell.
//   D1_DATABASE         optional, must match FORUM_DB database_name
//   D1_SEARCH_DATABASE  optional, must match SEARCH_DB database_name
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Read only top-level [[d1_databases]] blocks. The CLI needs each
// configured database_name, not the binding name, to select migrations_dir.
export function d1DatabaseNames(toml) {
  const names = new Map();
  let current = null;
  const save = () => {
    if (current?.binding && current?.database_name) names.set(current.binding, current.database_name);
    current = null;
  };
  for (const line of toml.split(/\r?\n/)) {
    if (line.trim() === "[[d1_databases]]") {
      save();
      current = {};
      continue;
    }
    if (/^\s*\[/.test(line)) {
      save();
      continue;
    }
    if (!current) continue;
    const binding = /^\s*binding\s*=\s*"([^"]+)"/.exec(line);
    const database = /^\s*database_name\s*=\s*"([^"]+)"/.exec(line);
    if (binding) current.binding = binding[1];
    if (database) current.database_name = database[1];
  }
  save();
  return names;
}

export function hasSearchBinding(toml) {
  return d1DatabaseNames(toml).has("SEARCH_DB");
}

export function migrationTargets(env, toml) {
  const names = d1DatabaseNames(toml);
  const forum = names.get("FORUM_DB") || env.D1_DATABASE || "wempo-forum-data";
  const search = names.get("SEARCH_DB");
  if (env.D1_DATABASE && names.has("FORUM_DB") && env.D1_DATABASE !== forum) {
    throw new Error("D1_DATABASE must match the FORUM_DB database_name in wrangler.toml; edit the binding instead");
  }
  if (env.D1_SEARCH_DATABASE && env.D1_SEARCH_DATABASE !== search) {
    throw new Error("D1_SEARCH_DATABASE must match the SEARCH_DB database_name in wrangler.toml; edit the binding instead");
  }
  return [forum, ...(search ? [search] : [])];
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const toml = readFileSync(join(ROOT, "wrangler.toml"), "utf8");
  const wrangler = join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
  for (const db of migrationTargets(process.env, toml)) {
    const run = spawnSync(process.execPath, [wrangler, "d1", "migrations", "apply", db, "--local"], {
      cwd: ROOT,
      stdio: "inherit",
      shell: false,
    });
    if (run.error) throw run.error;
    if (run.status !== 0) process.exit(run.status ?? 1);
  }
}
