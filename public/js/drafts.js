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

// Composer draft autosave (wave 2026-11-21 F1): whatever a member types in a
// post or reply composer is kept in localStorage per composer + thread, so a
// refresh, crash or wandering off never loses it. Local-only — nothing leaves
// the browser. Every storage touch is wrapped: a private window or blocked
// storage turns the feature into a silent no-op, never a broken composer.
// The helpers take the storage and clock as arguments so node tests drive them.
// Batch K: drafts now live in IndexedDB (the vendored idb-keyval) behind a
// Storage-shaped in-memory mirror, so every helper here stays synchronous.
// Boot hydrates the mirror (bounded by DRAFT_HYDRATE_TIMEOUT_MS) and moves
// any old localStorage drafts across once; without IndexedDB (old browser,
// blocked storage, node tests) the helpers fall back to localStorage.
import { clear, createStore, del, entries, set } from "./vendor/idb-keyval.js";

export const DRAFT_PREFIX = "forum-draft:";
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const DRAFT_SAVE_DELAY_MS = 400;
// Wave 35: a savedAt further ahead than this is corrupt (clock jump or
// edited storage) — it would dodge the expiry forever and can fall outside
// Date's range ("Invalid Date" in the restored notice), so it reads as none.
export const DRAFT_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;
// Mirrors constants.mjs: boot waits at most this long for IndexedDB drafts.
export const DRAFT_HYDRATE_TIMEOUT_MS = 1500;
const DRAFT_IDB_NAME = "wempos-forum-drafts";
const DRAFT_IDB_STORE = "drafts";

// The optional account id scopes a draft to the member who typed it, so a
// shared browser never restores one member's unsent text for another.
export const draftKey = (formName, postId, board = null, accountId = null) =>
  DRAFT_PREFIX + (accountId ? "u" + accountId + ":" : "") +
  formName + ":" + (postId ?? "new") + (board ? ":" + board : "");

export function clearDraft(storage, key) {
  try {
    storage?.removeItem(key);
  } catch {
    // Blocked storage: nothing to clear.
  }
}

// Sign-out wipe: every forum draft in this browser goes, other keys stay.
// An IndexedDB draft store wipes itself (see clearAll below); the returned
// promise resolves when IndexedDB is done.
export function clearAllDrafts(storage = browserStorage()) {
  if (storage?.[IS_DRAFT_STORE]) return storage.clearAll();
  removeDraftKeys(storage);
  return Promise.resolve();
}

const IS_DRAFT_STORE = Symbol();

