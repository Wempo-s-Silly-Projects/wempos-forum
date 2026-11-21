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

// Wave 2026-11-21-23 F1: an independent property check of the v4.24 inline
// parser (forward-cached finders). Seeded adversarial bodies — nested and
// overlapping markers, unterminated runs, links of every scheme, mentions,
// surrogates/RTL marks, capped 4750-char posts — must keep four properties.
import { test } from "node:test";
import assert from "node:assert/strict";
import { maskSpoilers, parseBlocks, parseInline } from "../public/js/markdown.js";
import { makeFakeDocument } from "./helpers/fake-dom.mjs";
import {
  BODY_CAP, PATHOLOGICAL_UNITS, checkConservation, generateBody, inlineRunsOf, makeRng,
  pathologicalBody, spoilerSecrets,
} from "./helpers/markdown-fuzz.mjs";
import { GROWTH_FACTOR, LINEAR_GROWTH_CEILING, TIMING_TRIES, bestOf, growthRatio } from "./helpers/timing.mjs";

const SEED = 23;
const BODY_COUNT = 1500;
const TIME_BUDGET_MS = 5;

const doc = makeFakeDocument();
const rng = makeRng(SEED);
const bodies = [
  ...Array.from({ length: BODY_COUNT }, () => generateBody(rng)),
  ...PATHOLOGICAL_UNITS.map(pathologicalBody),
];
const runsOf = (body) => [body, ...inlineRunsOf(parseBlocks(body))];

test("the generator reaches capped bodies and spoilers", () => {
  assert.ok(bodies.filter((body) => body.length === BODY_CAP).length > 100);
  const spoilerRuns = bodies.flatMap((body) => inlineRunsOf(parseBlocks(body)))
    .filter((run) => spoilerSecrets(parseInline(doc, run)).length > 0);
  assert.ok(spoilerRuns.length > 100, `only ${spoilerRuns.length} runs rendered a secret spoiler`);
});

test("rendered text is the input minus consumed markers, and hrefs are safe", () => {
  for (const body of bodies) {
    for (const run of runsOf(body)) {
      const fault = checkConservation(run, parseInline(doc, run));
      assert.equal(fault, null, `${fault} in ${JSON.stringify(run.slice(0, 120))}`);
    }
  }
});

test("maskSpoilers never shows a character the post page renders inside a spoiler", () => {
  for (const body of bodies) {
    const hidden = inlineRunsOf(parseBlocks(body)).flatMap((run) => spoilerSecrets(parseInline(doc, run)));
    const masked = maskSpoilers(body);
    const leaked = hidden.filter((ch) => masked.includes(ch));
    assert.deepEqual(leaked, [], JSON.stringify(body.slice(0, 120)));
  }
});

test("parse and mask grow linearly on every pathological unit", () => {
  const parse = (body) => parseInline(doc, body);
  for (const unit of PATHOLOGICAL_UNITS) {
    const small = pathologicalBody(unit, Math.floor(BODY_CAP / GROWTH_FACTOR));
    const large = pathologicalBody(unit);
    for (const [name, fn] of [["parseInline", parse], ["maskSpoilers", maskSpoilers]]) {
      const { ratio } = growthRatio(fn, small, large);
      assert.ok(ratio < LINEAR_GROWTH_CEILING, `${name} on ${JSON.stringify(unit)}: 4x input cost ${ratio.toFixed(1)}x`);
    }
  }
});

test("parse and mask stay under 5 ms on every capped body", () => {
  // Best of N, stopping once a run is under budget: the budget still has to
  // be met by a real run, but one preempted run can no longer fail the pin.
  const best = (work) => bestOf(work, TIMING_TRIES, TIME_BUDGET_MS);
  const capped = bodies.filter((body) => body.length === BODY_CAP);
  for (const body of capped.slice(0, 50)) parseInline(doc, body); // warm the JIT
  let worst = 0;
  for (const body of capped) {
    worst = Math.max(worst, best(() => parseInline(doc, body)), best(() => maskSpoilers(body)));
  }
  assert.ok(worst < TIME_BUDGET_MS, `worst capped body took ${worst.toFixed(2)} ms (best of ${TIMING_TRIES})`);
});
