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

// Keep screen awake (L2 wave): a toggle on the thread's root card for long
// reads, recipes or a video. Off by default and never switched on by itself;
// NoSleep.js 0.12.0 (MIT, vendored verbatim as public/js/vendor/NoSleep.min.js)
// loads same-origin on the first press and asks for a screen wake lock. A
// refused lock leaves the toggle off. The lock is let go on the second press
// and on every route change (route-enhance.js calls releaseKeepAwake), so it
// never outlives the thread it was asked for. Nothing is stored or sent.
import { t } from "./i18n.js";
import { loadVendorScripts } from "./vendor-load.js";

export const NOSLEEP_SRC = "/js/vendor/NoSleep.min.js";

const loadDefault = () => loadVendorScripts(globalThis.document, [NOSLEEP_SRC], () => globalThis.NoSleep);

let active = null;

const setPressed = (button, pressed) => button.setAttribute("aria-pressed", String(pressed));

export function releaseKeepAwake() {
  if (!active) return;
  const { button, sleeper } = active;
  active = null;
  sleeper.disable();
  setPressed(button, false);
}

export function createKeepAwakeButton(document, { loadNoSleep = loadDefault } = {}) {
  const button = document.createElement("button");
  button.setAttribute("type", "button");
  button.className = "button button-quiet keep-awake";
  button.textContent = t("post.keepAwake");
  setPressed(button, false);
  let sleeper = null;
  button.addEventListener("click", () => {
    if (active?.button === button) {
      releaseKeepAwake();
      return;
    }
    loadNoSleep()
      .then((NoSleep) => {
        sleeper ??= new NoSleep();
        return sleeper.enable();
      })
      .then(() => {
        releaseKeepAwake();
        active = { button, sleeper };
        setPressed(button, true);
      }, () => setPressed(button, false));
  });
  return button;
}
