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

// Fun extras gate (v5.84 load order). The fun/ modules load only when the
// effective settings enable an extra. This small module keeps
// the three hooks app.js calls (same names as fun/index.js) and imports
// fun/index.js only once a switch is on, the settings panel is opened, or
// another tab turns one on. Once loaded, everything behaves exactly as
// before: the unread watcher is seeded with the last count and the easter
// egg listener is installed.
import { siteModuleOn } from "./site-modules.js";
import {
  FUN_DEFAULTS, FUN_FALLBACK_STATE, FUN_KEYS, fallbackFor, isStorageObject, rememberFallback,
} from "./fun-state.js";

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
  if (!isStorageObject(storage)) return FUN_FALLBACK_STATE.settings;
  if (FUN_FALLBACK_STATE.blocked.has(storage)) return fallbackFor(storage);
  try {
    const raw = storage.getItem(FUN_GATE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const settings = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.fromEntries(FUN_KEYS.map((key) => [key, parsed[key] === true]))
      : FUN_DEFAULTS;
    rememberFallback(storage, settings);
    return settings;
  } catch {
    FUN_FALLBACK_STATE.blocked.add(storage);
    return fallbackFor(storage);
  }
}

// True when this one switch is on.
export function funSwitchOn(key, storage = browserStorage()) {
  return storedSwitches(storage)[key] === true;
}

// True when any switch is on (never while the owner has the "fun" module
// off, docs/modules.md).
export function anyFunOn(storage = browserStorage()) {
  if (!siteModuleOn("fun")) return false;
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

// Saturday Fools (v5.86): fun/saturday-fools.js loads only when the shell's
// meta says "on" (env SATURDAY_FOOLS + the owner's switch) AND it is Saturday
// in the visitor's local time; every other day nothing is fetched. The tab
// re-checks on visibility / focus so an open tab picks Saturday up after
// local midnight (the module itself switches off the next midnight).
export const FOOLS_META_SELECTOR = 'meta[name="saturday-fools"]';
export const FOOLS_SATURDAY = 6;

export function saturdayFoolsDue(doc = globalThis.document, now = new Date()) {
  return doc?.querySelector?.(FOOLS_META_SELECTOR)?.getAttribute?.("content") === "on"
    && now.getDay() === FOOLS_SATURDAY;
}

let foolsLoading = null;
let fools = null;

// Imports fun/saturday-fools.js once (a failed import is forgotten).
export function loadSaturdayFools(importFools = () => import("./fun/saturday-fools.js")) {
  if (!foolsLoading) {
    foolsLoading = importFools().then((module) => {
      module.startSaturdayFools();
      fools = module;
      return module;
    });
    foolsLoading.catch(() => { foolsLoading = null; });
  }
  return foolsLoading;
}

export function checkSaturdayFools(doc = globalThis.document, now = new Date(), importFools = undefined) {
  if (fools || !saturdayFoolsDue(doc, now)) return null;
  return loadSaturdayFools(importFools).catch(() => null);
}

// After every route render: nothing to do (and nothing loaded) while every
// switch is off.
export function enhanceFunView(root, storage = browserStorage()) {
  fools?.enhanceSaturdayFools(root);
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
  const recheckFools = () => checkSaturdayFools(win.document);
  recheckFools();
  win.document?.addEventListener?.("visibilitychange", recheckFools);
  win.addEventListener?.("focus", recheckFools);
  if (anyFunOn()) {
    loadFunExtras().catch(() => null);
    return;
  }
  win.addEventListener?.("storage", (event) => {
    if (event.key === FUN_GATE_STORAGE_KEY && anyFunOn()) loadFunExtras().catch(() => null);
  });
}
