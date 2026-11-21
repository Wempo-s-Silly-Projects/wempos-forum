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
// Wave 5.5 F2: filter replies on a thread page — narrow the replies to the
// ones that mention a word. Page view only: nothing stored, nothing sent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  REPLY_FILTER_MIN_REPLIES, createReplyFilter, refreshReplyFilter, replyMatches,
} from "../public/js/reply-filter.js";
import { FakeNode, findByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

const card = (id, body) => {
  const node = new FakeNode("article");
  node.className = "post-card";
  node.dataset.postId = String(id);
  node.postBody = body;
  return node;
};
const subGroup = (forId) => {
  const node = new FakeNode("div");
  node.className = "sub-replies";
  node.dataset.subRepliesFor = String(forId);
  return node;
};
const makeList = (bodies) => {
  const list = new FakeNode("div");
  list.className = "post-list replies-list";
  bodies.forEach((body, index) => list.append(card(index + 1, body)));
  return list;
};
const shown = (list) => [...list.children]
  .filter((node) => node.matches("article.post-card") && !node.hasAttribute("data-filtered-out"))
  .map((node) => node.dataset.postId);
const search = (box, value) => { box.input.value = value; box.input.dispatch("input"); };
const mount = (bodies) => {
  const list = makeList(bodies);
  const filter = createReplyFilter(makeFakeDocument(), list, bodies.length);
  return {
    list, filter,
    input: findByClass(filter, "reply-filter-input"),
    status: findByClass(filter, "reply-filter-status"),
    clear: findByClass(filter, "reply-filter-clear"),
  };
};

test("replyMatches: case-insensitive, every word must appear", () => {
  assert.equal(replyMatches("The Dark Theme is great", "dark"), true);
  assert.equal(replyMatches("The Dark Theme is great", "THEME great"), true);
  assert.equal(replyMatches("The Dark Theme is great", "light"), false);
  assert.equal(replyMatches("anything", "   "), true);
  assert.equal(replyMatches(undefined, "x"), false);
});

test("replyMatches: spoilered text never matches", () => {
  assert.equal(replyMatches("the ending: ||the butler did it||", "butler"), false);
  assert.equal(replyMatches("the ending: ||the butler did it||", "ending"), true);
});

test("only threads with enough replies get the box", () => {
  assert.equal(REPLY_FILTER_MIN_REPLIES, 3);
  assert.equal(createReplyFilter(makeFakeDocument(), makeList(["a", "b"]), 2), null);
  assert.equal(createReplyFilter(makeFakeDocument(), null, 9), null);
});

test("typing narrows the replies and announces the count", () => {
  const box = mount(["I love the dark theme", "Light mode forever", "Dark mode please", "Unrelated"]);
  assert.equal(box.filter.getAttribute("role"), "search");
  assert.equal(box.status.getAttribute("aria-live"), "polite");
  assert.equal(box.status.hidden, true);
  search(box, "DARK");
  assert.deepEqual(shown(box.list), ["1", "3"]);
  assert.equal(box.status.hidden, false);
  assert.ok(box.status.textContent.length > 0);
  assert.equal(box.clear.hidden, false);
  search(box, "nothing-matches-this");
  assert.deepEqual(shown(box.list), []);
  search(box, "");
  assert.deepEqual(shown(box.list), ["1", "2", "3", "4"]);
  assert.equal(box.status.hidden, true);
  assert.equal(box.clear.hidden, true);
});

test("an open sub-reply group follows its parent reply", () => {
  const box = mount(["apples", "bananas", "cherries"]);
  const group = subGroup(1);
  box.list.children[0].after?.(group) ?? box.list.insertBefore(group, box.list.children[1]);
  search(box, "bananas");
  assert.equal(group.hasAttribute("data-filtered-out"), true);
  search(box, "apples");
  assert.equal(group.hasAttribute("data-filtered-out"), false);
});

test("Clear and Escape bring every reply back; IME composition is left alone", () => {
  const box = mount(["red", "green", "blue"]);
  search(box, "red");
  box.clear.dispatch("click");
  assert.equal(box.input.value, "");
  assert.deepEqual(shown(box.list), ["1", "2", "3"]);
  assert.equal(box.input.ownerFocused, true);
  search(box, "red");
  box.input.dispatch("keydown", { key: "Escape", isComposing: true, preventDefault() {} });
  assert.deepEqual(shown(box.list), ["1"], "IME composing: no clear");
  box.input.dispatch("keydown", { key: "Escape", preventDefault() {} });
  assert.deepEqual(shown(box.list), ["1", "2", "3"]);
});

test("refreshReplyFilter covers replies added by Load older replies", () => {
  const box = mount(["red", "green", "blue"]);
  search(box, "blue");
  box.list.prepend(card(9, "old red reply"), card(8, "old blue reply"));
  refreshReplyFilter(box.list);
  assert.deepEqual(shown(box.list), ["8", "3"]);
  refreshReplyFilter(makeList(["x"]));
  refreshReplyFilter(null);
});

test("page view only: no storage, no network, no innerHTML; post.js wires it", () => {
  const module = read("public/js/reply-filter.js");
  assert.doesNotMatch(module, /localStorage|sessionStorage|\bapi\(|fetch\(|innerHTML/);
  assert.match(module, /isImeComposing\(/);
  assert.match(module, /maskSpoilers\(/);
  const post = read("public/js/routes/post.js");
  assert.match(post, /from "\.\.\/reply-filter\.js"/);
  assert.match(post, /createReplyFilter\(document, replyList, knownReplyTotal\(post\)\)/);
  assert.match(post, /refreshReplyFilter\(replyList\)/);
  assert.match(read("public/styles.css"), /\[data-filtered-out\]/);
  assert.match(read("public/index.html"), /<link rel="modulepreload" href="\/js\/reply-filter\.js">/);
});
