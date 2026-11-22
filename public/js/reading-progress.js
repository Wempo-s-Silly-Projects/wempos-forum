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

// Reading progress bar (wave 5.26 F2, client-only). A thin decorative bar
// fixed at the top of thread pages (aria-hidden: it repeats what the scroll
// position already says). Its width is how far the thread content has been
// scrolled through, 0-100%, recomputed at most once per animation frame from
// passive scroll/resize listeners. Hidden when the content fits the
// viewport; no width transition under reduced motion. Only one bar exists at
// a time, and every route change stops it (app.js renderRoute), removing the
// bar and both listeners. Nothing is stored or sent.
import { prefersReducedMotion } from "./focus-utils.js";

export const PROGRESS_CLASS = "reading-progress";
export const PROGRESS_STILL_CLASS = "reading-progress-still";
const PERCENT = 100;

let activeStop = null;

// Percent scrolled through `rect` (the content's viewport rect), clamped to
// 0-100; null when the content fits the viewport (nothing to track).
export function readingProgress(rect, viewportHeight) {
  const scrollable = Number(rect?.height) - Number(viewportHeight);
  if (!(scrollable > 0)) return null;
  const percent = (-Number(rect.top) / scrollable) * PERCENT;
  return Math.min(PERCENT, Math.max(0, Math.round(percent * 100) / 100));
}

export function stopReadingProgress() {
  activeStop?.();
}

export function startReadingProgress(doc, win, content, {
  reducedMotion = prefersReducedMotion(win),
} = {}) {
  stopReadingProgress();
  if (!doc?.body || !win?.addEventListener || !content?.getBoundingClientRect) return null;
  const bar = doc.createElement("div");
  bar.className = PROGRESS_CLASS + (reducedMotion ? " " + PROGRESS_STILL_CLASS : "");
  bar.setAttribute("role", "none");
  bar.setAttribute("aria-hidden", "true");
  doc.body.append(bar);

  let frame = null;
  const update = () => {
    frame = null;
    const percent = readingProgress(content.getBoundingClientRect(), win.innerHeight);
    bar.hidden = percent === null;
    if (percent !== null) bar.style.width = percent + "%";
  };
  const onChange = () => {
    if (frame === null) frame = win.requestAnimationFrame(update);
  };
  const listenerOptions = { passive: true };
  win.addEventListener("scroll", onChange, listenerOptions);
  win.addEventListener("resize", onChange, listenerOptions);
  update();

  const stop = () => {
    win.removeEventListener("scroll", onChange, listenerOptions);
    win.removeEventListener("resize", onChange, listenerOptions);
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null;
    bar.remove();
    if (activeStop === stop) activeStop = null;
  };
  activeStop = stop;
  return stop;
}
