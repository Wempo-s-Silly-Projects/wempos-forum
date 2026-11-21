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

// Wave 2026-11-21-38. The speed pins in wave19/wave23 now assert growth
// shape (4x input -> < 8x cost) instead of trusting one millisecond reading.
// This file proves that check has teeth on this machine: a known quadratic
// scan must trip it and a known linear scan must not, so a regression of
// markdown.js to O(n^2) cannot slip past a ratio that never fires.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GROWTH_FACTOR, LINEAR_GROWTH_CEILING, TIMING_TRIES, bestOf, growthRatio } from "./helpers/timing.mjs";

const LARGE = 4750; // MAX_COMPOSER_BODY_CHARS (api/posts-write.mjs)
const SMALL = Math.floor(LARGE / GROWTH_FACTOR);
const text = (length) => "a*`[~|".repeat(length).slice(0, length);

const linearScan = (s) => {
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  return hash;
};
// Re-reads the prefix for every character: the shape of the pre-v4.22 mask.
const quadraticScan = (s) => {
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) {
    for (let j = 0; j <= i; j += 1) hash = (hash + s.charCodeAt(j)) | 0;
  }
  return hash;
};

test("the growth check flags a quadratic scan", () => {
  const { ratio } = growthRatio(quadraticScan, text(SMALL), text(LARGE));
  assert.ok(ratio >= LINEAR_GROWTH_CEILING, `quadratic scan grew only ${ratio.toFixed(1)}x`);
});

test("the growth check passes a linear scan", () => {
  const { ratio } = growthRatio(linearScan, text(SMALL), text(LARGE));
  assert.ok(ratio < LINEAR_GROWTH_CEILING, `linear scan grew ${ratio.toFixed(1)}x`);
});

test("bestOf runs every try, or stops at the first run under the budget", () => {
  let calls = 0;
  const work = () => { calls += 1; };
  const best = bestOf(work, TIMING_TRIES);
  assert.equal(calls, TIMING_TRIES);
  assert.ok(Number.isFinite(best) && best >= 0);
  calls = 0;
  bestOf(work, TIMING_TRIES, Infinity); // every run is under an infinite budget
  assert.equal(calls, 1);
});
