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

// Wave 2026-11-21-11 F1: an Enter that confirms an IME candidate (Japanese,
// Chinese, Korean input) must never send a DM or pick a mention.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isImeComposing } from "../public/js/focus-utils.js";

const source = (path) => readFileSync(new URL("../public/js/" + path, import.meta.url), "utf8");

test("isImeComposing is true mid-composition and on Safari's commit keydown", () => {
  assert.equal(isImeComposing({ key: "Enter", isComposing: true }), true);
  assert.equal(isImeComposing({ key: "Enter", isComposing: false, keyCode: 229 }), true);
});

test("isImeComposing is false for a plain Enter or a missing event", () => {
  assert.equal(isImeComposing({ key: "Enter", isComposing: false, keyCode: 13 }), false);
  assert.equal(isImeComposing({ key: "Enter" }), false);
  assert.equal(isImeComposing(null), false);
});

test("the DM composer's Enter-to-send skips IME composition", () => {
  const text = source("chat-widget-composer.js");
  assert.match(text, /import \{[^}]*isImeComposing[^}]*\} from "\.\/focus-utils\.js"/);
  assert.match(text, /event\.key === "Enter" && !event\.shiftKey && !isImeComposing\(event\)/);
});

test("the mention picker's keys stand down during IME composition", () => {
  const text = source("mention-picker.js");
  assert.match(text, /import \{[^}]*isImeComposing[^}]*\} from "\.\/focus-utils\.js"/);
  assert.match(text, /if \(list\.hidden \|\| users\.length === 0 \|\| isImeComposing\(event\)\) return;/);
});

// Wave 2026-11-21-11 F2: a "You" chip on the signed-in member's own cards.
import { createPostCard } from "../public/js/render.js";
import { countByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";

const card = (authorId, viewer) => createPostCard({
  id: 5, body: "hi", createdAt: "2026-11-21T00:00:00Z", visibility: "public",
  author: { id: authorId, username: "ann", role: null },
}, makeFakeDocument(), viewer);

test("your own post carries the You chip", () => {
  assert.equal(countByClass(card(7, { id: 7, role: null }), "role-badge-you"), 1);
});

test("someone else's post, a guest view, or a removed author carries no You chip", () => {
  assert.equal(countByClass(card(8, { id: 7, role: null }), "role-badge-you"), 0);
  assert.equal(countByClass(card(7, null), "role-badge-you"), 0);
  const removed = createPostCard({ id: 6, body: "x", createdAt: "2026-11-21T00:00:00Z", author: null },
    makeFakeDocument(), { id: 7 });
  assert.equal(countByClass(removed, "role-badge-you"), 0);
});

test("the You chip strings exist in every locale", () => {
  for (const file of ["en", "ar", "de", "es", "fr", "he", "hi", "id", "it", "ja", "ko", "nl", "pl", "pt",
    "ru", "th", "tr", "uk", "vi", "zh-Hans", "zh-Hant"]) {
    const bundle = JSON.parse(readFileSync(new URL(`../public/locales/${file}.json`, import.meta.url), "utf8"));
    assert.ok(bundle["render.you"] && bundle["render.youTitle"], file);
  }
});
