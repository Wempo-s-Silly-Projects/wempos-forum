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

// Fun extras (Batch M): one settings panel of playful effects. Every toggle
// defaults ON until the member turns it off, lives only in this browser
// (localStorage, with a page-local fallback when storage is blocked) and
// leaves with the member on sign-out (clearAllFunExtras). Nothing here
// touches the network; each effect lazy-loads its vendored library only once
// its own toggle is on (loader.js).
import { t } from "../i18n.js";
import { prefersReducedMotion } from "../focus-utils.js";
import {
  FUN_DEFAULTS, FUN_FALLBACK_STATE, FUN_KEYS, fallbackFor, isStorageObject, rememberFallback,
} from "../fun-state.js";

export { FUN_DEFAULTS, FUN_KEYS, prefersReducedMotion };

export const FUN_STORAGE_KEY = "forum-fun-extras";
// The last milestone badge a member was seen holding on this device, so the
// confetti burst plays once per unlock (confetti.js). One key per member id.
export const FUN_BADGE_SEEN_PREFIX = "forum-fun-badge-seen:";
// Panel order; each key is one checkbox labelled by its "fun.<key>" string.
const FUN_LABEL_PREFIX = "fun.";

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const normalise = (value) =>
  Object.freeze(Object.fromEntries(FUN_KEYS.map((key) => [key, value?.[key] === true])));

export function readFunSettings(storage = browserStorage()) {
  if (!isStorageObject(storage)) return normalise(FUN_FALLBACK_STATE.settings);
  if (FUN_FALLBACK_STATE.blocked.has(storage)) return normalise(fallbackFor(storage));
  try {
    const raw = storage.getItem(FUN_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const result = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? normalise(parsed)
      : FUN_DEFAULTS;
    rememberFallback(storage, result);
    return result;
  } catch {
    FUN_FALLBACK_STATE.blocked.add(storage);
    return normalise(fallbackFor(storage));
  }
}

// Returns a new settings object with one key changed and stores it; the
// previous object is never mutated. Blocked storage keeps it page-local.
export function writeFunSetting(storage, key, enabled) {
  const next = normalise({ ...readFunSettings(storage), [key]: enabled === true });
  rememberFallback(storage, next);
  try {
    if (!isStorageObject(storage) || typeof storage.setItem !== "function") {
      if (isStorageObject(storage)) FUN_FALLBACK_STATE.blocked.add(storage);
      return next;
    }
    storage.setItem(FUN_STORAGE_KEY, JSON.stringify(next));
  } catch {
    if (isStorageObject(storage)) FUN_FALLBACK_STATE.blocked.add(storage);
  }
  return next;
}

export function isFunOn(key, storage = browserStorage()) {
  return readFunSettings(storage)[key] === true;
}

// Remembers the badge a member holds now; returns the one remembered before
// (null on a first sighting). Blocked storage reads as "same as now".
export function rememberBadge(storage, userId, badgeKey) {
  const name = FUN_BADGE_SEEN_PREFIX + userId;
  try {
    const previous = storage?.getItem(name) ?? null;
    storage?.setItem(name, badgeKey);
    return previous;
  } catch {
    return badgeKey;
  }
}

// Sign-out wipe: every member's badge-seen marker (account data). The
// switches themselves are device preferences, like DM effects, and stay.
export function clearAllFunExtras(storage = browserStorage()) {
  try {
    if (!storage) return;
    const names = [];
    for (let index = 0; index < (storage.length ?? 0); index += 1) names.push(storage.key(index));
    for (const name of names) if (name?.startsWith(FUN_BADGE_SEEN_PREFIX)) storage.removeItem(name);
  } catch {
    // Blocked storage: nothing was stored to wipe.
  }
}

function createSwitch(doc, storage, key, checked, onChange) {
  const label = doc.createElement("label");
  label.className = "fun-extras-toggle";
  const box = doc.createElement("input");
  box.type = "checkbox";
  box.className = "fun-extras-switch";
  box.dataset.funKey = key;
  box.checked = checked;
  box.addEventListener("change", () => onChange(writeFunSetting(storage, key, box.checked)));
  label.append(box, doc.createTextNode(" " + t(FUN_LABEL_PREFIX + key)));
  return label;
}

// The settings panel: heading, one switch per extra and, when the device
// asks for reduced motion, a note that moving effects stay still.
// Rendering stores nothing; each change saves and calls onChange(settings).
export function createFunExtrasPanel(doc, storage, { win = globalThis, onChange = () => {} } = {}) {
  const panel = doc.createElement("section");
  panel.className = "panel fun-extras-panel";
  const heading = doc.createElement("h2");
  heading.textContent = t("fun.title");
  panel.append(heading);
  const current = readFunSettings(storage);
  for (const key of FUN_KEYS) panel.append(createSwitch(doc, storage, key, current[key], onChange));
  if (prefersReducedMotion(win)) {
    const note = doc.createElement("p");
    note.className = "muted fun-extras-reduced";
    note.textContent = t("fun.reducedMotion");
    panel.append(note);
  }
  return panel;
}
