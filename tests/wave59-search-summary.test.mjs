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

// Wave 5.9 F2: search results at a glance — a "Jump to:" row counting the
// replies, members and posts already in the /api/search payload; each entry
// scrolls to and focuses its section. Page-view only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SEARCH_SECTION_IDS, createSearchSummary, searchSummaryCounts } from "../public/js/search-summary.js";
import { tn } from "../public/js/i18n.js";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const RESULTS = { replies: [{}, {}], users: [{}], posts: [{}, {}, {}, {}, {}] };

test("counts each section in page order, dropping empty ones", () => {
  assert.deepEqual(searchSummaryCounts(RESULTS), [
    { section: "replies", count: 2 }, { section: "people", count: 1 }, { section: "posts", count: 5 },
  ]);
  assert.deepEqual(searchSummaryCounts({ replies: [], users: [], posts: [{}] }), [{ section: "posts", count: 1 }]);
});

test("no replies array in the payload means no replies entry", () => {
  assert.deepEqual(searchSummaryCounts({ users: [{}], posts: [] }), [{ section: "people", count: 1 }]);
});

test("junk payloads count as nothing", () => {
  for (const junk of [null, undefined, {}, { users: "x", posts: 3 }]) assert.deepEqual(searchSummaryCounts(junk), []);
});

test("createSearchSummary returns null when nothing matched", () => {
  assert.equal(createSearchSummary(makeFakeDocument(), { replies: [], users: [], posts: [] }, () => null), null);
});

test("one labelled nav with one button per non-empty section", () => {
  const nav = createSearchSummary(makeFakeDocument(), RESULTS, () => null);
  assert.equal(nav.tagName, "NAV");
  assert.equal(nav.className, "search-summary");
  assert.ok(nav.getAttribute("aria-label"));
  const buttons = [...nav.querySelectorAll("button")];
  assert.equal(buttons.length, 3);
  assert.deepEqual(buttons.map((button) => button.dataset.section), ["replies", "people", "posts"]);
  for (const button of buttons) assert.equal(button.type, "button");
  assert.equal(buttons[0].textContent, tn("search.jumpReplies", 2));
  assert.equal(buttons[2].textContent, tn("search.jumpPosts", 5));
  const en = JSON.parse(read("public/locales/en.json"));
  for (const key of ["search.jumpReplies", "search.jumpPeople", "search.jumpPosts"]) {
    assert.match(en[key + ".one"], /\{count\}/);
    assert.match(en[key + ".other"], /\{count\}/);
  }
});

test("a click focuses (and scrolls to) its section", () => {
  const target = new FakeNode("h2");
  let scrolled = 0;
  target.scrollIntoView = () => { scrolled += 1; };
  const asked = [];
  const nav = createSearchSummary(makeFakeDocument(), RESULTS, (id) => { asked.push(id); return target; });
  nav.querySelectorAll("button")[2].dispatch("click");
  assert.deepEqual(asked, [SEARCH_SECTION_IDS.posts]);
  assert.equal(target.ownerFocused, true);
  assert.equal(target.getAttribute("tabindex"), "-1");
  assert.equal(scrolled, 1);
});

test("a click with a missing target does nothing", () => {
  const nav = createSearchSummary(makeFakeDocument(), RESULTS, () => null);
  assert.doesNotThrow(() => nav.querySelectorAll("button")[0].dispatch("click"));
});

test("page-view only, plural keys, and feed.js wires the section ids", () => {
  const source = read("public/js/search-summary.js");
  assert.doesNotMatch(source, /localStorage|sessionStorage|api\(|fetch\(|innerHTML/);
  for (const key of ["search.jumpReplies", "search.jumpPeople", "search.jumpPosts"]) {
    assert.match(source, new RegExp('tn\\(\\s*"' + key.replace(".", "\\.") + '"|"' + key.replace(".", "\\.") + '"'));
  }
  const feed = read("public/js/routes/feed.js");
  assert.match(feed, /createSearchSummary\(document, results/);
  for (const name of ["replies", "people", "posts"]) assert.match(feed, new RegExp("SEARCH_SECTION_IDS\\." + name));
  assert.deepEqual({ ...SEARCH_SECTION_IDS }, { replies: "search-replies", people: "search-people", posts: "search-posts" });
});
