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

// Wave 2026-11-21-15 F1: raw-text spoiler masking must hide exactly what the
// post renderer hides. The renderer parses block by block (list items and
// quote lines one at a time, code fences never) and lets code/bold/link spans
// win, so a "||" inside code must not pair with a real spoiler's opener and
// leave the spoiler's text bare in excerpts, previews and read-aloud.
import { test } from "node:test";
import assert from "node:assert/strict";
import { maskSpoilers } from "../public/js/markdown.js";
import { threadExcerpt } from "../public/js/profile-extras.js";

const LEAKY_BODIES = [
  "run `a || b` first. Ending: ||he dies||",
  "```\nx || y\n```\nEnding: ||he dies||",
  "**a||b** c ||he dies||",
  "- ||open item\n||he dies||",
  "> quote ||\n||he dies||",
];

test("maskSpoilers never leaves rendered spoiler text bare", () => {
  for (const body of LEAKY_BODIES) {
    assert.doesNotMatch(maskSpoilers(body), /he dies/, body);
    assert.doesNotMatch(threadExcerpt(body), /he dies/, body);
  }
});

test("maskSpoilers keeps ordinary text and plain spoilers as before", () => {
  assert.equal(maskSpoilers("it ends when ||he dies|| lol"), "it ends when ▒▒▒ lol");
  assert.equal(maskSpoilers("a || b"), "a || b");
  assert.equal(maskSpoilers("- one ||x||\n- two"), "- one ▒▒▒\n- two");
  assert.equal(maskSpoilers("```\n||kept||\n```"), "```\n||kept||\n```");
  assert.equal(maskSpoilers(null), "");
});
