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

// The app's shared kit consumers (the brief's target-module layout §6): the
// small helpers more than one route module rides — the role-button factory
// and empty-state composer live in the route modules until their wave names
// them; wave 7 materializes this module with the UNREAD MODEL, so the feed
// markers, the mobile bar and the chrome all read ONE store.
//
// The unread model (the wave-2 seed, relocated from routes/feed.js): one
// client model the feed tabs read from. The member's own reads ride a
// localStorage key in the forum's key family ("forum-board-visited" — a JSON
// pair of { lastVisit, seen } maps); fresh activity rides the posts the feed
// ALREADY fetches, because every serialized row carries its board slug and
// its activity stamp. A board tab announces itself unread when served
// activity is newer than the member's last read of that board (including
// boards the member has never opened); reading the board marks it visited;
// zero unread renders nothing — the wave-7 edge, held from day one.
import { createStore } from "../vendor/designer/kit.mjs";
import { BOARD_BY_SLUG } from "../boards.js";

const BOARD_READ_STORAGE_KEY = "forum-board-visited";

// The kit store is the idiom the wave plan names for the route's module
// state: get / set / subscribe over a plain object, and the store's own
// subscriber is the persistence half — every set writes through under the
// forum key, best-effort (privacy modes keep the announcements for this
// page only).
export const boardReads = createStore(readBoardReadState());
boardReads.subscribe((next) => {
  try {
    window.localStorage.setItem(BOARD_READ_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Persistence is best-effort; the model still drives this page.
  }
});

function readBoardReadState() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(BOARD_READ_STORAGE_KEY) || "null");
    return {
      // Unknown stored shapes fall back to a silent start, never noise.
      lastVisit: readableMap(parsed, "lastVisit"),
      seen: readableMap(parsed, "seen"),
    };
  } catch {
    // Malformed JSON or blocked storage: same silent start.
    return { lastVisit: {}, seen: {} };
  }
}

function readableMap(parsed, key) {
  return parsed && typeof parsed === "object" &&
    parsed[key] && typeof parsed[key] === "object" ? parsed[key] : {};
}

// postActivityAt: the row's own activity stamp (ms epoch; the serializer
// ships camelCase — lastActivityAt when the board's activity was bumped,
// the creation stamp otherwise).
export const postActivityAt = (post) => Number(post?.lastActivityAt ?? post?.createdAt) || 0;

// The seen half: served feed rows advance their board's activity floor,
// monotonically — an older page or a stale render never unmutes a board.
export function recordBoardActivity(posts) {
  if (!Array.isArray(posts) || posts.length === 0) return;
  const current = boardReads.get();
  const seen = { ...current.seen };
  let changed = false;
  for (const post of posts) {
    const board = post?.board;
    // The whitelist IS boards.js's — an unknown slug is nothing to serve.
    if (!board || !BOARD_BY_SLUG[board]) continue;
    const at = postActivityAt(post);
    if (at > (seen[board] || 0)) {
      seen[board] = at;
      changed = true;
    }
  }
  if (changed) boardReads.set({ lastVisit: current.lastVisit, seen });
}

// The read half: opening the board's own route IS the member's read; the
// floor is "now", lifted above anything served on the page so a slow clock
// can never hang the unread state open.
export function markBoardVisited(slug) {
  const current = boardReads.get();
  boardReads.set({
    seen: current.seen,
    lastVisit: { ...current.lastVisit, [slug]: Math.max(Date.now(), current.seen[slug] || 0) },
  });
}

export const boardIsUnread = (slug) => {
  const reads = boardReads.get();
  return Boolean(reads.seen[slug]) && reads.seen[slug] > (reads.lastVisit[slug] || 0);
};
