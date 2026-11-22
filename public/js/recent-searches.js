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

// Recent searches (wave 5.36): the last MAX_RECENT_SEARCHES forum searches a
// member ran, shown as chips when the header search box is focused and
// empty. Local only — this browser's localStorage, never sent anywhere —
// account-scoped (":u<id>", nothing stored for guests), cleared per device
// with "Clear recent searches", and wiped on sign-out (wipeAccountLocalData).
// A private window or blocked storage just means no chips; nothing throws.
import { t } from "./i18n.js";
import { searchPagePath } from "./search-filters.js";

export const RECENT_SEARCHES_KEY = "forum-recent-searches";
export const MAX_RECENT_SEARCHES = 8;
const MAX_QUERY_CHARS = 100;

const recentKey = (accountId) => (accountId ? RECENT_SEARCHES_KEY + ":u" + accountId : null);

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const cleanQuery = (query) => (typeof query === "string" ? query.trim() : "");
const validQueries = (list) => (Array.isArray(list) ? list : [])
  .map(cleanQuery).filter((query) => query && query.length <= MAX_QUERY_CHARS);

export function readRecentSearches(storage = browserStorage(), accountId = null) {
  try {
    const key = recentKey(accountId);
    const raw = storage && key ? storage.getItem(key) : null;
    return validQueries(raw ? JSON.parse(raw) : []).slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

// Puts the query first (dropping any case-insensitive duplicate), caps the
// list, stores it, and returns the NEW list. Guests store nothing.
export function rememberSearch(storage = browserStorage(), accountId = null, query = "") {
  const key = recentKey(accountId);
  const fresh = cleanQuery(query);
  if (!key) return [];
  const older = readRecentSearches(storage, accountId);
  if (!fresh || fresh.length > MAX_QUERY_CHARS) return older;
  const next = [fresh, ...older.filter((item) => item.toLowerCase() !== fresh.toLowerCase())]
    .slice(0, MAX_RECENT_SEARCHES);
  try {
    storage?.setItem(key, JSON.stringify(next));
  } catch {
    // Quota or blocked storage: the list just won't persist.
  }
  return next;
}

export function clearRecentSearches(storage = browserStorage(), accountId = null) {
  const key = recentKey(accountId);
  try {
    if (storage && key) storage.removeItem(key);
  } catch {
    // Blocked storage: nothing was stored to clear.
  }
}

// Sign-out wipe: every account's recent searches go.
export function clearAllRecentSearches(storage = browserStorage()) {
  try {
    if (!storage) return;
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === "string" && key.startsWith(RECENT_SEARCHES_KEY + ":")) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Blocked storage: nothing was stored to wipe.
  }
}

// The chip panel under the header search box. Returns the panel node.
export function attachRecentSearches(document, input, { storage = browserStorage(), getAccountId, navigate }) {
  const accountId = () => (typeof getAccountId === "function" ? getAccountId() : null);
  const panel = document.createElement("div");
  panel.className = "recent-searches";
  panel.hidden = true;
  panel.setAttribute("aria-label", t("search.recentTitle"));
  const title = document.createElement("span");
  title.className = "recent-searches-title";
  title.textContent = t("search.recentTitle");
  const list = document.createElement("div");
  list.className = "recent-searches-list";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "button button-quiet recent-searches-clear";
  clear.textContent = t("search.recentClear");
  panel.append(title, list, clear);

  const hide = () => { panel.hidden = true; };
  const show = () => {
    const recent = input.value ? [] : readRecentSearches(storage, accountId());
    list.replaceChildren(...recent.map((query) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "recent-search-chip";
      chip.textContent = query;
      chip.addEventListener("click", (event) => {
        event.preventDefault?.();
        input.value = query;
        rememberSearch(storage, accountId(), query);
        hide();
        navigate(searchPagePath(query));
      });
      return chip;
    }));
    panel.hidden = recent.length === 0;
  };
  clear.addEventListener("click", (event) => {
    event.preventDefault?.();
    clearRecentSearches(storage, accountId());
    hide();
    input.focus?.();
  });
  // Keep focus in the box while a chip is pressed (a button may not take
  // focus on click), so the panel is still there when the click lands.
  panel.addEventListener("mousedown", (event) => event.preventDefault?.());
  input.addEventListener("focus", show);
  input.addEventListener("input", show);
  input.addEventListener("keydown", (event) => { if (event.key === "Escape") hide(); });
  const form = input.closest?.("form") ?? null;
  const container = form?.parentNode ?? form ?? input.parentNode;
  container?.append(panel);
  container?.addEventListener?.("focusout", (event) => {
    if (!event.relatedTarget || !container.contains(event.relatedTarget)) hide();
  });
  return panel;
}
