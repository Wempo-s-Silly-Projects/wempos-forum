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

import { t, tn } from "./i18n.js";
// "New since your last visit" (wave 2026-11-21 F3): the thread page remembers,
// in this browser only, the highest reply id the member has seen per thread.
// Coming back, replies above that mark get a "New" chip, a divider marks where
// they left off, and a jump button scrolls there. The server never learns what
// anyone has read (limit collection, not access). First visit marks nothing.
// Storage failures fall back to "no markers" — never an error.

export const CATCH_UP_STORAGE_KEY = "forum-seen-replies";
export const CATCH_UP_MAX_THREADS = 300;

// The optional account id scopes the marks to the member who read them (the
// drafts.js idiom), so a shared browser never shows one member's read state
// to another. A guest keeps the unscoped key.
export const catchUpKey = (accountId = null) =>
  CATCH_UP_STORAGE_KEY + (accountId ? ":u" + accountId : "");

// Sign-out wipe: every account's marks (and the guest key) go, other keys stay.
export function clearAllCatchUp(storage = browserStorage()) {
  try {
    if (!storage) return;
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key === CATCH_UP_STORAGE_KEY || (typeof key === "string" && key.startsWith(CATCH_UP_STORAGE_KEY + ":"))) {
        keys.push(key);
      }
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Blocked storage: nothing was stored to wipe.
  }
}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function readSeenMap(storage, accountId = null) {
  try {
    const raw = storage ? storage.getItem(catchUpKey(accountId)) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSeenMap(storage, map, accountId = null) {
  try {
    storage?.setItem(catchUpKey(accountId), JSON.stringify(map));
  } catch {
    // Quota or blocked storage: markers just won't persist.
  }
}

export function lastSeenFor(map, threadId) {
  const entry = isPlainObject(map) ? map[String(threadId)] : null;
  return entry && Number.isFinite(entry.id) ? entry.id : null;
}

// Reply ids above the mark, in the given order; none on a first visit.
export function newReplyIds(replies, lastSeen) {
  if (lastSeen === null || lastSeen === undefined) return [];
  return (Array.isArray(replies) ? replies : [])
    .map((reply) => Number(reply?.id))
    .filter((id) => Number.isFinite(id) && id > lastSeen);
}

// Returns a NEW map with the thread's mark raised (never lowered) and stamped
// at `now`; beyond the cap the least recently seen threads are dropped.
export function recordSeen(map, threadId, maxId, now = Date.now()) {
  const key = String(threadId);
  const previous = lastSeenFor(map, key);
  const id = Math.max(Number(maxId) || 0, previous ?? 0);
  const next = { ...(isPlainObject(map) ? map : {}), [key]: { id, at: now } };
  const keys = Object.keys(next);
  if (keys.length <= CATCH_UP_MAX_THREADS) return next;
  const kept = keys
    .sort((a, b) => (Number(next[b].at) || 0) - (Number(next[a].at) || 0))
    .slice(0, CATCH_UP_MAX_THREADS);
  return Object.fromEntries(kept.map((k) => [k, next[k]]));
}

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

// Paints the markers onto an already-rendered reply list, then records the
// visit. `replyList` may be null (no replies yet) — the visit still counts, so
// the first reply after it shows as new next time. `accountId` picks the
// signed-in member's own marks.
export function applyCatchUp(document, threadId, replies, replyList, { accountId = null, storage = browserStorage() } = {}) {
  const map = readSeenMap(storage, accountId);
  const freshIds = newReplyIds(replies, lastSeenFor(map, threadId));
  const ids = (Array.isArray(replies) ? replies : []).map((reply) => Number(reply?.id) || 0);
  writeSeenMap(storage, recordSeen(map, threadId, Math.max(0, ...ids)), accountId);
  if (!replyList || freshIds.length === 0) return;
  const fresh = new Set(freshIds);
  const cards = [...replyList.children].filter((card) => fresh.has(Number(card.dataset.postId)));
  if (cards.length === 0) return;
  for (const card of cards) {
    card.classList.add("post-new");
    const chip = document.createElement("span");
    chip.className = "new-chip";
    chip.textContent = t("catchUp.newChip");
    (card.querySelector(".post-header") ?? card).append(chip);
  }
  const divider = document.createElement("div");
  divider.className = "catch-up-divider";
  divider.setAttribute("role", "separator");
  divider.textContent = t("catchUp.divider");
  cards[0].before(divider);
  const jump = document.createElement("button");
  jump.type = "button";
  jump.className = "button button-secondary catch-up-jump";
  jump.textContent = tn("catchUp.jump", cards.length);
  jump.addEventListener("click", () => {
    divider.scrollIntoView({ behavior: "smooth", block: "start" });
    cards[0].focus?.({ preventScroll: true });
  });
  replyList.before(jump);
}
