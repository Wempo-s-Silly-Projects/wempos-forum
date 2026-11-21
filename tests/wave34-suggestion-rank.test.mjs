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

// Wave 2026-11-21-34 F2 (unique): Suggestions cards carry their place in the
// vote order ("#1", "#2", ...). Load older continues the count; nested cards
// (reply previews) are never numbered; page-view only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeFakeDocument } from "./helpers/fake-dom.mjs";
import { numberSuggestionCards } from "../public/js/suggestion-rank.js";
import { t } from "../public/js/i18n.js";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const LOCALES = ["ar", "de", "es", "fr", "he", "hi", "id", "it", "ja", "ko", "nl", "pl", "pt", "ru", "th", "tr", "uk", "vi", "zh-Hans", "zh-Hant",
  "bg", "bn", "ca", "cs", "da", "el", "fa", "fi", "fil", "hr", "hu", "ms", "nb", "ro", "sk", "sr", "sv", "sw", "ta", "ur"];

function card(document, id) {
  const article = document.createElement("article");
  article.className = "post-card";
  article.dataset.postId = String(id);
  const header = document.createElement("header");
  header.className = "post-header";
  const author = document.createElement("div");
  author.className = "post-author";
  header.append(author);
  article.append(header);
  return article;
}

function list(document, ids) {
  const div = document.createElement("div");
  div.className = "post-list";
  for (const id of ids) div.append(card(document, id));
  return div;
}

const ranks = (root) => [...root.querySelectorAll("span.suggestion-rank")].map((badge) => badge.textContent);

test("cards are numbered in page order, badge first in the author row", () => {
  const document = makeFakeDocument();
  const main = document.createElement("main");
  main.append(list(document, [9, 4, 7]));
  numberSuggestionCards(document, main);
  assert.deepEqual(ranks(main), ["#1", "#2", "#3"]);
  const firstAuthor = main.querySelector("div.post-author");
  assert.equal(firstAuthor.children[0].className, "suggestion-rank");
  assert.equal(firstAuthor.children[0].getAttribute("aria-hidden"), "true");
  assert.equal(firstAuthor.children[1].className, "visually-hidden");
  assert.equal(firstAuthor.children[1].textContent, t("feed.suggestionRank", { rank: 1 }));
});

test("Load older continues the count and never re-numbers a card", () => {
  const document = makeFakeDocument();
  const main = document.createElement("main");
  main.append(list(document, [9, 4, 7]));
  numberSuggestionCards(document, main);
  main.append(list(document, [3, 2]));
  numberSuggestionCards(document, main);
  assert.deepEqual(ranks(main), ["#1", "#2", "#3", "#4", "#5"]);
});

test("nested cards inside a card are not numbered", () => {
  const document = makeFakeDocument();
  const main = document.createElement("main");
  const outer = list(document, [9, 4]);
  outer.children[0].append(card(document, 99));
  main.append(outer);
  numberSuggestionCards(document, main);
  assert.deepEqual(ranks(main), ["#1", "#2"]);
});

test("an empty page numbers nothing", () => {
  const document = makeFakeDocument();
  const main = document.createElement("main");
  numberSuggestionCards(document, main);
  assert.deepEqual(ranks(main), []);
});

test("feed.js numbers Suggestions on first paint and on Load older only", () => {
  const source = read("public/js/routes/feed.js");
  assert.match(source, /import \{ numberSuggestionCards \} from "\.\.\/suggestion-rank\.js";/);
  assert.match(source, /if \(board\.slug === SUGGESTIONS_BOARD\) numberSuggestionCards\(document, main\);/);
  assert.match(source, /if \(board === SUGGESTIONS_BOARD\) numberSuggestionCards\(document, main\);/);
  assert.equal((source.match(/numberSuggestionCards\(/g) || []).length, 2);
});

test("suggestion-rank.js is page-view only and the badge is styled", () => {
  const source = read("public/js/suggestion-rank.js");
  assert.doesNotMatch(source, /localStorage|sessionStorage|api\(|fetch\(|innerHTML/);
  assert.match(read("public/styles.css"), /\.suggestion-rank \{/);
});

test("the rank label exists in en and is translated in all 20 locales", () => {
  const en = JSON.parse(read("public/locales/en.json"));
  assert.equal(typeof en["feed.suggestionRank"], "string");
  assert.match(en["feed.suggestionRank"], /\{rank\}/);
  for (const locale of LOCALES) {
    const bundle = JSON.parse(read("public/locales/" + locale + ".json"));
    assert.equal(typeof bundle["feed.suggestionRank"], "string", locale);
    assert.notEqual(bundle["feed.suggestionRank"], en["feed.suggestionRank"], locale + " untranslated");
    assert.match(bundle["feed.suggestionRank"], /\{rank\}/, locale + " keeps {rank}");
  }
});
