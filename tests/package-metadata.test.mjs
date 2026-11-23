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

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

test("package metadata permits publication and declares the supported runtime", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.name, /^[a-z0-9][a-z0-9._-]*$/);
  assert.match(pkg.version, /^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(pkg.private, false, "the package must not be marked private");
  assert.equal(pkg.license, "AGPL-3.0-or-later");
  assert.equal(pkg.type, "module");
  assert.equal(pkg.engines?.node, ">=22");
  assert.equal(pkg.scripts?.test, "node --test");
});

test("every declared runtime and development dependency has a matching pnpm lock entry", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = read("pnpm-lock.yaml");
  assert.match(lock, /^lockfileVersion: ['"]?9\\.0/m);

  const groups = [
    ["dependencies", pkg.dependencies ?? {}],
    ["devDependencies", pkg.devDependencies ?? {}],
  ];
  for (const [group, dependencies] of groups) {
    assert.ok(Object.keys(dependencies).length > 0, group + " are declared");
    for (const [name, specifier] of Object.entries(dependencies)) {
      const escapedName = name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
      const escapedSpecifier = String(specifier).replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
      const entry = new RegExp(
        `^      ['"]?${escapedName}['"]?:\\n        specifier: ${escapedSpecifier}\\n        version: \\S+`,
        "m",
      );
      assert.match(lock, entry, group + ": " + name + " has a resolved lockfile entry");
    }
  }
});
