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

// Wave 5.7 F2: "Regulars on this page" on category pages. Derived only from
// the feed payload already on screen (which obeys the visibility law), so
// no new query, no storage, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  REGULARS_MAX, REGULAR_MIN_TOPICS, createBoardRegulars, pickRegulars,
} from "../public/js/board-regulars.js";
import { t } from "../public/js/i18n.js";
import { FakeNode, FakeText, makeFakeDocument } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const post = (id, username) => ({ id: Math.random(), author: { id, username } });
const posts = (...pairs) => pairs.flatMap(([id, username, n]) => Array.from({ length: n }, () => post(id, username)));

test("constants: 2+ topics to qualify, at most 3 names", () => {
  assert.equal(REGULAR_MIN_TOPICS, 2);
  assert.equal(REGULARS_MAX, 3);
});

test("pickRegulars: needs 2+ topics, most topics first, ties by name, capped at 3", () => {
  assert.deepEqual(pickRegulars(posts([1, "ana", 1], [2, "bo", 1])), []);
  assert.deepEqual(pickRegulars(posts([1, "ana", 2], [2, "bo", 1])).map((r) => r.username), ["ana"]);
  const many = posts([1, "zed", 2], [2, "ana", 2], [3, "bo", 5], [4, "cy", 3], [5, "di", 2]);
  assert.deepEqual(pickRegulars(many), [
    { id: 3, username: "bo", count: 5 },
    { id: 4, username: "cy", count: 3 },
    { id: 2, username: "ana", count: 2 },
  ]);
});

test("pickRegulars counts by author id, so a renamed member is one regular", () => {
  const list = [post(7, "old"), post(7, "new"), post(8, "x")];
  assert.deepEqual(pickRegulars(list), [{ id: 7, username: "old", count: 2 }]);
});

test("pickRegulars ignores malformed rows and non-arrays", () => {
  const junk = [null, {}, { author: null }, { author: { id: "x", username: "a" } },
    { author: { id: 3 } }, { author: { id: 3, username: "" } }, post(9, "ok"), post(9, "ok")];
  assert.deepEqual(pickRegulars(junk), [{ id: 9, username: "ok", count: 2 }]);
  assert.deepEqual(pickRegulars(undefined), []);
  assert.deepEqual(pickRegulars("nope"), []);
});

test("createBoardRegulars: null when nobody qualifies", () => {
  assert.equal(createBoardRegulars(makeFakeDocument(), posts([1, "ana", 1])), null);
  assert.equal(createBoardRegulars(makeFakeDocument(), []), null);
});

test("createBoardRegulars: label then profile links, usernames as text, hrefs encoded", () => {
  const node = createBoardRegulars(makeFakeDocument(), posts([1, "<b>x</b>", 3], [2, "a b", 2]));
  assert.ok(node instanceof FakeNode);
  assert.equal(node.tagName, "P");
  assert.equal(node.className, "muted board-regulars");
  const [label, first, comma, second] = node.childNodes;
  assert.ok(label instanceof FakeText);
  assert.equal(label.textContent, t("feed.regularsHere") + " ");
  assert.equal(first.tagName, "A");
  assert.equal(first.className, "board-regular");
  assert.equal(first.textContent, "<b>x</b>");
  assert.equal(first.getAttribute("href"), "/users/%3Cb%3Ex%3C%2Fb%3E");
  assert.equal(first.getAttribute("data-app-link"), "");
  assert.equal(comma.textContent, t("counts.separator"));
  assert.equal(second.textContent, "a b");
  assert.equal(second.getAttribute("href"), "/users/a%20b");
  assert.equal(node.childNodes.length, 4);
});

test("wiring: category pages mount it under the blurb, never on staff-only Updates", () => {
  const feed = read("public/js/routes/feed.js");
  assert.match(feed, /import \{ createBoardRegulars \} from "\.\.\/board-regulars\.js";/);
  assert.match(feed, /addText\(document, main, "p", board\.blurb, "muted"\);\n\s*const regulars = board\.staffOnly \? null : createBoardRegulars\(document, data\.feed\.posts\);\n\s*if \(regulars\) main\.append\(regulars\);/);
  assert.match(read("public/styles.css"), /\.board-regulars \{/);
  assert.match(read("public/index.html"), /<link rel="modulepreload" href="\/js\/board-regulars\.js">/);
});

test("page view only: no network, no storage, no innerHTML", () => {
  assert.doesNotMatch(read("public/js/board-regulars.js"), /\bapi\(|fetch\(|localStorage|sessionStorage|innerHTML/);
});

test("wave 5.7 F2: the key is in en.json and translated in all 56 other locales", () => {
  const dir = new URL("../public/locales/", import.meta.url);
  const en = JSON.parse(readFileSync(new URL("en.json", dir), "utf8"));
  const others = readdirSync(dir).filter((name) => name.endsWith(".json") && name !== "en.json");
  assert.equal(others.length, 56);
  assert.equal(typeof en["feed.regularsHere"], "string");
  for (const name of others) {
    const messages = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
    assert.equal(typeof messages["feed.regularsHere"], "string", name);
    assert.notEqual(messages["feed.regularsHere"], en["feed.regularsHere"], name + " is untranslated");
  }
});
