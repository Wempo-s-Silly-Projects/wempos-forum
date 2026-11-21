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

// Wave 2026-11-21 F1: composer draft autosave — pure helpers + wiring pins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DRAFT_MAX_AGE_MS, clearDraft, draftKey, loadDraft, saveDraft,
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

test("composer.js restores drafts on build and clears them after both submits", () => {
  const source = readFileSync(new URL("../public/js/routes/composer.js", import.meta.url), "utf8");
  assert.match(source, /from "\.\.\/drafts\.js"/);
  assert.match(source, /attachDraftAutosave\(/);
  assert.equal((source.match(/clearFormDraft\(form\)/g) || []).length, 2);
});
