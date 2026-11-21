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

// Muted chats (wave 2026-11-21-26, v4.31): a member mutes a DM or group so
// its unread messages stop counting toward the chat launcher's badge. The
// conversation still lists, still shows its own unread styling when opened,
// and still delivers every message — only the badge goes quiet. Opt-in and
// local-only: the list lives in this browser under the member's own key
// (`forum-chat-mutes:u<id>`), the server never learns it, and sign-out wipes
// it (wipeAccountLocalData). No account id means no key: nothing is read or
// written until the account is known. Storage failures read as no mutes.

export const MUTES_STORAGE_KEY = "forum-chat-mutes";
export const MAX_MUTED_CHATS = 50;

const MUTE_KEY_SHAPE = /^(dm|group):[0-9]{1,15}$/;

export const mutesKey = (accountId = null) => (accountId ? MUTES_STORAGE_KEY + ":u" + accountId : null);

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function readMutes(storage = browserStorage(), accountId = null) {
  try {
    const key = mutesKey(accountId);
    const raw = storage && key ? storage.getItem(key) : null;
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => typeof entry === "string" && MUTE_KEY_SHAPE.test(entry)).slice(0, MAX_MUTED_CHATS);
  } catch {
    return [];
  }
}

export function writeMutes(storage = browserStorage(), mutes = [], accountId = null) {
  const key = mutesKey(accountId);
  if (!key) return;
  try {
    storage?.setItem(key, JSON.stringify(mutes));
  } catch {
    // Quota or blocked storage: the mute just won't persist.
  }
}

export const isMuted = (mutes, key) => Array.isArray(mutes) && mutes.includes(key);

// Returns a NEW list with the key added or removed; a full list refuses an
// add by returning the SAME list, so callers can tell.
export function toggleMute(mutes, key) {
  const current = Array.isArray(mutes) ? mutes : [];
  if (current.includes(key)) return current.filter((muted) => muted !== key);
  if (current.length >= MAX_MUTED_CHATS) return mutes;
  return [...current, key];
}

// The badge number: the server's whole total (or, on an older server, the
// loaded rows' sum) minus the unread of the loaded rows that are muted —
// never below zero. A muted chat on a group page not yet loaded still counts
// until that page loads (the server total cannot be split without it).
export function unmutedUnreadTotal({ serverTotal = null, rows = [], mutes = [], keyOf }) {
  const list = Array.isArray(rows) ? rows : [];
  const unreadOf = (row) => Number(row?.unread) || 0;
  const total = serverTotal ?? list.reduce((sum, row) => sum + unreadOf(row), 0);
  const muted = list.filter((row) => isMuted(mutes, keyOf(row))).reduce((sum, row) => sum + unreadOf(row), 0);
  return Math.max(0, total - muted);
}

// Sign-out wipe: every account's mutes go.
export function clearAllMutes(storage = browserStorage()) {
  try {
    if (!storage) return;
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === "string" && key.startsWith(MUTES_STORAGE_KEY + ":")) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Blocked storage: nothing was stored to wipe.
  }
}
