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

// Route progress bar (Batch J): the vendored NProgress (MIT) draws a thin
// bar along the top of the page while a route fetches its data. It is
// decorative (the status bar and page title already announce the page), the
// spinner is off, and under prefers-reduced-motion it neither trickles nor
// animates. A failed load just means no bar; navigation never waits on it.
import { prefersReducedMotion } from "./focus-utils.js";
import { loadVendorScripts } from "./vendor-load.js";

export const NPROGRESS_SRC = "/js/vendor/nprogress.js";
const BAR_SPEED_MS = 200;

const loadNProgress = () => loadVendorScripts(globalThis.document, [NPROGRESS_SRC], () => globalThis.NProgress);

export function createRouteProgress({ load = loadNProgress, win = globalThis } = {}) {
  let ready = null;
  const library = () => {
    ready ??= load().then((nprogress) => {
      const still = prefersReducedMotion(win);
      nprogress.configure({ showSpinner: false, trickle: !still, speed: still ? 0 : BAR_SPEED_MS });
      return nprogress;
    });
    return ready.catch(() => null);
  };
  return {
    async start() {
      (await library())?.start();
    },
    async done() {
      (await library())?.done();
    },
  };
}
