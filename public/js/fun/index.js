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

// Fun extras entry point (Batch M). app.js calls three hooks: enhanceFunView
// after every route render, noteUnreadCount whenever the unread count is
// refreshed, startFunExtras once at boot. With every switch off (the
// default) each hook only reads one localStorage key and returns: no
// library loads, nothing is stored, nothing reaches the network.
import { state } from "../state.js";
import { celebrateMilestone } from "./confetti.js";
import { decorateBadges } from "./badge-art.js";
import { highlightLabels } from "./highlight.js";
import { typeHeroHeadline } from "./hero.js";
import { chimeForUnread } from "./sounds.js";
import { installEasterEggs } from "./eggs.js";
import { ensureFunStyles, importVendorModule, loadVendor } from "./loader.js";
import { FUN_KEYS, readFunSettings } from "./settings.js";

export { createFunExtrasPanel, clearAllFunExtras } from "./settings.js";
export { createSketchButton } from "./sketch.js";

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export const defaultFunEnv = () => ({
  doc: globalThis.document,
  win: globalThis,
  storage: browserStorage(),
  load: loadVendor,
  importModule: importVendorModule,
  userId: state.currentUser?.id ?? null,
});

// Every view effect, each isolated: one failing never blocks the others.
export async function enhanceFunView(root, env = defaultFunEnv()) {
  const settings = readFunSettings(env.storage);
  if (!FUN_KEYS.some((key) => settings[key])) return;
  ensureFunStyles(env.doc);
  const effects = [celebrateMilestone, decorateBadges, highlightLabels, typeHeroHeadline];
  await Promise.all(effects.map((effect) => Promise.resolve().then(() => effect(root, env)).catch(() => null)));
}

// Feeds unread counts one at a time; the first only seeds (a page load is
// not a new notification), later rises go to chime(previous, next).
export function createUnreadWatcher(chime) {
  let previous = null;
  return (count) => {
    const next = Number(count) || 0;
    const before = previous;
    previous = next;
    if (before !== null && next > before) chime(before, next)?.catch?.(() => null);
  };
}

const watchUnread = createUnreadWatcher((previous, next) => chimeForUnread(previous, next, defaultFunEnv()));
export const noteUnreadCount = (count) => watchUnread(count);

let eggsInstalled = false;
export function startFunExtras(env = defaultFunEnv()) {
  if (eggsInstalled || !env.doc) return;
  eggsInstalled = true;
  installEasterEggs(env);
}
