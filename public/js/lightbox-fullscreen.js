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

import { t } from "./i18n.js";

// Image viewer full screen (media libraries lane): the lightbox's "Enter
// fullscreen" button puts the viewer dialog itself in full screen through the
// vendored screenfull (prefixed APIs included), imported lazily on the first
// press, same-origin. The button reuses the video player's translated
// enter/exit labels and reports its state with aria-pressed. A browser with
// no full-screen support hides the button after that first press; closing
// the viewer leaves full screen. Nothing is stored or fetched beyond the
// one same-origin module.

const loadScreenfull = async () => (await import("./vendor/screenfull.js")).default;

function paint(button, active) {
  const label = t(active ? "embed.player.exitFullscreen" : "embed.player.enterFullscreen");
  button.setAttribute("aria-pressed", active ? "true" : "false");
  button.setAttribute("aria-label", label);
  button.textContent = label;
}

export function attachFullscreenToggle(dialog, button, load = loadScreenfull) {
  let screenfull = null;
  const isOurs = () => Boolean(screenfull?.isFullscreen) && screenfull.element === dialog;
  paint(button, false);
  const ready = async () => {
    if (screenfull) return screenfull;
    const library = await load();
    if (!library?.isEnabled) return null;
    screenfull = library;
    screenfull.on("change", () => paint(button, isOurs()));
    return screenfull;
  };
  button.addEventListener("click", async () => {
    let library;
    try {
      library = await ready();
    } catch {
      library = null;
    }
    if (!library) {
      button.hidden = true;
      return;
    }
    try {
      await (isOurs() ? library.exit() : library.request(dialog));
    } catch {
      // The browser refused (no user activation, policy): stay windowed.
      paint(button, isOurs());
    }
  });
  dialog.addEventListener("close", () => {
    if (isOurs()) screenfull.exit().catch(() => {});
    paint(button, false);
  });
}
