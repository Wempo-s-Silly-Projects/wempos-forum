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

// Wave 2026-11-21-38. Load-tolerant timing for the parser/mask speed pins.
// An absolute millisecond reading measures the machine as much as the code:
// one preempted run on a busy CI box fails an otherwise linear scan. So the
// pins assert SHAPE first (doubling the input must not square the cost) and
// keep their absolute ceilings only as a last guard, read as best-of-N.

export const TIMING_TRIES = 7;
// Input grows 4x between the two sizes: linear work grows ~4x, quadratic
// ~16x. 8 is the geometric midpoint, so either side has a 2x margin.
export const GROWTH_FACTOR = 4;
export const LINEAR_GROWTH_CEILING = 8;
// Each timed sample repeats the call until the large input costs at least
// this much, so sub-millisecond calls are not lost in timer noise, while a
// small+large pair still fits inside one scheduler slice.
const MIN_SAMPLE_MS = 1;
export const GROWTH_PAIRS = 15;
const MAX_REPEAT = 5000;

let sink = 0; // consumes results so the JIT cannot drop the timed work
const consume = (value) => { sink = (sink + (typeof value === "string" ? value.length : 1)) | 0; };

const timeOnce = (work) => {
  const started = performance.now();
  work();
  return performance.now() - started;
};

// Fastest of `tries` runs. The minimum is the run least disturbed by other
// processes; it can only be low if the code itself is fast. `stopBelow`
// ends early once a run is already under the budget being checked.
export function bestOf(work, tries = TIMING_TRIES, stopBelow = -Infinity) {
  let best = Infinity;
  for (let i = 0; i < tries && best >= stopBelow; i += 1) best = Math.min(best, timeOnce(work));
  return best;
}

const repeated = (fn, input, times) => () => {
  for (let i = 0; i < times; i += 1) consume(fn(input));
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

// Cost growth of fn from `small` to `large` input. Under load the process
// hops between fast and slow cores, so the two sizes are never compared
// across far-apart samples: each pair (small, large) runs back to back — in
// alternating order to cancel drift — and gives its own ratio; the median
// pair ratio is reported, so fewer than half the pairs being disturbed
// cannot move it.
// v5.3 flake fix: a preemption lands in a sample with odds proportional to
// its length, so under CPU load the 4x-longer large sample is hit far more
// often than its small partner, and single readings skewed whole pairs
// upward (wave23 parseInline on "*`[~" read 8.6x, 1 run in 3 under 6
// burners). Each pair now takes the fastest of PAIR_TRIES interleaved
// readings per size: a minimum can only be low if the code is fast, so a
// quadratic scan still reads ~16x while a preempted reading drops out.
const PAIR_TRIES = 3;

function timedPair(runSmall, runLarge, smallFirst) {
  let smallMs = Infinity;
  let largeMs = Infinity;
  for (let i = 0; i < PAIR_TRIES; i += 1) {
    const first = timeOnce(smallFirst ? runSmall : runLarge);
    const second = timeOnce(smallFirst ? runLarge : runSmall);
    smallMs = Math.min(smallMs, smallFirst ? first : second);
    largeMs = Math.min(largeMs, smallFirst ? second : first);
  }
  return largeMs / Math.max(smallMs, 1e-6);
}

// A sustained disturbance (a burst of load spanning most of one window)
// can still skew a whole measurement (~1 in 300 under 6 burners after the
// pair fix). A reading at or over the ceiling is measured again, up to
// GROWTH_ATTEMPTS windows, keeping the lowest median — the same best-of
// logic as bestOf: noise only ever raises a ratio, and a real quadratic
// reads ~16x in every window (pinned by wave38-timing-harness).
const GROWTH_ATTEMPTS = 3;

function measureGrowth(runSmall, runLarge, pairs) {
  const ratios = Array.from({ length: pairs }, (_, i) => timedPair(runSmall, runLarge, i % 2 === 0));
  return { ratio: median(ratios), ratios };
}

export function growthRatio(fn, small, large, pairs = GROWTH_PAIRS) {
  for (let i = 0; i < 3; i += 1) { consume(fn(small)); consume(fn(large)); } // warm the JIT
  const single = bestOf(() => consume(fn(large)), 3);
  const times = Math.min(MAX_REPEAT, Math.max(1, Math.ceil(MIN_SAMPLE_MS / Math.max(single, 1e-3))));
  const runSmall = repeated(fn, small, times);
  const runLarge = repeated(fn, large, times);
  let best = measureGrowth(runSmall, runLarge, pairs);
  for (let attempt = 1; attempt < GROWTH_ATTEMPTS && best.ratio >= LINEAR_GROWTH_CEILING; attempt += 1) {
    const next = measureGrowth(runSmall, runLarge, pairs);
    if (next.ratio < best.ratio) best = next;
  }
  return { ratio: best.ratio, ratios: best.ratios, times, sink };
}
