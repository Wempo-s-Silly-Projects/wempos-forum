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

// REUSE 3.3 + versioning policy (v5.21.0): the license text lives under
// LICENSES/ byte-identical to LICENSE.txt, REUSE.toml covers the files that
// cannot carry a comment header (and the vendored ones, unedited), CI runs
// `reuse lint` with a SHA-pinned action, and CONTRIBUTING.md declares the
// SemVer public API that README and CHANGELOG point at.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const url = (path) => new URL("../" + path, import.meta.url);
const read = (path) => readFileSync(url(path), "utf8");

test("LICENSES/AGPL-3.0-or-later.txt is byte-identical to LICENSE.txt", () => {
  assert.ok(existsSync(url("LICENSES/AGPL-3.0-or-later.txt")));
  assert.ok(readFileSync(url("LICENSES/AGPL-3.0-or-later.txt")).equals(readFileSync(url("LICENSE.txt"))));
});

test("REUSE.toml covers locales, icons, the lockfile and the vendored files", () => {
  const toml = read("REUSE.toml");
  assert.match(toml, /^version = 1$/m);
  for (const path of ["public/locales/**", "public/icons/**", "pnpm-lock.yaml", "api/vendor/**"]) {
    assert.ok(toml.includes(`"${path}"`), path);
  }
  assert.match(toml, /AGPL-3\.0-or-later/);
});

test("the REUSE workflow is read-only, SHA-pinned and runs on main pushes and PRs", () => {
  const yml = read(".github/workflows/reuse.yml");
  assert.match(yml, /permissions:\s*\n\s+contents: read/);
  assert.match(yml, /uses: fsfe\/reuse-action@[0-9a-f]{40} # v\d/);
  assert.match(yml, /uses: (?:actions|useblacksmith)\/checkout@[0-9a-f]{40} # v\d/);
  assert.match(yml, /push:\s*\n\s+branches: \[main\]/);
  assert.match(yml, /pull_request:/);
});

test("CONTRIBUTING.md declares the SemVer public API; README and CHANGELOG link it", () => {
  const contributing = read("CONTRIBUTING.md");
  const section = /## Versioning\n[\s\S]*?(?=\n## |$)/.exec(contributing)?.[0] ?? "";
  assert.ok(section, "a ## Versioning section exists");
  for (const needle of [/SemVer 2\.0\.0|Semantic Versioning 2\.0\.0/, /\/api\//, /MCP tool/, /wrangler\.example\.toml/, /migrations\//, /MAJOR/, /MINOR/, /PATCH/, /Deprecated/, /CalVer/]) {
    assert.match(section, needle);
  }
  assert.match(read("README.md"), /CONTRIBUTING\.md#versioning/);
  assert.match(read("CHANGELOG.md").split("\n## [")[0], /CONTRIBUTING\.md#versioning/);
});
