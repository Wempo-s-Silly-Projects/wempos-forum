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

// Wave 2026-11-21 F1: composer draft autosave — pure helpers + wiring pins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DRAFT_MAX_AGE_MS, clearAllDrafts, clearDraft, clearFormDraft, draftKey, loadDraft, saveDraft,
} from "../public/js/drafts.js";

const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    data,
  };
};
const throwingStorage = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
  removeItem() { throw new Error("blocked"); },
};

test("draftKey scopes by form name and thread id", () => {
  assert.equal(draftKey("reply", 42), "forum-draft:reply:42");
  assert.equal(draftKey("post-create", null), "forum-draft:post-create:new");
  assert.equal(draftKey("post-create", undefined, "suggestions"), "forum-draft:post-create:new:suggestions");
});

test("save then load round-trips the body; clear removes it", () => {
  const storage = memoryStorage();
  const key = draftKey("reply", 7);
  saveDraft(storage, key, "half a thought", 1000);
  assert.equal(loadDraft(storage, key, 2000), "half a thought");
  clearDraft(storage, key);
  assert.equal(loadDraft(storage, key, 2000), null);
});

test("saving an empty or whitespace body removes the draft", () => {
  const storage = memoryStorage();
  const key = draftKey("reply", 8);
  saveDraft(storage, key, "something", 1000);
  saveDraft(storage, key, "   ", 1001);
  assert.equal(storage.data.has(key), false);
});

test("stale drafts read as null and are removed", () => {
  const storage = memoryStorage();
  const key = draftKey("reply", 9);
  saveDraft(storage, key, "old words", 0);
  assert.equal(loadDraft(storage, key, DRAFT_MAX_AGE_MS + 1), null);
  assert.equal(storage.data.has(key), false);
});

test("corrupt JSON reads as null instead of throwing", () => {
  const storage = memoryStorage();
  storage.setItem("forum-draft:reply:1", "{not json");
  assert.equal(loadDraft(storage, "forum-draft:reply:1", 1), null);
});

test("a throwing or missing storage never throws", () => {
  for (const storage of [throwingStorage, null, undefined]) {
    assert.doesNotThrow(() => saveDraft(storage, "k", "x", 1));
    assert.equal(loadDraft(storage, "k", 1), null);
    assert.doesNotThrow(() => clearDraft(storage, "k"));
  }
});

test("clearFormDraft removes the draft and disarms the form key (no late debounced resave)", () => {
  const storage = memoryStorage();
  const key = draftKey("reply", 11);
  saveDraft(storage, key, "sent already", 1);
  const form = { dataset: { draftKey: key } };
  clearFormDraft(form, storage);
  assert.equal(storage.data.has(key), false);
  assert.equal(form.dataset.draftKey, undefined);
  assert.doesNotThrow(() => clearFormDraft({ dataset: {} }, storage));
});

test("composer.js restores drafts on build and clears them after both submits", () => {
  const source = readFileSync(new URL("../public/js/routes/composer.js", import.meta.url), "utf8");
  assert.match(source, /from "\.\.\/drafts\.js"/);
  assert.match(source, /attachDraftAutosave\(/);
  assert.equal((source.match(/clearFormDraft\(form\)/g) || []).length, 2);
});

// Wave 2026-11-21-4 F1 (shared-browser leak): drafts are per ACCOUNT, and
// signing out wipes them, so the next member on the same browser never sees
// someone else's unsent text restored into their composer.
const listingStorage = () => {
  const base = memoryStorage();
  return {
    ...base,
    get length() { return base.data.size; },
    key: (index) => [...base.data.keys()][index] ?? null,
  };
};

test("draftKey carries the signed-in account so two members never share a draft", () => {
  const alice = draftKey("reply", 42, null, 1);
  const bob = draftKey("reply", 42, null, 2);
  assert.notEqual(alice, bob);
  const storage = memoryStorage();
  saveDraft(storage, alice, "alice's private reply", 1000);
  assert.equal(loadDraft(storage, bob, 1000), null);
  assert.equal(loadDraft(storage, alice, 1000), "alice's private reply");
});

test("clearAllDrafts removes every forum draft and leaves other keys alone", () => {
  const storage = listingStorage();
  saveDraft(storage, draftKey("reply", 1, null, 1), "one", 1000);
  saveDraft(storage, draftKey("post-create", null, "general", 1), "two", 1000);
  storage.setItem("forum-theme", "dark");
  clearAllDrafts(storage);
  assert.deepEqual([...storage.data.keys()], ["forum-theme"]);
  assert.doesNotThrow(() => clearAllDrafts(throwingStorage));
  assert.doesNotThrow(() => clearAllDrafts(null));
});

test("composer keys drafts by the signed-in account and sign-out wipes drafts", () => {
  const composer = readFileSync(new URL("../public/js/routes/composer.js", import.meta.url), "utf8");
  assert.match(composer, /draftKey\(name, postID, board, state\.currentUser\?\.id\)/);
  const nav = readFileSync(new URL("../public/js/routes/account-nav.js", import.meta.url), "utf8");
  assert.match(nav, /clearAllDrafts\(\)/);
});
