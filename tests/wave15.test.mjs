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

// Wave 2026-11-21-15 F1: raw-text spoiler masking must hide exactly what the
// post renderer hides. The renderer parses block by block (list items and
// quote lines one at a time, code fences never) and lets code/bold/link spans
// win, so a "||" inside code must not pair with a real spoiler's opener and
// leave the spoiler's text bare in excerpts, previews and read-aloud.
import { test } from "node:test";
import assert from "node:assert/strict";
import { maskSpoilers } from "../public/js/markdown.js";
import { threadExcerpt } from "../public/js/profile-extras.js";
import { readFileSync } from "node:fs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";
import { createMyReplyJump } from "../public/js/latest-reply.js";

const LEAKY_BODIES = [
  "run `a || b` first. Ending: ||he dies||",
  "```\nx || y\n```\nEnding: ||he dies||",
  "**a||b** c ||he dies||",
  "- ||open item\n||he dies||",
  "> quote ||\n||he dies||",
];

test("maskSpoilers never leaves rendered spoiler text bare", () => {
  for (const body of LEAKY_BODIES) {
    assert.doesNotMatch(maskSpoilers(body), /he dies/, body);
    assert.doesNotMatch(threadExcerpt(body), /he dies/, body);
  }
});

test("maskSpoilers keeps ordinary text and plain spoilers as before", () => {
  assert.equal(maskSpoilers("it ends when ||he dies|| lol"), "it ends when ▒▒▒ lol");
  assert.equal(maskSpoilers("a || b"), "a || b");
  assert.equal(maskSpoilers("- one ||x||\n- two"), "- one ▒▒▒\n- two");
  assert.equal(maskSpoilers("```\n||kept||\n```"), "```\n||kept||\n```");
  assert.equal(maskSpoilers(null), "");
});

// --- F2: jump to my reply ---------------------------------------------------------

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fakeDocument = makeFakeDocument();

const card = (mine) => {
  const article = new FakeNode("article");
  article.className = "post-card";
  article.scrollIntoView = () => {};
  if (mine) {
    const chip = new FakeNode("span");
    chip.className = "role-badge role-badge-you";
    article.append(chip);
  }
  return article;
};

test("my-reply jump: only when the viewer has a loaded reply; focuses their newest at click", () => {
  const list = new FakeNode("div");
  const older = card(true);
  const newer = card(true);
  list.append(older, card(false), newer, card(false));
  const replies = [{ author: { id: 7 } }, { author: { id: 8 } }];
  assert.equal(createMyReplyJump(fakeDocument, list, replies, null), null);
  assert.equal(createMyReplyJump(fakeDocument, list, replies, 9), null);
  assert.equal(createMyReplyJump(fakeDocument, null, replies, 7), null);
  const button = createMyReplyJump(fakeDocument, list, replies, 7);
  assert.equal(button.type, "button");
  assert.ok(button.textContent.length > 0);
  button.dispatch("click", { preventDefault() {} });
  assert.equal(newer.ownerFocused, true);
  assert.notEqual(older.ownerFocused, true);
});

test("my-reply jump is wired on the thread page and stays local", () => {
  assert.match(read("public/js/routes/post.js"),
    /createMyReplyJump\(document, replyList, post\.replies, context\.session\.user\?\.id\)/);
  assert.match(read("public/styles.css"), /\.my-reply-jump \{/);
  assert.doesNotMatch(read("public/js/latest-reply.js"), /localStorage|sessionStorage|api\(/);
});

test("i18n: wave-15 keys exist and are translated in every locale", () => {
  const keys = ["post.myReply"];
  const en = JSON.parse(read("public/locales/en.json"));
  const locales = ["ar", "de", "es", "fr", "he", "hi", "id", "it", "ja", "ko", "nl", "pl", "pt", "ru", "th", "tr", "uk", "vi", "zh-Hans", "zh-Hant",
    "bg", "bn", "ca", "cs", "da", "el", "fa", "fi", "fil", "hr", "hu", "ms", "nb", "ro", "sk", "sr", "sv", "sw", "ta", "ur"];
  for (const key of keys) assert.equal(typeof en[key], "string", key);
  for (const code of locales) {
    const bundle = JSON.parse(read(`public/locales/${code}.json`));
    for (const key of keys) {
      assert.equal(typeof bundle[key], "string", `${code} ${key}`);
      assert.notEqual(bundle[key], en[key], `${code} ${key} is translated`);
    }
  }
});
