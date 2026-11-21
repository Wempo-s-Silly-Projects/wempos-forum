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

// Wave 5.9 F3: Reply on a wall post — puts "@name " at the start of the wall
// box and focuses it. Nothing is sent until the member posts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWallReplyButton, mentionPrefill } from "../public/js/wall-reply.js";
import { t } from "../public/js/i18n.js";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("mentionPrefill puts the mention first and keeps what was typed", () => {
  assert.equal(mentionPrefill("", "ana"), "@ana ");
  assert.equal(mentionPrefill("  hello", "ana"), "@ana hello");
});

test("mentionPrefill never doubles the same mention", () => {
  assert.equal(mentionPrefill("@ana hi", "ana"), "@ana hi");
  assert.equal(mentionPrefill("@bob hi", "ana"), "@ana @bob hi");
});

test("mentionPrefill respects the cap", () => {
  const long = "x".repeat(300);
  assert.equal(mentionPrefill(long, "ana", 280).length, 280);
  assert.ok(mentionPrefill(long, "ana", 280).startsWith("@ana "));
});

test("the button fills, focuses and puts the cursor at the end", () => {
  const box = new FakeNode("textarea");
  box.value = "hi";
  let range = null;
  box.setSelectionRange = (start, end) => { range = [start, end]; };
  const button = createWallReplyButton(makeFakeDocument(), "ana", () => box);
  assert.equal(button.type, "button");
  assert.equal(button.getAttribute("aria-label"), t("wall.replyAria", { name: "ana" }));
  assert.match(JSON.parse(read("public/locales/en.json"))["wall.replyAria"], /\{name\}/);
  button.dispatch("click");
  assert.equal(box.value, "@ana hi");
  assert.equal(box.ownerFocused, true);
  assert.deepEqual(range, [7, 7]);
});

test("no wall box (guest view) means the click does nothing", () => {
  const button = createWallReplyButton(makeFakeDocument(), "ana", () => null);
  assert.doesNotThrow(() => button.dispatch("click"));
});

test("wall.js shows Reply only to signed-in visitors, never on their own posts; no network in the module", () => {
  assert.doesNotMatch(read("public/js/wall-reply.js"), /localStorage|sessionStorage|api\(|fetch\(|innerHTML/);
  const wall = read("public/js/wall.js");
  assert.match(wall, /if \(viewer && Number\(post\.author\.id\) !== Number\(viewer\.id\)\)/);
  assert.match(wall, /createWallReplyButton\(document, post\.author\.username/);
});
