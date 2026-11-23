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

// Fun extras gate (v5.84 load order). The fun/ modules used to load on every
// page even though every switch is off by default. This small module keeps
// the three hooks app.js calls (same names as fun/index.js) and imports
// fun/index.js only once a switch is on, the settings panel is opened, or
// another tab turns one on. Once loaded, everything behaves exactly as
// before: the unread watcher is seeded with the last count and the easter
// egg listener is installed.

// Mirrors fun/settings.js FUN_STORAGE_KEY (pinned equal by
// tests/lazy-load-graph.test.mjs).
export const FUN_GATE_STORAGE_KEY = "forum-fun-extras";

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

function storedSwitches(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(FUN_GATE_STORAGE_KEY) ?? "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// True when this one switch is on (blocked storage reads as off).
export function funSwitchOn(key, storage = browserStorage()) {
  return storedSwitches(storage)[key] === true;
}

// True when any switch is on.
export function anyFunOn(storage = browserStorage()) {
  return Object.values(storedSwitches(storage)).some((value) => value === true);
}

let loading = null;
let loaded = null;
let lastUnread = null;

// Imports fun/index.js once; a failed import is forgotten so a later call
// retries. On load the unread watcher is seeded and the eggs are installed.
export function loadFunExtras(importFun = () => import("./fun/index.js")) {
  if (!loading) {
    loading = importFun().then((fun) => {
      if (lastUnread !== null) fun.noteUnreadCount(lastUnread);
      fun.startFunExtras();
      loaded = fun;
      return fun;
    });
    loading.catch(() => { loading = null; });
  }
  return loading;
}

// After every route render: nothing to do (and nothing loaded) while every
// switch is off.
export function enhanceFunView(root, storage = browserStorage()) {
  if (loaded) return loaded.enhanceFunView(root);
  if (!anyFunOn(storage)) return Promise.resolve();
  return loadFunExtras().then((fun) => fun.enhanceFunView(root)).catch(() => null);
}

export function noteUnreadCount(count, storage = browserStorage()) {
  lastUnread = count;
  if (loaded) return loaded.noteUnreadCount(count);
  if (anyFunOn(storage)) loadFunExtras().catch(() => null);
}

// At boot: load now when a switch is already on; otherwise wait for another
// tab to turn one on (the settings panel in this tab loads fun/ itself).
export function startFunExtras(win = globalThis) {
  if (anyFunOn()) {
    loadFunExtras().catch(() => null);
    return;
  }
  win.addEventListener?.("storage", (event) => {
    if (event.key === FUN_GATE_STORAGE_KEY && anyFunOn()) loadFunExtras().catch(() => null);
  });
}
