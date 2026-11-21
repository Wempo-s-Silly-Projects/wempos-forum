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
// Wave 2026-11-21-35 F2 — End of feed + Back to top. After Load older brings
// in a feed's final page, the list closes with "You've reached the end of
// this feed." and a Back to top button that scrolls to and focuses the
// page's first heading. Page-view only: nothing stored, nothing requested.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { makeFakeDocument, findByClass } from "./helpers/fake-dom.mjs";
import { FEED_PAGE_SIZE } from "../constants.mjs";
import { t } from "../public/js/i18n.js";
import { FEED_END_PAGE_SIZE, createFeedEnd, reachedFeedEnd } from "../public/js/feed-end.js";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const NEW_KEYS = ["feed.endOfFeed", "feed.backToTop"];

test("feed end: the client page size matches the server's", () => {
  assert.equal(FEED_END_PAGE_SIZE, FEED_PAGE_SIZE);
});

test("feed end: only a non-empty final page reaches the end", () => {
  const posts = (n) => Array.from({ length: n }, (_, id) => ({ id }));
  assert.equal(reachedFeedEnd({ posts: posts(7), nextBefore: null }), true);
  assert.equal(reachedFeedEnd({ posts: posts(FEED_PAGE_SIZE), nextBefore: null }), true);
  assert.equal(reachedFeedEnd({ posts: posts(3), nextBefore: "1_5_9" }), true);
  assert.equal(reachedFeedEnd({ posts: posts(FEED_PAGE_SIZE), nextBefore: "1_5_9" }), false);
  // An empty page already shows the empty-state line; no second message.
  assert.equal(reachedFeedEnd({ posts: [], nextBefore: null }), false);
  assert.equal(reachedFeedEnd(null), false);
  assert.equal(reachedFeedEnd({ posts: "nope" }), false);
});

test("feed end (wave 40): an empty Load older page after a full page closes the list", () => {
  // A feed of exactly FEED_PAGE_SIZE posts still carries a cursor, so Load
  // older shows; the page it fetches is empty and must end the list.
  assert.equal(reachedFeedEnd({ posts: [], nextBefore: null }, { olderPage: true }), true);
  assert.equal(reachedFeedEnd(null, { olderPage: true }), true);
  // The first page keeps its empty-state line instead.
  assert.equal(reachedFeedEnd({ posts: [], nextBefore: null }, { olderPage: false }), false);
  const source = read("public/js/routes/feed.js");
  assert.match(source, /if \(reachedFeedEnd\(older, \{ olderPage: true \}\)\) main\.append\(createFeedEnd\(document, main\)\);/);
  // No "No posts yet" line under a feed that already shows posts.
  assert.match(source, /if \(older\.posts\.length\) appendPostList\(main, older\.posts,/);
});

test("feed end: renders the line and a Back to top button that focuses the first heading", () => {
  const document = makeFakeDocument();
  const scope = document.createElement("main");
  const heading = document.createElement("h2");
  heading.textContent = "Recent activity";
  scope.append(heading);
  const end = createFeedEnd(document, scope);
  scope.append(end);
  assert.equal(end.className, "feed-end");
  const text = findByClass(end, "feed-end-text");
  assert.equal(text.textContent, t("feed.endOfFeed"));
  assert.equal(text.getAttribute("role"), "status");
  const button = findByClass(end, "feed-end-top");
  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.type, "button");
  assert.equal(button.textContent, t("feed.backToTop"));
  button.dispatch("click", { preventDefault() {} });
  assert.equal(heading.ownerFocused, true);
  assert.equal(heading.getAttribute("tabindex"), "-1");
});

test("feed end: an h1 wins over later headings; no heading is a safe no-op", () => {
  const document = makeFakeDocument();
  const scope = document.createElement("main");
  const h2 = document.createElement("h2");
  const h1 = document.createElement("h1");
  scope.append(h2, h1);
  findByClass(createFeedEnd(document, scope), "feed-end-top").dispatch("click", { preventDefault() {} });
  assert.equal(h1.ownerFocused, true);
  const bare = document.createElement("main");
  assert.doesNotThrow(() => findByClass(createFeedEnd(document, bare), "feed-end-top").dispatch("click", {}));
});

test("feed end: page-view only, textContent only", () => {
  const source = read("public/js/feed-end.js");
  assert.doesNotMatch(source, /localStorage|sessionStorage|api\(|fetch\(|innerHTML/);
});

test("feed end: Load older closes the list on the final page", () => {
  const source = read("public/js/routes/feed.js");
  assert.match(source, /import \{ createFeedEnd, reachedFeedEnd \} from "\.\.\/feed-end\.js";/);
  assert.match(source, /if \(reachedFeedEnd\(older, \{ olderPage: true \}\)\) main\.append\(createFeedEnd\(document, main\)\);/);
  assert.match(read("public/index.html"), /<link rel="modulepreload" href="\/js\/feed-end\.js">/);
  assert.match(read("public/styles.css"), /\.feed-end \{/);
});

test("feed end: new strings exist in en and every locale, translated", () => {
  const dir = new URL("../public/locales/", import.meta.url);
  const en = JSON.parse(readFileSync(new URL("en.json", dir), "utf8"));
  const locales = readdirSync(dir).filter((name) => name.endsWith(".json") && name !== "en.json");
  assert.equal(locales.length, 20);
  for (const key of NEW_KEYS) {
    assert.equal(typeof en[key], "string", key);
    for (const name of locales) {
      const bundle = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
      assert.equal(typeof bundle[key], "string", name + " " + key);
      assert.notEqual(bundle[key], en[key], name + " " + key + " untranslated");
    }
  }
});
