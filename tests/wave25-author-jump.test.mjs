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

// Wave 2026-11-21-25 F3: "Next reply from the author" steps through the thread
// starter's top-level replies in page order and wraps around. Shown only when
// a loaded reply came from the starter; read from the page at click time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";
import { createNextAuthorReplyJump } from "../public/js/latest-reply.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fakeDocument = makeFakeDocument();
const LOCALES = ["ar", "de", "es", "fr", "he", "hi", "id", "it", "ja", "ko", "nl", "pl", "pt", "ru", "th", "tr", "uk", "vi", "zh-Hans", "zh-Hant"];

function card(byStarter, nested = null) {
  const article = new FakeNode("article");
  article.className = "post-card";
  const header = new FakeNode("header");
  header.className = "post-header";
  const author = new FakeNode("div");
  author.className = "post-author";
  if (byStarter) {
    const chip = new FakeNode("span");
    chip.className = "role-badge role-badge-op";
    author.append(chip);
  }
  header.append(author);
  article.append(header);
  if (nested) article.append(nested);
  return article;
}

const click = (button) => button.dispatch("click", { preventDefault() {} });
const replies = [{ id: 2, parent: 1, author: { id: 5 } }, { id: 3, parent: 1, author: { id: 6 } }];

test("author jump: hidden without a starter reply, a list or a starter id", () => {
  const list = new FakeNode("div");
  assert.equal(createNextAuthorReplyJump(fakeDocument, list, replies, null), null);
  assert.equal(createNextAuthorReplyJump(fakeDocument, list, replies, 9), null);
  assert.equal(createNextAuthorReplyJump(fakeDocument, null, replies, 5), null);
  assert.equal(createNextAuthorReplyJump(fakeDocument, list, null, 5), null);
});

test("author jump: steps through the starter's replies in order, then wraps", () => {
  const list = new FakeNode("div");
  const first = card(true);
  const second = card(true);
  list.append(card(false), first, card(false), second);
  const button = createNextAuthorReplyJump(fakeDocument, list, replies, 5);
  assert.equal(button.type, "button");
  assert.ok(button.textContent.length > 0);
  click(button);
  assert.equal(first.ownerFocused, true);
  assert.notEqual(second.ownerFocused, true);
  click(button);
  assert.equal(second.ownerFocused, true);
  first.ownerFocused = false;
  click(button);
  assert.equal(first.ownerFocused, true, "wraps back to the first");
});

test("author jump: a starter chip on a nested sub-reply does not count for its parent", () => {
  const list = new FakeNode("div");
  const parent = card(false, card(true));
  const own = card(true);
  list.append(parent, own);
  const button = createNextAuthorReplyJump(fakeDocument, list, replies, 5);
  click(button);
  assert.equal(own.ownerFocused, true);
  assert.notEqual(parent.ownerFocused, true);
});

test("author jump: cards are read at click time (older replies prepended later)", () => {
  const list = new FakeNode("div");
  const later = card(true);
  list.append(later);
  const button = createNextAuthorReplyJump(fakeDocument, list, replies, 5);
  click(button);
  assert.equal(later.ownerFocused, true);
  const older = card(true);
  list.prepend(older);
  click(button);
  assert.equal(older.ownerFocused, true, "after the last card it wraps to the new first");
});

test("author jump: no starter card on the page does nothing", () => {
  const list = new FakeNode("div");
  const other = card(false);
  list.append(other);
  const button = createNextAuthorReplyJump(fakeDocument, list, replies, 5);
  click(button);
  assert.notEqual(other.ownerFocused, true);
});

test("author jump is wired on the thread page and stays local", () => {
  assert.match(read("public/js/routes/post.js"),
    /createNextAuthorReplyJump\(document, replyList, post\.replies, starterId\)/);
  assert.match(read("public/styles.css"), /\.author-reply-jump \{/);
  assert.doesNotMatch(read("public/js/latest-reply.js"), /localStorage|sessionStorage|api\(/);
});

test("i18n: post.nextAuthorReply exists and is translated in every locale", () => {
  const en = JSON.parse(read("public/locales/en.json"));
  assert.equal(typeof en["post.nextAuthorReply"], "string");
  for (const code of LOCALES) {
    const bundle = JSON.parse(read(`public/locales/${code}.json`));
    assert.equal(typeof bundle["post.nextAuthorReply"], "string", code);
    assert.notEqual(bundle["post.nextAuthorReply"], en["post.nextAuthorReply"], `${code} translated`);
  }
});
