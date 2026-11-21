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
export function growthRatio(fn, small, large, pairs = GROWTH_PAIRS) {
  for (let i = 0; i < 3; i += 1) { consume(fn(small)); consume(fn(large)); } // warm the JIT
  const single = bestOf(() => consume(fn(large)), 3);
  const times = Math.min(MAX_REPEAT, Math.max(1, Math.ceil(MIN_SAMPLE_MS / Math.max(single, 1e-3))));
  const runSmall = repeated(fn, small, times);
  const runLarge = repeated(fn, large, times);
  const ratios = [];
  for (let i = 0; i < pairs; i += 1) {
    const smallFirst = i % 2 === 0;
    const first = timeOnce(smallFirst ? runSmall : runLarge);
    const second = timeOnce(smallFirst ? runLarge : runSmall);
    const [smallMs, largeMs] = smallFirst ? [first, second] : [second, first];
    ratios.push(largeMs / Math.max(smallMs, 1e-6));
  }
  return { ratio: median(ratios), ratios, times, sink };
}
