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

// High contrast (wave 5.27 F2): Auto / On / Off, stored in this browser only
// like the reader text size. Auto follows the device's
// "(prefers-contrast: more)"; On forces it; Off turns it off even when the
// device asks for more contrast. The effect is the "high-contrast" class on
// the root element, which styles.css answers with colour overrides for both
// themes. theme-preload.js applies the same rule before first paint and
// follows live device changes while on Auto.
import { t } from "./i18n.js";

export const CONTRAST_STORAGE_KEY = "forum-contrast";
export const CONTRAST_MODES = Object.freeze(["auto", "on", "off"]);
export const HIGH_CONTRAST_CLASS = "high-contrast";
const MORE_CONTRAST_QUERY = "(prefers-contrast: more)"; // i18n-ignore
const LABEL_KEYS = Object.freeze({
  auto: "readingComfort.contrastAuto",
  on: "readingComfort.contrastOn",
  off: "readingComfort.contrastOff",
});
const PICKER_ID = "contrast-pref";

export const normalizeContrast = (value) => (CONTRAST_MODES.includes(value) ? value : "auto");

export function readContrast(storage) {
  try {
    return normalizeContrast(storage?.getItem(CONTRAST_STORAGE_KEY) ?? null);
  } catch {
    return "auto";
  }
}

export function prefersMoreContrast(win) {
  try {
    return Boolean(win?.matchMedia?.(MORE_CONTRAST_QUERY)?.matches);
  } catch {
    return false;
  }
}

export function isHighContrast(mode, win) {
  const normalized = normalizeContrast(mode);
  if (normalized === "on") return true;
  if (normalized === "off") return false;
  return prefersMoreContrast(win);
}

export function applyContrast(doc, mode, win) {
  const root = doc.documentElement;
  root.dataset.contrast = normalizeContrast(mode);
  root.classList.toggle(HIGH_CONTRAST_CLASS, isHighContrast(mode, win));
}

export function createContrastPicker(doc, storage, win) {
  const wrapper = doc.createElement("label");
  wrapper.className = "contrast-pref";
  wrapper.setAttribute("for", PICKER_ID);
  wrapper.append(doc.createTextNode(t("readingComfort.contrast") + " "));
  const select = doc.createElement("select");
  select.id = PICKER_ID;
  for (const mode of CONTRAST_MODES) {
    const option = doc.createElement("option");
    option.value = mode;
    option.textContent = t(LABEL_KEYS[mode]);
    select.append(option);
  }
  select.value = readContrast(storage);
  select.addEventListener("change", () => {
    const mode = normalizeContrast(select.value);
    try {
      storage?.setItem(CONTRAST_STORAGE_KEY, mode);
    } catch {
      // Blocked storage: the mode still applies for this page view.
    }
    applyContrast(doc, mode, win);
  });
  wrapper.append(select);
  return wrapper;
}
