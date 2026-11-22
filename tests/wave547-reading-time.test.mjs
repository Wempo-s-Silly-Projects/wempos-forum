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

// v5.47.0 F2: thread reading time — client only. Under the thread title,
// "N min read" when the root + rendered replies reach READING_TIME_MIN_WORDS
// (400) words at READING_WPM (230). Words come from the MASKED text (a
// spoiler counts as its mask, never unmasked). No storage, no request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeFakeDocument } from "./helpers/fake-dom.mjs";
import { GROWTH_FACTOR, LINEAR_GROWTH_CEILING, growthRatio } from "./helpers/timing.mjs";
import {
  READING_TIME_MIN_WORDS, READING_WPM, createReadingTime, readingMinutes, threadWordCount,
} from "../public/js/reading-time.js";
import { createTranslator, tn } from "../public/js/i18n.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const words = (n, word = "word") => Array.from({ length: n }, () => word).join(" ");
const post = (body, extra = {}) => ({ id: 1, body, parent: null, ...extra });

test("constants: 400-word threshold, 230 words per minute", () => {
  assert.equal(READING_TIME_MIN_WORDS, 400);
  assert.equal(READING_WPM, 230);
});

test("word count: root + replies, whitespace-split, empty/odd bodies count zero", () => {
  assert.equal(threadWordCount(post("one two  three\nfour"), [{ body: "five six" }, { body: "" }, { body: null }, {}]), 6);
  assert.equal(threadWordCount(post("   "), null), 0);
  assert.equal(threadWordCount(null, [{ body: "a b" }]), 2);
});

test("spoilers count as their masked form and the text is never unmasked", () => {
  const secret = "the butler did it with the candlestick in the library";
  const root = post("before ||" + secret + "|| after");
  assert.equal(threadWordCount(root, []), 3, "a masked spoiler is one token");
  const doc = makeFakeDocument();
  const long = post(words(398) + " ||" + secret + "||", { replies: [] });
  const node = createReadingTime(doc, long, []);
  // 398 + 1 masked token = 399 < 400: no line, and the secret never paints.
  assert.equal(node, null);
  const enough = createReadingTime(doc, post(words(400) + " ||" + secret + "||"), []);
  assert.ok(enough);
  assert.ok(!enough.textContent.includes("butler"));
});

test("threshold: 399 words -> nothing; 400 words (root + replies) -> a line", () => {
  const doc = makeFakeDocument();
  assert.equal(createReadingTime(doc, post(words(399)), []), null);
  assert.equal(createReadingTime(doc, post(words(200)), [{ body: words(199) }]), null);
  const line = createReadingTime(doc, post(words(200)), [{ body: words(100) }, { body: words(100) }]);
  assert.ok(line);
  assert.equal(line.tagName, "P");
  assert.equal(line.className, "thread-reading-time");
  assert.equal(line.textContent, tn("readingTime.minutes", 2));
});

test("replies are not thread roots: no line on a reply page", () => {
  const doc = makeFakeDocument();
  assert.equal(createReadingTime(doc, post(words(2000), { parent: { id: 9 } }), []), null);
});

test("minutes round up and never drop below 1; pluralization follows the locale", () => {
  assert.equal(readingMinutes(0), 1);
  assert.equal(readingMinutes(230), 1);
  assert.equal(readingMinutes(231), 2);
  assert.equal(readingMinutes(400), 2);
  assert.equal(readingMinutes(2300), 10);
  const en = JSON.parse(read("public/locales/en.json"));
  const english = createTranslator("en", en, en);
  assert.equal(english.tn("readingTime.minutes", 1), "1 min read");
  assert.equal(english.tn("readingTime.minutes", 2), "2 min read");
  const fr = createTranslator("fr", JSON.parse(read("public/locales/fr.json")), en);
  assert.notEqual(fr.tn("readingTime.minutes", 3), english.tn("readingTime.minutes", 3));
  assert.match(fr.tn("readingTime.minutes", 3), /3/);
  for (const code of ["ar", "ru", "ja", "pl"]) {
    const table = JSON.parse(read("public/locales/" + code + ".json"));
    for (const form of ["one", "other"]) {
      assert.match(table["readingTime.minutes." + form], /\{count\}/, code + " " + form);
    }
  }
});

test("thread page: the line sits right under the title, roots only, and the module stays page-only", () => {
  const route = read("public/js/routes/post.js");
  assert.match(route, /addHeading\(main, t\("post\.conversationTitle"\), 1\);\s*\n[\s\S]{0,300}createReadingTime\(document, post, post\.replies\)/);
  const src = read("public/js/reading-time.js");
  assert.doesNotMatch(src, /localStorage|sessionStorage|api\(|fetch\(/);
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.match(src, /maskSpoilers/);
  assert.match(read("public/index.html"), /<link rel="modulepreload" href="\/js\/reading-time\.js/);
});

test("speed: counting grows linearly with the thread", () => {
  const replies = (n) => Array.from({ length: n }, () => ({ body: words(200) + " ||spoiler here|| tail" }));
  const count = (list) => threadWordCount(post("root"), list);
  const { ratio } = growthRatio(count, replies(50), replies(50 * GROWTH_FACTOR));
  assert.ok(ratio < LINEAR_GROWTH_CEILING, "ratio " + ratio);
});