function removeDraftKeys(storage) {
  try {
    if (!storage) return;
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === "string" && key.startsWith(DRAFT_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Blocked storage: nothing was stored to wipe.
  }
}

const ignore = () => {};

// A Storage-shaped mirror over an IndexedDB adapter ({ entries, set, del,
// clear }, each returning a promise). Reads hit the in-memory map; writes
// update it at once and go through to IndexedDB in the background, so a
// failing IndexedDB costs persistence, never the composer.
export function createDraftStore({ idb, legacy = null }) {
  const cache = new Map();
  return {
    [IS_DRAFT_STORE]: true,
    get length() {
      return cache.size;
    },
    key: (index) => [...cache.keys()][index] ?? null,
    getItem: (key) => (cache.has(key) ? cache.get(key) : null),
    setItem(key, value) {
      cache.set(key, String(value));
      idb.set(key, String(value)).catch(ignore);
    },
    removeItem(key) {
      cache.delete(key);
      idb.del(key).catch(ignore);
    },
    // The sign-out wipe: the mirror, the whole IndexedDB store (it holds
    // drafts only, so keys a timed-out hydrate never mirrored go too) and
    // any legacy localStorage drafts. Resolves when IndexedDB is done.
    clearAll() {
      cache.clear();
      removeDraftKeys(legacy);
      return idb.clear().catch(ignore);
    },
    async hydrate() {
      try {
        for (const [key, value] of await idb.entries()) {
          if (typeof key === "string" && key.startsWith(DRAFT_PREFIX) && !cache.has(key)) cache.set(key, String(value));
        }
      } catch {
        return;
      }
      await migrateLegacy(legacy, cache, idb);
    },
  };
}

// One-time move: each localStorage draft not already in IndexedDB is copied
// across, then removed from localStorage (only after the copy succeeded).
async function migrateLegacy(legacy, cache, idb) {
  let keys = [];
  try {
    if (!legacy) return;
    for (let index = 0; index < legacy.length; index += 1) {
      const key = legacy.key(index);
      if (typeof key === "string" && key.startsWith(DRAFT_PREFIX)) keys.push(key);
    }
  } catch {
    return;
  }
  for (const key of keys) {
    try {
      const value = legacy.getItem(key);
      if (value !== null && !cache.has(key)) {
        await idb.set(key, value);
        cache.set(key, value);
      }
      legacy.removeItem(key);
    } catch {
      // Leave this one in localStorage; the next boot tries again.
    }
  }
}

export function saveDraft(storage, key, body, now = Date.now()) {
  if (typeof body !== "string" || !body.trim()) {
    clearDraft(storage, key);
    return;
  }
  try {
    storage?.setItem(key, JSON.stringify({ body, savedAt: now }));
  } catch {
    // Quota exceeded or blocked storage: autosave is best-effort.
  }
}

export function loadDraft(storage, key, now = Date.now()) {
  return loadDraftEntry(storage, key, now)?.body ?? null;
}

// Wave 31: the body plus when it was saved, for the "draft restored" notice.
export function loadDraftEntry(storage, key, now = Date.now()) {
  let raw;
  try {
    raw = storage ? storage.getItem(key) : null;
  } catch {
    return null;
  }
  if (!raw) return null;
  let draft;
  try {
    draft = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!draft || typeof draft.body !== "string" || !Number.isFinite(draft.savedAt)) return null;
  const age = now - draft.savedAt;
  if (age > DRAFT_MAX_AGE_MS || age < -DRAFT_FUTURE_SKEW_MS) {
    clearDraft(storage, key);
    return null;
  }
  return { body: draft.body, savedAt: draft.savedAt };
}

const localStorageOrNull = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

function idbAdapter() {
  try {
    if (typeof globalThis.indexedDB === "undefined" || !globalThis.indexedDB) return null;
    const store = createStore(DRAFT_IDB_NAME, DRAFT_IDB_STORE);
    return {
      entries: () => entries(store),
      set: (key, value) => set(key, value, store),
      del: (key) => del(key, store),
      clear: () => clear(store),
    };
  } catch {
    return null;
  }
}

const draftIdb = idbAdapter();
const draftStore = draftIdb ? createDraftStore({ idb: draftIdb, legacy: localStorageOrNull() }) : null;
if (draftStore) {
  await Promise.race([
    draftStore.hydrate(),
    new Promise((resolve) => setTimeout(resolve, DRAFT_HYDRATE_TIMEOUT_MS)),
  ]);
}

const browserStorage = () => draftStore ?? localStorageOrNull();

// The storage every draft helper defaults to (the IndexedDB mirror, or
// localStorage without IndexedDB) — draft-notice.js discards through it.
export const draftStorage = () => browserStorage();

// Wires one composer form: restores a saved draft into the empty textarea and
// saves (debounced) on every input. The key rides on the form's dataset so the
// submit handlers can clear it without recomputing it. Returns { savedAt }
// when a draft was restored into the box (wave 31 notice), otherwise null.
export function attachDraftAutosave(form, textarea, key, storage = browserStorage()) {
  if (!form || !textarea) return null;
  form.dataset.draftKey = key;
  const saved = loadDraftEntry(storage, key);
  let restored = null;
  if (saved && !textarea.value) {
    textarea.value = saved.body;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    restored = { savedAt: saved.savedAt };
  }
  let timer = null;
  textarea.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (form.dataset.draftKey) saveDraft(storage, key, textarea.value);
    }, DRAFT_SAVE_DELAY_MS);
  });
  return restored;
}

// Clears the stored draft AND disarms the form's key, so a debounced save
// still pending from the last keystroke can't write the sent text back.
export function clearFormDraft(form, storage = browserStorage()) {
  const key = form?.dataset?.draftKey;
  if (!key) return;
  delete form.dataset.draftKey;
  clearDraft(storage, key);
}
