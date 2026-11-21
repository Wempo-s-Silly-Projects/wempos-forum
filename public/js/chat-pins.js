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

// Pinned chats (wave 2026-11-21-5 F3): a member pins up to MAX_PINNED_CHATS
// conversations (1:1 or group) so they sit at the top of the chat widget's
// list. Opt-in and local-only — the pins live in this browser under the
// member's own key, the server never learns them, and sign-out wipes them
// with the drafts. Pins are conversation keys ("dm:12", "group:3"); anything
// else read back from storage is dropped. Storage failures read as no pins.

export const PINS_STORAGE_KEY = "forum-chat-pins";
export const MAX_PINNED_CHATS = 5;

const PIN_KEY_SHAPE = /^(dm|group):[0-9]{1,15}$/;

export const pinsKey = (accountId = null) => PINS_STORAGE_KEY + (accountId ? ":u" + accountId : "");

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function readPins(storage = browserStorage(), accountId = null) {
  try {
    const raw = storage ? storage.getItem(pinsKey(accountId)) : null;
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((key) => typeof key === "string" && PIN_KEY_SHAPE.test(key)).slice(0, MAX_PINNED_CHATS);
  } catch {
    return [];
  }
}

export function writePins(storage = browserStorage(), pins = [], accountId = null) {
  try {
    storage?.setItem(pinsKey(accountId), JSON.stringify(pins));
  } catch {
    // Quota or blocked storage: pins just won't persist.
  }
}

export const isPinned = (pins, key) => Array.isArray(pins) && pins.includes(key);

// Returns a NEW list with the key added (at the end) or removed; a full list
// refuses an add by returning the SAME list, so callers can tell.
export function togglePin(pins, key) {
  const current = Array.isArray(pins) ? pins : [];
  if (current.includes(key)) return current.filter((pinned) => pinned !== key);
  if (current.length >= MAX_PINNED_CHATS) return pins;
  return [...current, key];
}

// Pinned rows first (in the rows' own order), then the rest — a new array.
export function sortPinnedFirst(rows, pins, keyOf) {
  const list = Array.isArray(rows) ? rows : [];
  const pinned = list.filter((row) => isPinned(pins, keyOf(row)));
  const rest = list.filter((row) => !isPinned(pins, keyOf(row)));
  return [...pinned, ...rest];
}

// Sign-out wipe: every account's pins (and the unscoped key) go.
export function clearAllPins(storage = browserStorage()) {
  try {
    if (!storage) return;
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key === PINS_STORAGE_KEY || (typeof key === "string" && key.startsWith(PINS_STORAGE_KEY + ":"))) {
        keys.push(key);
      }
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Blocked storage: nothing was stored to wipe.
  }
}
