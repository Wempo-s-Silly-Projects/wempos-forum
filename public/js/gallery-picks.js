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

// Gallery picker extras (wave 2026-11-21-21 F2 + F3), DOM-free.
// F2 recents: the last MAX_RECENT_GALLERY library images a member inserted
// sit in a "Recently used" row at the top of the picker. Local-only and
// account-scoped (the server never learns them), read and written only once
// the account id is known, and wiped on sign-out with the drafts and pins.
// Stored ids are re-checked against the gallery id shape; and the picker
// only ever shows a recent id that ALSO came back in the current approved
// /api/gifs list, so a rejected or revoked image never resurfaces from here.
// F3 sort: "newest" keeps the server's order; "popular" orders by use count
// (stable, so ties keep newest-first). Neither ever mutates its input.

export const RECENTS_STORAGE_KEY = "forum-gallery-recents";
export const MAX_RECENT_GALLERY = 8;
export const GALLERY_SORTS = ["newest", "popular"];

const GALLERY_ID_SHAPE = /^[0-9a-f-]{36}$/;

export const recentsKey = (accountId = null) => (accountId ? RECENTS_STORAGE_KEY + ":u" + accountId : null);

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const validIds = (list) =>
  (Array.isArray(list) ? list : []).filter((id) => typeof id === "string" && GALLERY_ID_SHAPE.test(id));

export function readRecents(storage = browserStorage(), accountId = null) {
  try {
    const key = recentsKey(accountId);
    const raw = storage && key ? storage.getItem(key) : null;
    return validIds(raw ? JSON.parse(raw) : []).slice(0, MAX_RECENT_GALLERY);
  } catch {
    return [];
  }
}

export function writeRecents(storage = browserStorage(), recents = [], accountId = null) {
  const key = recentsKey(accountId);
  if (!key) return;
  try {
    storage?.setItem(key, JSON.stringify(validIds(recents).slice(0, MAX_RECENT_GALLERY)));
  } catch {
    // Quota or blocked storage: recents just won't persist.
  }
}

// A NEW list: the just-inserted ids first (in insert order), then the older
// recents without duplicates, capped.
export function rememberRecents(recents, insertedIds) {
  const fresh = validIds(insertedIds);
  const older = validIds(recents).filter((id) => !fresh.includes(id));
  return [...new Set([...fresh, ...older])].slice(0, MAX_RECENT_GALLERY);
}

// Splits the approved list into the recents row (recent order, only ids the
// server still lists) and the rest (sorted, recents excluded so no image
// appears twice).
export function arrangeGallery(gifs, recents = [], sort = "newest") {
  const list = Array.isArray(gifs) ? gifs : [];
  const byId = new Map(list.map((gif) => [gif.id, gif]));
  const recentIds = validIds(recents).filter((id) => byId.has(id));
  const recent = recentIds.map((id) => byId.get(id));
  const rest = list.filter((gif) => !recentIds.includes(gif.id));
  const sorted = sort === "popular"
    ? rest.map((gif, order) => ({ gif, order }))
      .sort((a, b) => (Number(b.gif.useCount) || 0) - (Number(a.gif.useCount) || 0) || a.order - b.order)
      .map(({ gif }) => gif)
    : rest;
  return { recent, rest: sorted };
}

// Sign-out wipe: every account's recents go.
export function clearAllRecents(storage = browserStorage()) {
  try {
    if (!storage) return;
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === "string" && key.startsWith(RECENTS_STORAGE_KEY + ":")) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Blocked storage: nothing was stored to wipe.
  }
}
