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

// v4.7 DM client (wave 2026-11-21-2): the opt-in Message effects helpers
// (pure, unit-tested in node) and static pins on the widget's group/image
// wiring (lazy members-only images, createElement only, keyed strings).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EFFECTS_STORAGE_KEY, isEmojiOnly, readEffectsPref, writeEffectsPref } from "../public/js/dm-effects.js";

const read = (path) => readFileSync(new URL("../public/js/" + path, import.meta.url), "utf8");

test("isEmojiOnly: 1-3 emoji yes; text, digits, 4+ emoji, mixed, empty no", () => {
  for (const yes of ["🎉", " ❤️ ", "🔥🔥", "👍🏽", "👨‍👩‍👧", "😂😂😂", "🇨🇦"]) assert.equal(isEmojiOnly(yes), true, yes);
  for (const no of ["", "   ", "hi", "1", "#", "🎉 yay", "😂😂😂😂", "[img:x]", null, undefined, 42]) {
    assert.equal(isEmojiOnly(no), false, String(no));
  }
});

test("effects preference: off by default, round-trips, and never throws on broken storage", () => {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  assert.equal(readEffectsPref(storage), false);
  writeEffectsPref(storage, true);
  assert.equal(store.get(EFFECTS_STORAGE_KEY), "1");
  assert.equal(readEffectsPref(storage), true);
  writeEffectsPref(storage, false);
  assert.equal(readEffectsPref(storage), false);
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(readEffectsPref(broken), false);
  assert.doesNotThrow(() => writeEffectsPref(broken, true));
  assert.equal(readEffectsPref(null), false);
});

test("widget wiring: group + image routes, lazy members-only images, no innerHTML", () => {
  const widget = read("chat-widget.js");
  const extras = read("dm-extras.js");
  const both = widget + extras;
  assert.match(both, /\/api\/dm\/groups/);
  assert.match(both, /\/api\/dm\/images\//);
  assert.match(both, /\/images`/);
  assert.match(both, /loading = "lazy"/);
  assert.match(both, /t\("dm\.imageFrom"/);
  assert.match(both, /from "\.\/dm-effects\.js"/);
  assert.doesNotMatch(both, /innerHTML/);
});
