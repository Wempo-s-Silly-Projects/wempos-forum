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

// Reset appearance (wave 5.7 F3): one button in the account settings'
// Appearance panel puts square corners, reader text size and the tab-title
// unread count back to their defaults in THIS browser. It writes each key's
// default value (the value its own control writes) rather than
// removing it (device prefs never ride a removal: wave 5.6 sweep). The theme
// and every account key are left alone. No network, no new key.
import { t } from "./i18n.js";
import { TEXT_SIZE_STORAGE_KEY, applyTextSize } from "./text-size.js";
import { TAB_UNREAD_STORAGE_KEY, stripUnreadPrefix } from "./tab-unread.js";

export const APPEARANCE_DEFAULTS = Object.freeze({
  "forum-corners": "round",
  [TEXT_SIZE_STORAGE_KEY]: "default",
  [TAB_UNREAD_STORAGE_KEY]: "off",
});
export const APPEARANCE_KEYS = Object.freeze(Object.keys(APPEARANCE_DEFAULTS));

export function resetAppearance(doc, storage) {
  for (const key of APPEARANCE_KEYS) {
    try {
      storage?.setItem(key, APPEARANCE_DEFAULTS[key]);
    } catch {
      // Blocked storage: the defaults still apply for this page view.
    }
  }
  doc.documentElement.dataset.corners = "round";
  applyTextSize(doc, "default");
  doc.title = stripUnreadPrefix(doc.title);
}

// `panel` holds the controls to refresh: every checkbox unticks (all three
// appearance checkboxes default off) and every select returns to "default".
export function createAppearanceReset(doc, storage, panel) {
  const wrapper = doc.createElement("div");
  wrapper.className = "appearance-reset";
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "button button-secondary";
  button.textContent = t("feed.resetAppearance");
  const status = doc.createElement("p");
  status.className = "muted appearance-reset-status";
  status.setAttribute("role", "status");
  button.addEventListener("click", () => {
    resetAppearance(doc, storage);
    for (const input of Array.from(panel.querySelectorAll("input"))) {
      if (input.type === "checkbox") input.checked = false;
    }
    for (const select of Array.from(panel.querySelectorAll("select"))) select.value = "default";
    status.textContent = t("feed.appearanceResetDone");
  });
  wrapper.append(button, status);
  return wrapper;
}
