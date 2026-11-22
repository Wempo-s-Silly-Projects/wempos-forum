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

// Batch K item 2: composer drafts move from localStorage to IndexedDB (the
// vendored idb-keyval) behind a Storage-shaped mirror, so every existing
// helper keeps its synchronous contract. A one-time migration moves old
// forum-draft:* keys out of localStorage, and the sign-out wipe
// (clearAllDrafts, called by wipeAccountLocalData) empties the IndexedDB
// store too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DRAFT_HYDRATE_TIMEOUT_MS, DRAFT_PREFIX, clearAllDrafts, createDraftStore, draftKey, loadDraftEntry, saveDraft,
} from "../public/js/drafts.js";
import * as constants from "../constants.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function fakeIdb(seed = []) {
  const map = new Map(seed);
  const log = [];
  return {
    map,
    log,
    entries: async () => [...map.entries()],
    set: async (key, value) => { log.push(["set", key]); map.set(key, value); },
    del: async (key) => { log.push(["del", key]); map.delete(key); },
    clear: async () => { log.push(["clear"]); map.clear(); },
  };
}

function fakeLocalStorage(seed = []) {
  const map = new Map(seed);
  return {
    map,
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const entry = (body, savedAt = Date.now()) => JSON.stringify({ body, savedAt });

test("the hydrate timeout is a named cap mirrored in constants.mjs", () => {
  assert.equal(DRAFT_HYDRATE_TIMEOUT_MS, constants.DRAFT_HYDRATE_TIMEOUT_MS);
  assert.ok(DRAFT_HYDRATE_TIMEOUT_MS > 0 && DRAFT_HYDRATE_TIMEOUT_MS <= 5000);
});

test("hydrate loads saved drafts from IndexedDB into the synchronous mirror", async () => {
  const key = draftKey("reply", 12, null, 7);
  const idb = fakeIdb([[key, entry("hello from idb")], ["not-a-draft", "x"]]);
  const store = createDraftStore({ idb, legacy: fakeLocalStorage() });
  await store.hydrate();
  assert.equal(loadDraftEntry(store, key).body, "hello from idb");
  assert.equal(store.getItem("not-a-draft"), null, "only forum-draft: keys are mirrored");
  assert.equal(store.length, 1);
  assert.equal(store.key(0), key);
});

test("one-time migration moves localStorage drafts into IndexedDB and leaves other keys alone", async () => {
  const moved = draftKey("post", null, "general", 7);
  const kept = draftKey("reply", 3, null, 7);
  const legacy = fakeLocalStorage([
    [moved, entry("old local draft")],
    [kept, entry("stale local copy")],
    ["forum-theme", "dark"],
  ]);
  const idb = fakeIdb([[kept, entry("newer idb copy")]]);
  const store = createDraftStore({ idb, legacy });
  await store.hydrate();
  assert.equal(JSON.parse(idb.map.get(moved)).body, "old local draft");
  assert.equal(JSON.parse(idb.map.get(kept)).body, "newer idb copy", "an IndexedDB copy wins over the legacy one");
  assert.equal(legacy.getItem(moved), null);
  assert.equal(legacy.getItem(kept), null);
  assert.equal(legacy.getItem("forum-theme"), "dark");
  assert.equal(loadDraftEntry(store, moved).body, "old local draft");
  const second = createDraftStore({ idb, legacy });
  await second.hydrate();
  assert.equal([...legacy.map.keys()].filter((name) => name.startsWith(DRAFT_PREFIX)).length, 0);
});

test("saves write through to IndexedDB; empty bodies delete", async () => {
  const idb = fakeIdb();
  const store = createDraftStore({ idb, legacy: fakeLocalStorage() });
  await store.hydrate();
  const key = draftKey("reply", 5, null, 9);
  saveDraft(store, key, "typed text");
  await settle();
  assert.equal(JSON.parse(idb.map.get(key)).body, "typed text");
  saveDraft(store, key, "   ");
  await settle();
  assert.equal(idb.map.has(key), false);
  assert.equal(store.getItem(key), null);
});

test("clearAllDrafts empties the mirror, the IndexedDB store and any legacy localStorage drafts", async () => {
  const key = draftKey("reply", 1, null, 4);
  const legacyKey = draftKey("post", null, null, 4);
  const legacy = fakeLocalStorage([["forum-theme", "light"]]);
  const idb = fakeIdb([[key, entry("secret unsent text")]]);
  const store = createDraftStore({ idb, legacy });
  await store.hydrate();
  legacy.setItem(legacyKey, entry("left behind"));
  await clearAllDrafts(store);
  assert.equal(store.length, 0);
  assert.equal(idb.map.size, 0);
  assert.ok(idb.log.some(([op]) => op === "clear"));
  assert.equal(legacy.getItem(legacyKey), null);
  assert.equal(legacy.getItem("forum-theme"), "light");
});

test("IndexedDB failures never break the composer: the mirror keeps working", async () => {
  const broken = {
    entries: async () => { throw new Error("blocked"); },
    set: async () => { throw new Error("quota"); },
    del: async () => { throw new Error("blocked"); },
    clear: async () => { throw new Error("blocked"); },
  };
  const store = createDraftStore({ idb: broken, legacy: fakeLocalStorage() });
  await store.hydrate();
  const key = draftKey("reply", 2);
  saveDraft(store, key, "still typed");
  await settle();
  assert.equal(loadDraftEntry(store, key).body, "still typed");
  await clearAllDrafts(store);
  assert.equal(store.length, 0);
});

test("drafts.js builds its store on the vendored idb-keyval; draft-notice uses that store", () => {
  const drafts = read("public/js/drafts.js");
  assert.match(drafts, /from "\.\/vendor\/idb-keyval\.js"/);
  assert.match(drafts, /export (?:async )?function clearAllDrafts/);
  const notice = read("public/js/draft-notice.js");
  assert.match(notice, /draftStorage/);
  assert.doesNotMatch(notice, /localStorage/);
});

test("sign-out awaits the draft wipe before leaving the page", () => {
  const nav = read("public/js/routes/account-nav.js");
  const wipe = nav.match(/function wipeAccountLocalData\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(wipe, /lastDraftWipe = clearAllDrafts\(\)/);
  const logout = nav.match(/logout: async \(\) => \{([\s\S]*?)\n {2}\},/)?.[1] ?? "";
  assert.match(logout, /finally \{\s*wipeAccountLocalData\(\);\s*\}\s*await lastDraftWipe;/);
});
