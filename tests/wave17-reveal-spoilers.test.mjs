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

// Wave 2026-11-21-17 F2: "Show spoilers" — one button on a post or reply that
// has spoilers reveals all of that card's spoilers at once. Client-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";
import { parseInline } from "../public/js/markdown.js";
import { createRevealSpoilersButton, hasSpoilers } from "../public/js/reveal-spoilers.js";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const fakeDocument = makeFakeDocument();
const revealed = (node) => /\bspoiler-revealed\b/.test(node.className);

function cardWith(text) {
  const article = new FakeNode("article");
  const paragraph = new FakeNode("p");
  paragraph.append(...parseInline(fakeDocument, text));
  article.append(paragraph);
  return article;
}

test("hasSpoilers is true only when the post page would render a spoiler", () => {
  assert.equal(hasSpoilers("it ends when ||he dies||"), true);
  assert.equal(hasSpoilers("a || b"), false);
  assert.equal(hasSpoilers("```\n||kept||\n```"), false);
  assert.equal(hasSpoilers(null), false);
});

test("Show spoilers reveals every spoiler on its own card, then steps aside", async () => {
  const article = cardWith("one ||a|| two ||b||");
  const nested = cardWith("nested ||c||");
  article.append(nested);
  const button = createRevealSpoilersButton(fakeDocument, article);
  article.append(button);
  assert.equal(button.type, "button");
  assert.equal(button.textContent, "render.revealSpoilers");
  await button.fire("click");
  const own = Array.from(article.querySelectorAll(".spoiler")).filter((node) => node.closest("article") === article);
  assert.equal(own.length, 2);
  assert.ok(own.every(revealed), "own spoilers revealed");
  assert.equal(revealed(nested.querySelector(".spoiler")), false, "a nested card keeps its spoilers");
  assert.equal(button.hidden, true);
});

test("post cards offer Show spoilers only when the body has spoilers", () => {
  const source = read("public/js/render.js");
  assert.match(source, /if \(hasSpoilers\(post\.body\)\) actions\.append\(createRevealSpoilersButton\(document, article\)\)/);
});

test("render.revealSpoilers is translated in every locale", () => {
  const en = JSON.parse(read("public/locales/en.json"))["render.revealSpoilers"];
  assert.equal(en, "Show spoilers");
  for (const file of readdirSync(new URL("public/locales/", ROOT))) {
    const value = JSON.parse(read("public/locales/" + file))["render.revealSpoilers"];
    assert.ok(typeof value === "string" && value.trim(), file);
    if (file !== "en.json") assert.notEqual(value, en, file + " is untranslated");
  }
});
