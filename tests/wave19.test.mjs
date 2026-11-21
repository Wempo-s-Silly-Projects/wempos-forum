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

// Wave 2026-11-21-19. F1 hardening of the v4.21–v4.23 delta: the shared
// spoiler mask (server output paths since v4.22) must stay linear on
// marker-heavy bodies, and a masked excerpt must never split an emoji.
import { test } from "node:test";
import assert from "node:assert/strict";
import { maskSpoilers, maskedExcerpt } from "../public/js/markdown.js";

const BODY_CAP = 4750; // MAX_COMPOSER_BODY_CHARS (api/posts-write.mjs)
// Linear work on a capped body is well under a millisecond or two; the
// quadratic scan this pins against took ~85 ms for these four bodies.
const MASK_BUDGET_MS = 30;

const fill = (unit) => ("||a|| " + unit.repeat(BODY_CAP)).slice(0, BODY_CAP);

test("maskSpoilers stays linear on marker-heavy capped bodies", () => {
  const bodies = ["*", "`", "[", "*`[~", "[](", "~"].map(fill);
  maskSpoilers(bodies[0]); // warm the JIT
  const started = performance.now();
  for (const body of bodies) maskSpoilers(body);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < MASK_BUDGET_MS, `masking took ${elapsed.toFixed(1)} ms`);
});

test("the memoized scan masks exactly what it did before", () => {
  const cases = [
    ["||unterminated", "||unterminated"],
    ["||a ||b|| c||", "▒▒▒b▒▒▒"],
    ["`||x||` ||y||", "`||x||` ▒▒▒"],
    // Bold/link/italic inner text is not re-parsed: it stays literal, as rendered.
    ["**||x||** [||l||](/p) *||e||*", "**||x||** [||l||](/p) *||e||*"],
    ["@a ||b|| ~~||c||~~", "@a ▒▒▒ ~~||c||~~"],
    ["[x] ( ||s|| )", "[x] ( ▒▒▒ )"],
  ];
  for (const [input, expected] of cases) assert.equal(maskSpoilers(input), expected, input);
});

test("maskedExcerpt never cuts a surrogate pair in half", () => {
  const out = maskedExcerpt("a".repeat(79) + "\u{1F600}x", 80);
  assert.equal(out, "a".repeat(79) + "…");
  assert.ok(out.isWellFormed());
  assert.equal(maskedExcerpt("\u{1F600}".repeat(50), 80), "\u{1F600}".repeat(40) + "…");
});
