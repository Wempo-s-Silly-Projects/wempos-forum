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

// Unread count in the tab title (wave 5.3 F2, opt-in): with the box ticked,
// a signed-in member's browser tab reads "(3) Wempo's Forum", so a pinned
// tab shows new notifications without opening it. Off by default (defaults
// law: the title is visible on a shared screen). The choice is a device
// pref, stored only in this browser like the text size; the count itself is
// the one the session already returns. No network call, no account key.
import { t } from "./i18n.js";

export const TAB_UNREAD_STORAGE_KEY = "forum-tab-unread";
export const TAB_UNREAD_CAP = 99;
const ENABLED_VALUE = "on";
const UNREAD_PREFIX = /^\(\d+\+?\) /;

export const stripUnreadPrefix = (title) => String(title ?? "").replace(UNREAD_PREFIX, "");

export const normaliseTabCount = (value) => {
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
};

// "(N) title", "(99+) title" past the cap, or the bare title at zero. Any
// prefix already present is replaced, so repeated calls never stack.
export function titleWithUnread(title, count) {
  const base = stripUnreadPrefix(title);
  const unread = normaliseTabCount(count);
  if (unread === 0) return base;
  const label = unread > TAB_UNREAD_CAP ? TAB_UNREAD_CAP + "+" : String(unread);
  return "(" + label + ") " + base;
}

export function readTabUnread(storage) {
  try {
    return storage?.getItem(TAB_UNREAD_STORAGE_KEY) === ENABLED_VALUE;
  } catch {
    return false;
  }
}

// localStorage, or null where the browser blocks it (private windows).
export function pageStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function applyTabUnread(doc, count, storage) {
  doc.title = titleWithUnread(doc.title, readTabUnread(storage) ? count : 0);
}

// A checkbox for the account settings' Appearance panel. `getCount` reads
// the live unread count so ticking the box updates the title at once.
export function createTabUnreadToggle(doc, storage, getCount) {
  const wrapper = doc.createElement("label");
  wrapper.className = "tab-unread-pref";
  const box = doc.createElement("input");
  box.type = "checkbox";
  box.checked = readTabUnread(storage);
  box.addEventListener("change", () => {
    try {
      storage?.setItem(TAB_UNREAD_STORAGE_KEY, box.checked ? ENABLED_VALUE : "off");
    } catch {
      // Blocked storage: the choice still applies for this page view.
    }
    doc.title = titleWithUnread(doc.title, box.checked ? getCount() : 0);
  });
  wrapper.append(box, doc.createTextNode(" " + t("feed.tabUnread")));
  return wrapper;
}
