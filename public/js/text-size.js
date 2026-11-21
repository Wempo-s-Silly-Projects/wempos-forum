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


// Reader text size (wave 2026-11-21-4 F3): a per-browser choice of Default,
// Large or Larger text. styles.css sizes everything in rem, so one
// data-text-size attribute on <html> scales the whole forum. Stored in
// localStorage like the theme (theme-preload.js applies it before paint);
// blocked storage simply means the default size.
import { t } from "./i18n.js";

export const TEXT_SIZE_STORAGE_KEY = "forum-text-size";
export const TEXT_SIZES = Object.freeze(["default", "large", "larger"]);
const LABEL_KEYS = Object.freeze({
  default: "feed.textSizeDefault",
  large: "feed.textSizeLarge",
  larger: "feed.textSizeLarger",
});
const PICKER_ID = "text-size-pref";


export const normalizeTextSize = (value) => (TEXT_SIZES.includes(value) ? value : "default");

export function readTextSize(storage) {
  try {
    return normalizeTextSize(storage?.getItem(TEXT_SIZE_STORAGE_KEY) ?? null);
  } catch {
    return "default";
  }
}

export function applyTextSize(doc, size) {
  doc.documentElement.dataset.textSize = normalizeTextSize(size);
}

// A labelled <select> for the account settings' Appearance panel.
export function createTextSizePicker(doc, storage) {
  const wrapper = doc.createElement("label");
  wrapper.className = "text-size-pref";
  wrapper.setAttribute("for", PICKER_ID);
  wrapper.append(doc.createTextNode(t("feed.textSize") + " "));
  const select = doc.createElement("select");
  select.id = PICKER_ID;
  for (const size of TEXT_SIZES) {
    const option = doc.createElement("option");
    option.value = size;
    option.textContent = t(LABEL_KEYS[size]);
    select.append(option);
  }
  select.value = readTextSize(storage);
  select.addEventListener("change", () => {
    const size = normalizeTextSize(select.value);
    try {
      storage?.setItem(TEXT_SIZE_STORAGE_KEY, size);
    } catch {
      // Blocked storage: the size still applies for this page view.
    }
    applyTextSize(doc, size);
  });
  wrapper.append(select);
  return wrapper;
}
