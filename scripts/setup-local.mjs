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

// `pnpm setup:local`: one command from a fresh clone to a runnable forum.
// Writes .dev.vars with fresh random secrets ONLY when the file is missing
// (never overwrites, never prints a value), then applies every migration to
// both local D1 databases (forum data + search). Touches nothing remote.
import { randomBytes } from "node:crypto";
import { existsSync, linkSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The secrets the Worker needs to boot locally; 32 random bytes = 64 hex
// characters, inside PASSWORD_PEPPER's 32-256 range and SETUP_SECRET's 32+.
export const DEV_SECRETS = ["PASSWORD_PEPPER", "SETUP_SECRET", "RELAY_TOKEN"];

export function devVarsText(random = () => randomBytes(32).toString("hex")) {
  const lines = [
    "# Local-only secrets written by `pnpm setup:local`. Git-ignored: never commit.",
    "# See .dev.vars.example for every optional variable.",
    ...DEV_SECRETS.map((name) => name + "=" + random()),
    "HUMAN_CHECK=off",
  ];
  return lines.join("\n") + "\n";
}

// Creates the file only if it does not exist; returns whether it did. The
// text goes to a temp file first and is hard-linked into place (which fails
// if the target exists), so an interrupted write never leaves a partial
// .dev.vars that later runs would keep.
export function writeDevVars(path = join(ROOT, ".dev.vars"), text = devVarsText()) {
  const temp = path + "." + process.pid + ".tmp";
  try {
    writeFileSync(temp, text, { flag: "wx", mode: 0o600 });
    linkSync(temp, path);
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  } finally {
    rmSync(temp, { force: true });
  }
}

// Losing .dev.vars also loses the password pepper. If local D1 files remain,
// refuse to mint a replacement that would make existing local accounts
// impossible to authenticate. Restore the old .dev.vars or reset local data.
export function hasLocalD1State(root = ROOT) {
  const state = join(root, ".wrangler", "state", "v3", "d1");
  if (!existsSync(state)) return false;
  const visit = (dir) => readdirSync(dir, { withFileTypes: true }).some((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? visit(path) : /\.sqlite3?$/.test(entry.name);
  });
  return visit(state);
}

export function ensureDevVars(root = ROOT, text = devVarsText()) {
  const path = join(root, ".dev.vars");
  if (!existsSync(path) && hasLocalD1State(root)) {
    throw new Error("local D1 data exists but .dev.vars is missing; restore the original .dev.vars to preserve the password pepper, or reset local D1 data deliberately");
  }
  return writeDevVars(path, text);
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  let created;
  try {
    created = ensureDevVars();
  } catch (error) {
    process.stderr.write(error.message + "\n");
    process.exit(1);
  }
  process.stdout.write(created
    ? ".dev.vars created with fresh random secrets and HUMAN_CHECK=off.\n"
    : ".dev.vars already exists; left it untouched.\n");
  const run = spawnSync(process.execPath, [join(ROOT, "scripts", "migrate-local.mjs")], {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
  });
  if (run.error) throw run.error;
  if (run.status !== 0) process.exit(run.status ?? 1);
  process.stdout.write("Local databases are migrated. Start the forum with pnpm dev, then open http://localhost:8787/setup.\n");
}
