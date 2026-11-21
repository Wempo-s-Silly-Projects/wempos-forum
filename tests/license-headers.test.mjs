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

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXCLUDED = [join(ROOT, "public", "js", "vendor"), join(ROOT, "api", "vendor")];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (EXCLUDED.some((excluded) => full === excluded || full.startsWith(excluded + "/"))) return [];
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(mjs|js)$/.test(name) ? [full] : [];
  });
}

const serverFiles = [...walk(join(ROOT, "api")), join(ROOT, "worker.mjs")];
const clientFiles = walk(join(ROOT, "public", "js"));

const missingHeader = (list) => list.filter((file) => {
  const text = readFileSync(file, "utf8");
  return !text.startsWith("// Copyright 2026 ItsWempo") || !text.includes("GNU Affero General Public License");
}).map((file) => relative(ROOT, file));

const badShape = (list) => list.filter((file) => {
  const lines = readFileSync(file, "utf8").split("\n");
  return !(lines.slice(0, 17).every((line) => line.startsWith("//")) && lines[16].includes("gnu.org/licenses/"));
}).map((file) => relative(ROOT, file));

test("the scan finds source files in both trees", () => {
  assert.ok(serverFiles.length > 30, "server files: " + serverFiles.length);
  assert.ok(clientFiles.length > 30, "client files: " + clientFiles.length);
});

test("api/** and worker.mjs start with the AGPLv3 header", () => {
  assert.deepEqual(missingHeader(serverFiles), []);
});

test("api/** and worker.mjs headers carry the 17-line template shape", () => {
  assert.deepEqual(badShape(serverFiles), []);
});

test("public/js/** (non-vendor) start with the AGPLv3 header", {
  todo: "BUG: 45 of 47 public/js files carry no AGPLv3 header (e.g. public/js/api.js:1, public/js/app.js:1)",
}, () => {
  assert.deepEqual(missingHeader(clientFiles), []);
});
