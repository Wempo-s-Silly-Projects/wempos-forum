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

// Wave 2026-11-21-5 F3: pinned chats — a member pins DM or group
// conversations to the top of the chat widget's list. Local-only, per
// account, opt-in, capped, and wiped on sign-out with the drafts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_PINNED_CHATS, PINS_STORAGE_KEY, clearAllPins, isPinned, pinsKey, readPins, sortPinnedFirst, togglePin, writePins,
} from "../public/js/chat-pins.js";

const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
    data,
  };
};
const throwing = {
  getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); },
  removeItem() { throw new Error("blocked"); }, get length() { throw new Error("blocked"); },
};

test("pins are keyed per account and round-trip through storage", () => {
  assert.equal(pinsKey(null), PINS_STORAGE_KEY);
  assert.equal(pinsKey(4), PINS_STORAGE_KEY + ":u4");
  const storage = memoryStorage();
  writePins(storage, ["dm:1", "group:2"], 4);
  assert.deepEqual(readPins(storage, 4), ["dm:1", "group:2"]);
  assert.deepEqual(readPins(storage, 5), []);
});

test("togglePin is immutable, adds then removes, and refuses past the cap", () => {
  const empty = [];
  const one = togglePin(empty, "dm:1");
  assert.deepEqual(empty, []);
  assert.deepEqual(one, ["dm:1"]);
  assert.deepEqual(togglePin(one, "dm:1"), []);
  let full = [];
  for (let index = 0; index < MAX_PINNED_CHATS; index += 1) full = togglePin(full, "dm:" + index);
  assert.equal(full.length, MAX_PINNED_CHATS);
  assert.equal(togglePin(full, "dm:99"), full);
  assert.deepEqual(togglePin(full, "dm:0").length, MAX_PINNED_CHATS - 1);
});

test("sortPinnedFirst floats pinned rows and keeps the activity order otherwise", () => {
  const rows = [{ k: "dm:1" }, { k: "group:2" }, { k: "dm:3" }, { k: "dm:4" }];
  const sorted = sortPinnedFirst(rows, ["dm:4", "group:2"], (row) => row.k);
  assert.deepEqual(sorted.map((row) => row.k), ["group:2", "dm:4", "dm:1", "dm:3"]);
  assert.deepEqual(rows.map((row) => row.k), ["dm:1", "group:2", "dm:3", "dm:4"]);
  assert.equal(isPinned(["dm:4"], "dm:4"), true);
  assert.equal(isPinned(["dm:4"], "dm:5"), false);
});

test("corrupt, oversized or blocked storage reads as no pins and never throws", () => {
  const storage = memoryStorage();
  storage.setItem(PINS_STORAGE_KEY, "{nope");
  assert.deepEqual(readPins(storage), []);
  storage.setItem(PINS_STORAGE_KEY, JSON.stringify(["dm:1", 7, "evil<script>", "group:2"]));
  assert.deepEqual(readPins(storage), ["dm:1", "group:2"]);
  storage.setItem(PINS_STORAGE_KEY, JSON.stringify(Array.from({ length: 50 }, (_, index) => "dm:" + index)));
  assert.equal(readPins(storage).length, MAX_PINNED_CHATS);
  assert.deepEqual(readPins(throwing), []);
  assert.doesNotThrow(() => writePins(throwing, ["dm:1"]));
  assert.doesNotThrow(() => clearAllPins(throwing));
});

test("clearAllPins wipes every account's pins and leaves other keys", () => {
  const storage = memoryStorage();
  writePins(storage, ["dm:1"], 1);
  writePins(storage, ["dm:2"]);
  storage.setItem("forum-draft:reply:1", "{}");
  clearAllPins(storage);
  assert.deepEqual([...storage.data.keys()], ["forum-draft:reply:1"]);
});

test("wiring: the list sorts pinned first, the conversation carries the toggle, sign-out wipes", () => {
  const read = (path) => readFileSync(new URL("../public/js/" + path, import.meta.url), "utf8");
  assert.match(read("chat-widget-threads.js"), /sortPinnedFirst\(/);
  assert.match(read("chat-widget-composer.js"), /togglePin\(/);
  assert.match(read("chat-widget-composer.js"), /aria-pressed/);
  assert.match(read("routes/account-nav.js"), /clearAllPins\(\)/);
  assert.doesNotMatch(read("chat-pins.js"), /innerHTML|\bapi\(/);
});
