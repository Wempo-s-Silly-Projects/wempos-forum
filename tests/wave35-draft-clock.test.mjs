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
// Wave 2026-11-21-35 F1 — restored drafts read a timestamp from localStorage,
// which is member-editable and can be corrupted. A savedAt in the future
// (clock jump, hand-edited storage) used to dodge the 7-day expiry forever,
// and one past Date's range rendered "Invalid Date" in the restored-draft
// notice. Both now read as no draft and the stale key is cleared.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DRAFT_MAX_AGE_MS, loadDraftEntry } from "../public/js/drafts.js";

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

const stored = (savedAt) => JSON.stringify({ body: "half-written", savedAt });

test("draft clock: a savedAt days in the future is dropped and cleared", () => {
  const storage = memoryStorage({ k: stored(NOW + 30 * DAY_MS) });
  assert.equal(loadDraftEntry(storage, "k", NOW), null);
  assert.equal(storage.map.has("k"), false);
});

test("draft clock: a savedAt beyond Date's range is dropped (no Invalid Date)", () => {
  const storage = memoryStorage({ k: stored(1e300) });
  assert.equal(loadDraftEntry(storage, "k", NOW), null);
  assert.equal(storage.map.has("k"), false);
});

test("draft clock: small clock skew still restores the draft", () => {
  const storage = memoryStorage({ k: stored(NOW + 60 * 1000) });
  assert.deepEqual(loadDraftEntry(storage, "k", NOW), { body: "half-written", savedAt: NOW + 60 * 1000 });
});

test("draft clock: the 7-day expiry and corrupt JSON keep their behavior", () => {
  const old = memoryStorage({ k: stored(NOW - DRAFT_MAX_AGE_MS - 1) });
  assert.equal(loadDraftEntry(old, "k", NOW), null);
  assert.equal(old.map.has("k"), false);
  for (const raw of ["{", "null", "[]", '{"body":1,"savedAt":1}', '{"body":"x","savedAt":"1"}',
    '{"body":"x"}', '{"body":"x","savedAt":null}']) {
    assert.equal(loadDraftEntry(memoryStorage({ k: raw }), "k", NOW), null, raw);
  }
});
