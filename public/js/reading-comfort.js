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

// Reading comfort (wave 5.27 F1): line spacing and always-underline links,
// stored in this browser only, exactly like the reader text size
// (text-size.js): a "forum-" device-preference key that survives sign-out,
// painted on the root element, preloaded before first paint by
// theme-preload.js.
import { t } from "./i18n.js";

export const LINE_SPACING_STORAGE_KEY = "forum-line-spacing";
export const LINE_SPACINGS = Object.freeze(["default", "relaxed", "spacious"]);
const LINE_SPACING_LABEL_KEYS = Object.freeze({
  default: "readingComfort.lineSpacingDefault",
  relaxed: "readingComfort.lineSpacingRelaxed",
  spacious: "readingComfort.lineSpacingSpacious",
});
const LINE_SPACING_PICKER_ID = "line-spacing-pref";

export const LINK_UNDERLINE_STORAGE_KEY = "forum-link-underline";
const LINK_UNDERLINE_ON = "on";
const LINK_UNDERLINE_OFF = "off";

export const normalizeLineSpacing = (value) => (LINE_SPACINGS.includes(value) ? value : "default");

export function readLineSpacing(storage) {
  try {
    return normalizeLineSpacing(storage?.getItem(LINE_SPACING_STORAGE_KEY) ?? null);
  } catch {
    return "default";
  }
}

export function applyLineSpacing(doc, spacing) {
  doc.documentElement.dataset.lineSpacing = normalizeLineSpacing(spacing);
}

export function readLinkUnderline(storage) {
  try {
    return storage?.getItem(LINK_UNDERLINE_STORAGE_KEY) === LINK_UNDERLINE_ON;
  } catch {
    return false;
  }
}

export function applyLinkUnderline(doc, on) {
  doc.documentElement.dataset.linkUnderline = on ? LINK_UNDERLINE_ON : LINK_UNDERLINE_OFF;
}

const storeQuietly = (storage, key, value) => {
  try {
    storage?.setItem(key, value);
  } catch {
    // Blocked storage: the choice still applies for this page view.
  }
};

export function createLineSpacingPicker(doc, storage) {
  const wrapper = doc.createElement("label");
  wrapper.className = "line-spacing-pref";
  wrapper.setAttribute("for", LINE_SPACING_PICKER_ID);
  wrapper.append(doc.createTextNode(t("readingComfort.lineSpacing") + " "));
  const select = doc.createElement("select");
  select.id = LINE_SPACING_PICKER_ID;
  for (const spacing of LINE_SPACINGS) {
    const option = doc.createElement("option");
    option.value = spacing;
    option.textContent = t(LINE_SPACING_LABEL_KEYS[spacing]);
    select.append(option);
  }
  select.value = readLineSpacing(storage);
  select.addEventListener("change", () => {
    const spacing = normalizeLineSpacing(select.value);
    storeQuietly(storage, LINE_SPACING_STORAGE_KEY, spacing);
    applyLineSpacing(doc, spacing);
  });
  wrapper.append(select);
  return wrapper;
}

export function createLinkUnderlineToggle(doc, storage) {
  const wrapper = doc.createElement("label");
  wrapper.className = "link-underline-pref";
  const box = doc.createElement("input");
  box.type = "checkbox";
  box.checked = readLinkUnderline(storage);
  box.addEventListener("change", () => {
    const on = Boolean(box.checked);
    storeQuietly(storage, LINK_UNDERLINE_STORAGE_KEY, on ? LINK_UNDERLINE_ON : LINK_UNDERLINE_OFF);
    applyLinkUnderline(doc, on);
  });
  wrapper.append(box, doc.createTextNode(" " + t("readingComfort.underlineLinks")));
  return wrapper;
}
