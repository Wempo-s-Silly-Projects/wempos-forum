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

// After-render polish (Batch J): once a route has painted, app.js hands the
// page here. Each step loads its vendored library only when the page has
// something for it (a sortable table, a counter, an animated list), and a
// library that fails to load leaves the page exactly as rendered.
import { prefersReducedMotion } from "./focus-utils.js";
import { releaseKeepAwake } from "./keep-awake.js";
import { animateLists, motionTargets } from "./list-motion.js";
import { loadTablesort, makeTablesSortable, sortableTables } from "./sortable-tables.js";
import { countUpStats } from "./stat-count.js";
import { prepareTooltips } from "./tooltips.js";

const quietly = (promise) => promise.catch(() => {});

export function enhanceRoute(root, { win = globalThis } = {}) {
  // A wake lock asked for on the last thread never outlives it (keep-awake.js).
  releaseKeepAwake();
  prepareTooltips(root);
  const jobs = [];
  if (sortableTables(root).length) {
    jobs.push(quietly(loadTablesort().then((Tablesort) => makeTablesSortable(root, { Tablesort }))));
  }
  const still = prefersReducedMotion(win);
  if (!still && root?.querySelector?.("[data-count-up]")) {
    jobs.push(quietly(import("./vendor/countUp.js").then(({ CountUp }) => countUpStats(root, { CountUp, win }))));
  }
  if (!still && motionTargets(root).length) {
    jobs.push(quietly(import("./vendor/auto-animate.js").then(({ default: autoAnimate }) => animateLists(root, { autoAnimate, win }))));
  }
  return Promise.all(jobs);
}
