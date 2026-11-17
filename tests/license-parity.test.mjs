// Copyright 2026 YourLocalGoober
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

// License-parity (ruled extension): the substitution allow-list's project-name
// pair, carried here because the cross-repo gates LIVE in GooberCord's
// contract-parity test — the twin set is enumerated 1:1 from that gate. Both
// repos' tests carry both named constants, each mapping the other repo's name
// into its own; this file carries the forum side of the ruled once-per-file
// bound: each parity-locked twin, once it carries a part-of line at all, must
// carry this project's token exactly once per file and the other project's
// part-of token zero times — green while tokens are absent, red on any
// duplicated or cross-repo rebranded notice. The whole-file equality gates are
// unchanged (they live on the GC side, after substitution, and stay hard).
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const HERE = path.dirname(new URL(import.meta.url).pathname);

const FORUM_PROJECT = "Wempo's Forum";
const GOOBER_PROJECT = "GooberCord";

const TWIN_FILES = [
  "api/core/auth.mjs",
  "api/core/passwords.mjs",
  "api/core/totp.mjs",
  "api/core/images.mjs",
  "api/filter.mjs",
];

// The other repo's name maps into our own — the same shape the GC-side
// vendorize() applies in the reverse direction. No regex, no wildcards.
function goobify(text) {
  return text.replaceAll(GOOBER_PROJECT, FORUM_PROJECT);
}

test("the ruled name pair maps the other project into this one", () => {
  assert.equal(goobify("part of " + GOOBER_PROJECT), `part of ${FORUM_PROJECT}`);
  assert.equal(goobify(FORUM_PROJECT), FORUM_PROJECT, "the map is one-way per repo");
});

test("each parity-locked twin carries its own project token exactly once per file", () => {
  const PART_OF = "This file is part of ";
  for (const name of TWIN_FILES) {
    const text = readFileSync(path.resolve(HERE, "..", name), "utf-8");
    // A stray GC notice would not just count wrong — it is mapped into our own
    // name first, so the once-per-file bound catches even a rebranded copy.
    const mapped = goobify(text);
    if (!mapped.includes(PART_OF)) continue;
    const mine = `${PART_OF}${FORUM_PROJECT}.`;
    assert.equal(
      mapped.split(mine).length - 1,
      1,
      `${name}: the own project token must appear exactly once per file (after the ruled name map)`,
    );
    const theirs = `${PART_OF}${GOOBER_PROJECT}.`;
    assert.equal(
      mapped.split(theirs).length - 1,
      0,
      `${name}: the other project's part-of token must never appear here`,
    );
  }
});
