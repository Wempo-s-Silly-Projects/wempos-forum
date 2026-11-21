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

test("public/js/** (non-vendor) start with the AGPLv3 header", () => {
  assert.deepEqual(missingHeader(clientFiles), []);
});

test("public/js/** (non-vendor) headers carry the 17-line template shape", () => {
  assert.deepEqual(badShape(clientFiles), []);
});

const cssFiles = readdirSync(join(ROOT, "public"))
  .filter((name) => name.endsWith(".css"))
  .map((name) => join(ROOT, "public", name));

test("public/*.css start with the AGPLv3 header in /* */ form", () => {
  assert.ok(cssFiles.length > 0, "css files: " + cssFiles.length);
  const bad = cssFiles.filter((file) => {
    const lines = readFileSync(file, "utf8").split("\n");
    return !(lines[0] === "/*" && lines[1] === " * Copyright 2026 ItsWempo"
      && lines[17] === " * see <https://www.gnu.org/licenses/>." && lines[18] === " */");
  }).map((file) => relative(ROOT, file));
  assert.deepEqual(bad, []);
});

// SPDX + REUSE 3.3 (v5.21.0): directly after the untouched 17-line notice
// (19-line block for CSS) every first-party source file carries the SPDX
// license identifier and the SPDX copyright line. The tag text is split so
// `reuse lint` never mistakes this test's own literals for a license tag.
const SPDX_ID = "SPDX-" + "License-Identifier: AGPL-3.0-or-later";
const SPDX_COPYRIGHT = "SPDX-" + "FileCopyrightText: 2026 ItsWempo";

const testFiles = walk(join(ROOT, "tests"));
const scriptFiles = walk(join(ROOT, "scripts"));
const rootFiles = readdirSync(ROOT).filter((name) => /\.(mjs|js)$/.test(name)).map((name) => join(ROOT, name));
const everyScriptFile = [...serverFiles, ...clientFiles, ...testFiles, ...scriptFiles, ...rootFiles];

test("the SPDX scan covers tests/, scripts/ and the root modules too", () => {
  assert.ok(testFiles.length > 50, "test files: " + testFiles.length);
  assert.ok(scriptFiles.length > 0, "script files: " + scriptFiles.length);
  assert.ok(rootFiles.some((file) => file.endsWith("worker.mjs")), "root files include worker.mjs");
});

test("tests/, scripts/ and root modules carry the AGPLv3 17-line header too", () => {
  const rest = [...testFiles, ...scriptFiles, ...rootFiles];
  assert.deepEqual(missingHeader(rest), []);
  assert.deepEqual(badShape(rest), []);
});

test("every first-party .js/.mjs carries the SPDX lines right after the 17-line notice", () => {
  const bad = everyScriptFile.filter((file) => {
    const lines = readFileSync(file, "utf8").split("\n");
    return !(lines[16] === "// see <https://www.gnu.org/licenses/>."
      && lines[17] === "// " + SPDX_ID && lines[18] === "// " + SPDX_COPYRIGHT && lines[19] === "");
  }).map((file) => relative(ROOT, file));
  assert.deepEqual(bad, []);
});

test("public/*.css carry the SPDX lines right after the /* */ notice", () => {
  const bad = cssFiles.filter((file) => {
    const lines = readFileSync(file, "utf8").split("\n");
    return !(lines[18] === " */" && lines[19] === "/* " + SPDX_ID + " */"
      && lines[20] === "/* " + SPDX_COPYRIGHT + " */" && lines[21] === "");
  }).map((file) => relative(ROOT, file));
  assert.deepEqual(bad, []);
});

test("vendored-verbatim files stay out of the SPDX template", () => {
  for (const file of walk(join(ROOT, "api")).concat(walk(join(ROOT, "public", "js")))) {
    assert.ok(!file.includes("/vendor/"), "walk never enters a vendor dir: " + relative(ROOT, file));
  }
});
