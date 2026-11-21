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

// Wave 2026-11-21 F2: @mention autocomplete — token rule, insertion, ranking.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_MENTION_SUGGESTIONS, applyMention, mentionQueryAt, rankMentionUsers,
} from "../public/js/mention-picker.js";

test("mentionQueryAt finds the token ending at the caret", () => {
  assert.deepEqual(mentionQueryAt("hi @ItsW", 8), { start: 3, query: "itsw" });
  assert.deepEqual(mentionQueryAt("@bo", 3), { start: 0, query: "bo" });
  assert.deepEqual(mentionQueryAt("(@ann", 5), { start: 1, query: "ann" });
});

test("mentionQueryAt rejects email-shaped text, bare @, and spaces", () => {
  assert.equal(mentionQueryAt("mail hi@example", 15), null);
  assert.equal(mentionQueryAt("just @", 6), null);
  assert.equal(mentionQueryAt("@bob is here", 12), null);
  assert.equal(mentionQueryAt("@bo-b", 5), null);
});

test("mentionQueryAt only looks left of the caret", () => {
  assert.deepEqual(mentionQueryAt("@alice and more", 3), { start: 0, query: "al" });
});

test("applyMention replaces the token and adds a trailing space", () => {
  const result = applyMention("hey @it how", 4, 7, "ItsWempo");
  assert.equal(result.text, "hey @ItsWempo  how");
  assert.equal(result.caret, 14);
});

test("rankMentionUsers puts prefix matches first, drops bio-only hits, caps the list", () => {
  const users = [
    { username: "zed_bob" }, { username: "bobby" }, { username: "alice" },
    { username: "Bob" }, { username: "carl" },
  ];
  assert.deepEqual(rankMentionUsers(users, "bob").map((u) => u.username), ["Bob", "bobby", "zed_bob"]);
  const many = Array.from({ length: 20 }, (_, i) => ({ username: "user" + String(i).padStart(2, "0") }));
  assert.equal(rankMentionUsers(many, "user").length, MAX_MENTION_SUGGESTIONS);
});

test("the picker rides the one api() wrapper, uses a listbox, and is wired into the composer", () => {
  const source = readFileSync(new URL("../public/js/mention-picker.js", import.meta.url), "utf8");
  assert.match(source, /from "\.\/api\.js"/);
  assert.match(source, /\/api\/search\?q=/);
  assert.match(source, /"listbox"/);
  assert.match(source, /aria-activedescendant/);
  assert.doesNotMatch(source, /innerHTML|XMLHttpRequest/);
  const composer = readFileSync(new URL("../public/js/routes/composer.js", import.meta.url), "utf8");
  assert.match(composer, /attachMentionPicker\(/);
});
