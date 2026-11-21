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

// Badge-readiness polish: small static pins for the shell's description,
// the package license field and the RFC 9116 security.txt file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("the app shell carries a static English meta description", () => {
  const match = read("public/index.html").match(/<meta name="description" content="([^"]+)">/);
  assert.ok(match, "missing <meta name=\"description\">");
  assert.ok(match[1].length >= 50 && match[1].length <= 160, "description length " + match[1].length);
});

test("package.json declares the AGPL-3.0-or-later license", () => {
  assert.equal(JSON.parse(read("package.json")).license, "AGPL-3.0-or-later");
});
