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

// Wave 2026-11-21 F3: "New since your last visit" — local read marks per thread.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CATCH_UP_MAX_THREADS, lastSeenFor, newReplyIds, readSeenMap, recordSeen, writeSeenMap,
} from "../public/js/catch-up.js";

test("newReplyIds returns only replies above the mark; first visit marks nothing", () => {
  const replies = [{ id: 5 }, { id: 9 }, { id: 12 }];
  assert.deepEqual(newReplyIds(replies, 9), [12]);
  assert.deepEqual(newReplyIds(replies, null), []);
  assert.deepEqual(newReplyIds([], 3), []);
});

test("recordSeen is immutable and never lowers the mark", () => {
  const before = { 1: { id: 10, at: 1 } };
  const after = recordSeen(before, 1, 4, 2);
  assert.deepEqual(before, { 1: { id: 10, at: 1 } });
  assert.equal(lastSeenFor(after, 1), 10);
  assert.equal(lastSeenFor(recordSeen(after, 1, 15, 3), 1), 15);
  assert.equal(lastSeenFor({}, 99), null);
});

test("recordSeen evicts the least recently seen threads beyond the cap", () => {
  let map = {};
  for (let thread = 1; thread <= CATCH_UP_MAX_THREADS + 5; thread += 1) {
    map = recordSeen(map, thread, thread * 10, thread);
  }
  assert.equal(Object.keys(map).length, CATCH_UP_MAX_THREADS);
  assert.equal(lastSeenFor(map, 1), null);
  assert.equal(lastSeenFor(map, CATCH_UP_MAX_THREADS + 5), (CATCH_UP_MAX_THREADS + 5) * 10);
});

test("storage failures and corrupt data read as an empty map", () => {
  const throwing = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
  assert.deepEqual(readSeenMap(throwing), {});
  assert.doesNotThrow(() => writeSeenMap(throwing, { 1: { id: 1, at: 1 } }));
  assert.deepEqual(readSeenMap({ getItem: () => "[1,2]" }), {});
  assert.deepEqual(readSeenMap({ getItem: () => "nope" }), {});
  assert.deepEqual(readSeenMap(null), {});
});

test("post.js wires the catch-up markers into the thread render", () => {
  const source = readFileSync(new URL("../public/js/routes/post.js", import.meta.url), "utf8");
  assert.match(source, /from "\.\.\/catch-up\.js"/);
  assert.match(source, /applyCatchUp\(/);
  const module = readFileSync(new URL("../public/js/catch-up.js", import.meta.url), "utf8");
  assert.doesNotMatch(module, /innerHTML|\bapi\(/);
});
