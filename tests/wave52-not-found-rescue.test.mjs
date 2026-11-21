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

// Wave 5.2 F2: the 404 view offers a way out — back to the home feed, and a
// search for the words in the missed address. Page-view only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { makeFakeDocument } from "./helpers/fake-dom.mjs";
import { buildNotFoundLinks, notFoundQuery } from "../public/js/not-found.js";

const translate = (key, vars) => (vars ? `${key}:${vars.query}` : key);
const links = (root) => [...root.children];

test("notFoundQuery turns the missed address into search words", () => {
  assert.equal(notFoundQuery("/c/gamedev-tips"), "gamedev tips");
  assert.equal(notFoundQuery("/how_to/make%20a%20game"), "how to make game", "one-letter words are dropped");
  assert.equal(notFoundQuery("/users/wempo/friends"), "wempo friends");
  assert.equal(notFoundQuery("/posts/abc"), "abc");
  assert.equal(notFoundQuery("/índice/über-größe"), "índice über größe");
  assert.equal(notFoundQuery("/index.html"), "");
  assert.equal(notFoundQuery("/"), "");
  assert.equal(notFoundQuery("/x/y/z"), "", "single letters are noise");
  assert.equal(notFoundQuery("/%E0%A4%A"), "E0 A4", "a malformed escape falls back to the raw path");
});

test("notFoundQuery is bounded in words and length", () => {
  assert.equal(notFoundQuery("/one/two/three/four/five/six/seven"), "one two three four five");
  assert.ok(notFoundQuery(`/${"a".repeat(500)}`).length <= 60);
});

test("buildNotFoundLinks paints Home and a search link with textContent", () => {
  const root = buildNotFoundLinks(makeFakeDocument(), translate, "/c/gamedev-tips");
  assert.equal(root.className, "not-found-links");
  const [home, search] = links(root);
  assert.equal(home.tagName, "A");
  assert.equal(home.attributes.href, "/");
  assert.equal(home.textContent, "app.notFoundHome");
  assert.equal(search.attributes.href, "/?q=gamedev%20tips");
  assert.equal(search.textContent, "app.notFoundSearch:gamedev tips");
});

test("buildNotFoundLinks omits the search link when the address has no words", () => {
  const root = buildNotFoundLinks(makeFakeDocument(), translate, "/");
  assert.equal(links(root).length, 1);
});

test("markup-shaped words are painted as text, never parsed", () => {
  const root = buildNotFoundLinks(makeFakeDocument(), translate, "/%3Cimg%20src%3Dx%3E");
  const search = links(root)[1];
  assert.equal(search.attributes.href, "/?q=img%20src");
  const source = readFileSync(new URL("../public/js/not-found.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|localStorage|sessionStorage|api\(/);
});

test("the not-found view appends the rescue links", () => {
  const source = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");
  const body = source.match(/function renderNotFoundRoute\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(body, /buildNotFoundLinks\(document, t, location\.pathname\)/);
});

test("the rescue strings exist in en and are translated in all 40 other locales", () => {
  const dir = new URL("../public/locales/", import.meta.url);
  const en = JSON.parse(readFileSync(new URL("en.json", dir), "utf8"));
  for (const key of ["app.notFoundHome", "app.notFoundSearch"]) {
    assert.equal(typeof en[key], "string", key);
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".json") && name !== "en.json")) {
      const messages = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
      assert.equal(typeof messages[key], "string", `${file} ${key}`);
      assert.notEqual(messages[key], en[key], `${file} ${key} is translated`);
      if (key === "app.notFoundSearch") assert.match(messages[key], /\{query\}/, `${file} keeps {query}`);
    }
  }
});
