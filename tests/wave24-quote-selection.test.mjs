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

// Wave 24 F2: Quote uses the reader's selection inside that reply's body,
// spoilers always masked; anything else falls back to the masked snippet.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { FakeNode, FakeText } from "./helpers/fake-dom.mjs";
import { selectedQuoteText } from "../public/js/quote-selection.js";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const MASK = "▒▒▒";

const el = (tag, className, ...children) => {
  const node = new FakeNode(tag);
  if (className) node.className = className;
  for (const child of children) node.append(typeof child === "string" ? new FakeText(child) : child);
  return node;
};

// A reply card: header + one paragraph with a spoiler + a code block (with
// its copy button) + an actions row.
const buildCard = () => {
  const spoiler = el("span", "spoiler", "the butler");
  const paragraph = el("p", "post-body", "It was ", spoiler, " all along");
  const code = el("pre", "post-codeblock", el("button", "copy-code", "Copy"), el("code", "", "x = 1"));
  const header = el("header", "post-header", "ana");
  const card = el("article", "post-card", header, paragraph, code, el("div", "post-actions"));
  return { card, header, paragraph, spoiler, code };
};

// A selection whose range clones `fragmentChildren` and spans start..end.
const selectionOf = ({ start, end, common, fragment }) => ({
  isCollapsed: false,
  rangeCount: 1,
  getRangeAt: () => ({
    startContainer: start, endContainer: end, commonAncestorContainer: common,
    cloneContents: () => el("div", "", ...fragment),
  }),
});

test("selection inside the body is quoted, spoilers masked, copy buttons skipped", () => {
  const { card, paragraph, code } = buildCard();
  const selection = selectionOf({
    start: paragraph.childNodes[0], end: code.childNodes[1], common: card,
    fragment: [el("p", "post-body", "was ", el("span", "spoiler spoiler-revealed", "the butler"), " all along"),
      el("pre", "post-codeblock", el("button", "copy-code", "Copy"), el("code", "", "x = 1"))],
  });
  assert.equal(selectedQuoteText(selection, card), `was ${MASK} all along x = 1`);
});

test("a selection wholly inside one spoiler quotes only the mask", () => {
  const { card, spoiler } = buildCard();
  const text = spoiler.childNodes[0];
  const selection = selectionOf({ start: text, end: text, common: text, fragment: ["butler"] });
  assert.equal(selectedQuoteText(selection, card), MASK);
});

test("selections outside this card's body fall back (empty string)", () => {
  const { card, header, paragraph } = buildCard();
  const other = buildCard();
  const fromHeader = selectionOf({ start: header.childNodes[0], end: paragraph.childNodes[0], common: card, fragment: ["ana It was"] });
  assert.equal(selectedQuoteText(fromHeader, card), "");
  const otherCard = selectionOf({ start: other.paragraph.childNodes[0], end: other.paragraph.childNodes[0], common: other.paragraph.childNodes[0], fragment: ["It"] });
  assert.equal(selectedQuoteText(otherCard, card), "");
  assert.equal(selectedQuoteText({ isCollapsed: true, rangeCount: 1 }, card), "");
  assert.equal(selectedQuoteText(null, card), "");
});

test("a sub-reply nested in the card is not quoted as the parent's text", () => {
  const { card } = buildCard();
  const nested = buildCard();
  card.append(nested.card);
  const inner = nested.paragraph.childNodes[0];
  const selection = selectionOf({ start: inner, end: inner, common: inner, fragment: ["It was"] });
  assert.equal(selectedQuoteText(selection, card), "");
  assert.equal(selectedQuoteText(selection, nested.card), "It was");
});

test("Quote prefers the selection and keeps the masked snippet as fallback", () => {
  const post = read("public/js/routes/post.js");
  assert.match(post, /selectedQuoteText\(document\.getSelection\?\.\(\) \?\? null, card\)/);
  assert.match(post, /selected \|\| button\.dataset\.quoteSnippet/);
  assert.match(read("public/js/render.js"), /quoteButton\.title = t\("render\.quoteTitle"\)/);
});

test("render.quoteTitle exists and is translated in every locale", () => {
  const dir = new URL("../public/locales/", import.meta.url);
  const en = JSON.parse(readFileSync(new URL("en.json", dir), "utf8"));
  assert.ok(en["render.quoteTitle"]);
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 66);
  for (const file of files.filter((name) => name !== "en.json")) {
    const locale = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
    assert.ok(locale["render.quoteTitle"], file);
    assert.notEqual(locale["render.quoteTitle"], en["render.quoteTitle"], file + " is untranslated");
  }
});
