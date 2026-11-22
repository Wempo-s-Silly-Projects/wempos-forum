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

// Hiding header (Batch J): on small screens the site header sticks to the
// top, slides away while the reader scrolls down and comes back on the
// first scroll up, with the vendored Headroom.js (MIT). It never hides while
// keyboard focus is inside it (frozen and pinned until focus leaves), and
// under prefers-reduced-motion it still hides but without the slide
// (styles.css drops the transition for .headroom-still). Wide screens keep
// the ordinary header untouched.
import { prefersReducedMotion } from "./focus-utils.js";
import { loadVendorScripts } from "./vendor-load.js";

export const HEADROOM_QUERY = "(max-width: 640px)"; // i18n-ignore
export const HEADROOM_SRC = "/js/vendor/headroom.js";
const SCROLL_OFFSET_PX = 120;
const SCROLL_TOLERANCE_PX = 8;

export function initHeadroom(header, { Headroom, win = globalThis } = {}) {
  if (!header || typeof Headroom !== "function") return null;
  if (win?.matchMedia?.(HEADROOM_QUERY)?.matches !== true) return null;
  if (prefersReducedMotion(win)) header.classList.add("headroom-still");
  const headroom = new Headroom(header, { offset: SCROLL_OFFSET_PX, tolerance: SCROLL_TOLERANCE_PX });
  headroom.init();
  header.addEventListener("focusin", () => {
    headroom.pin();
    headroom.freeze();
  });
  header.addEventListener("focusout", (event) => {
    if (event.relatedTarget && header.contains?.(event.relatedTarget)) return;
    headroom.unfreeze();
  });
  return headroom;
}

export async function initHeaderHeadroom(document, { win = globalThis } = {}) {
  const header = document.querySelector(".site-header");
  if (!header || win?.matchMedia?.(HEADROOM_QUERY)?.matches !== true) return null;
  try {
    const Headroom = await loadVendorScripts(document, [HEADROOM_SRC], () => globalThis.Headroom);
    return initHeadroom(header, { Headroom, win });
  } catch {
    return null;
  }
}
