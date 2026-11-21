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
// Wave 2026-11-21-33 — feed views on the client: the router carries a
// validated `view`, the chips are URL anchors, every feed fetch and the
// load-more button carry the matching server params, and the strings ship in
// en + all 20 locales.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeFakeDocument } from "./helpers/fake-dom.mjs";
import { FEED_VIEWS, routeForPath } from "../public/js/router.js";
import { createFeedViews, feedViewEmptyText, feedViewQuery } from "../public/js/feed-views.js";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const NEW_KEYS = ["feed.viewLabel", "feed.viewActive", "feed.viewNewest", "feed.viewUnanswered", "feed.unansweredEmpty"];
const LOCALES = ["ar", "de", "es", "fr", "he", "hi", "id", "it", "ja", "ko", "nl", "pl", "pt", "ru", "th", "tr", "uk", "vi", "zh-Hans", "zh-Hant"];

test("the router carries only a known view on home and category feeds", () => {
  assert.deepEqual(FEED_VIEWS, ["new"]);
  assert.deepEqual(routeForPath("/", ""), { name: "home" });
  assert.deepEqual(routeForPath("/", "?view=new"), { name: "home", view: "new" });
  // Unanswered was removed Nov 21: an old link falls back to the default view.
  assert.deepEqual(routeForPath("/", "?view=unanswered"), { name: "home" });
  assert.deepEqual(routeForPath("/", "?view=hot"), { name: "home" });
  assert.deepEqual(routeForPath("/", "?q=cats&view=new"), { name: "search", query: "cats" });
  assert.deepEqual(routeForPath("/c/help", "?view=unanswered"), { name: "category", board: "help" });
  assert.deepEqual(routeForPath("/c/help", "?view=__proto__"), { name: "category", board: "help" });
  assert.deepEqual(routeForPath("/c/suggestions", "?view=new"), { name: "category", board: "suggestions" });
  assert.deepEqual(routeForPath("/suggestions", "?view=new"), { name: "category", board: "suggestions" });
});

test("feedViewQuery maps views to the server params and nothing else", () => {
  assert.equal(feedViewQuery(undefined), "");
  assert.equal(feedViewQuery("new"), "sort=new");
  assert.equal(feedViewQuery("unanswered"), "");
  assert.equal(feedViewQuery("toString"), "");
  assert.equal(feedViewQuery("__proto__"), "");
  assert.equal(feedViewEmptyText("unanswered"), undefined);
  assert.equal(feedViewEmptyText(undefined), undefined);
  assert.equal(feedViewEmptyText("new"), undefined);
});

test("the chips are two app-link anchors with exactly one current view", () => {
  for (const [active, currentIndex] of [[undefined, 0], ["new", 1]]) {
    const nav = createFeedViews(makeFakeDocument(), "/c/help", active);
    assert.equal(nav.tagName.toLowerCase(), "nav");
    assert.ok(nav.getAttribute("aria-label"));
    const chips = [...nav.children];
    assert.equal(chips.length, 2);
    assert.deepEqual(chips.map((chip) => chip.href), ["/c/help", "/c/help?view=new"]);
    for (const chip of chips) {
      assert.equal(chip.tagName.toLowerCase(), "a");
      assert.equal(chip.getAttribute("data-app-link"), "");
      assert.ok(chip.textContent.length > 0);
    }
    assert.deepEqual(chips.map((chip) => chip.getAttribute("aria-current")),
      chips.map((_, i) => (i === currentIndex ? "page" : null)));
  }
  const home = [...createFeedViews(makeFakeDocument(), "/", "new").children].map((chip) => chip.href);
  assert.deepEqual(home, ["/", "/?view=new"]);
});

test("feed.js threads the view through every feed fetch and the load-more button", () => {
  const source = read("public/js/routes/feed.js");
  assert.match(source, /createFeedViews\(document, "\/", route\.view\)/);
  assert.match(source, /createFeedViews\(document, "\/c\/" \+ board\.slug, route\.view\)/);
  assert.match(source, /board\.slug !== SUGGESTIONS_BOARD\) main\.append\(createFeedViews/);
  assert.equal((source.match(/dataset\.view = (route\.)?view/g) || []).length, 3);
  assert.match(source, /const view = button\.dataset\.view;/);
  assert.equal((source.match(/feedViewQuery\(/g) || []).length >= 3, true);
});

test("feed-views.js is page-view only: no storage, no requests, no innerHTML", () => {
  const source = read("public/js/feed-views.js");
  assert.doesNotMatch(source, /localStorage|sessionStorage|api\(|fetch\(|innerHTML/);
});

test("new strings exist in en and are translated in all 20 locales", () => {
  const en = JSON.parse(read("public/locales/en.json"));
  for (const key of NEW_KEYS) assert.equal(typeof en[key], "string", key);
  for (const locale of LOCALES) {
    const bundle = JSON.parse(read("public/locales/" + locale + ".json"));
    for (const key of NEW_KEYS) {
      assert.equal(typeof bundle[key], "string", locale + " " + key);
      assert.notEqual(bundle[key], en[key], locale + " " + key + " is untranslated");
    }
  }
});
