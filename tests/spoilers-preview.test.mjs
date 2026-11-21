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

// Wave 2026-11-21-3 F2 (spoiler tags) + F3 (composer preview).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { maskSpoilers, parseInline, revealSpoiler } from "../public/js/markdown.js";
import { createComposePreview } from "../public/js/compose-preview.js";

import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const fakeDocument = makeFakeDocument();
const spoilersIn = (nodes) => nodes.filter((node) => node.className?.split(" ").includes("spoiler"));

// --- F2: spoiler tags ------------------------------------------------------------

test("||text|| becomes one hidden spoiler button holding the text", () => {
  const nodes = parseInline(fakeDocument, "before ||Snape kills Dumbledore|| after");
  const [spoiler] = spoilersIn(nodes);
  assert.ok(spoiler, "no spoiler node");
  assert.equal(spoiler.tagName, "SPAN");
  assert.equal(spoiler.textContent, "Snape kills Dumbledore");
  assert.equal(spoiler.getAttribute("role"), "button");
  assert.equal(spoiler.getAttribute("tabindex"), "0");
  assert.equal(spoiler.getAttribute("aria-expanded"), "false");
  assert.ok(spoiler.getAttribute("aria-label"));
  assert.equal(nodes.map((node) => node.textContent).join(""), "before Snape kills Dumbledore after");
});

test("unterminated or empty spoiler markers stay literal", () => {
  for (const text of ["a || b", "a |||| b", "just | pipes | here"]) {
    const nodes = parseInline(fakeDocument, text);
    assert.equal(spoilersIn(nodes).length, 0, text);
    assert.equal(nodes.map((node) => node.textContent).join(""), text);
  }
});

test("spoilers sit beside other inline markup", () => {
  const nodes = parseInline(fakeDocument, "**bold** ||secret|| `code`");
  assert.deepEqual(nodes.filter((node) => node.tagName).map((node) => node.tagName), ["STRONG", "SPAN", "CODE"]);
});

test("revealing drops the button semantics; click, Enter and Space reveal", () => {
  const direct = spoilersIn(parseInline(fakeDocument, "||a||"))[0];
  revealSpoiler(direct);
  assert.match(direct.className, /spoiler-revealed/);
  assert.equal(direct.getAttribute("role"), null);
  assert.equal(direct.getAttribute("aria-label"), null);
  // Wave 7 a11y: tabindex -1 keeps keyboard focus in place after a reveal,
  // and aria-expanded leaves with the button role.
  assert.equal(direct.getAttribute("tabindex"), "-1");
  assert.equal(direct.getAttribute("aria-expanded"), null);
  const clicked = spoilersIn(parseInline(fakeDocument, "||b||"))[0];
  clicked.dispatch("click");
  assert.match(clicked.className, /spoiler-revealed/);
  for (const key of ["Enter", " "]) {
    const keyed = spoilersIn(parseInline(fakeDocument, "||c||"))[0];
    keyed.dispatch("keydown", { key: "Tab" });
    assert.doesNotMatch(keyed.className, /spoiler-revealed/);
    keyed.dispatch("keydown", { key });
    assert.match(keyed.className, /spoiler-revealed/);
  }
});

test("maskSpoilers hides spoiler text in preview snippets", () => {
  assert.equal(maskSpoilers("it ends when ||he dies|| lol"), "it ends when ▒▒▒ lol");
  assert.equal(maskSpoilers("a || b"), "a || b");
  assert.equal(maskSpoilers(null), "");
  assert.match(read("public/js/render.js"), /maskSpoilers\(/);
  assert.match(read("public/js/routes/feed.js"), /maskSpoilers\(reply\.body\)/);
});

test("spoiler styling exists and keeps the text unreadable until revealed", () => {
  const css = read("public/styles.css");
  assert.match(css, /\.spoiler\s*\{/);
  assert.match(css, /\.spoiler-revealed\s*\{/);
});

// --- F3: composer preview --------------------------------------------------------

test("preview toggle renders the draft through the post renderer, never edits it", () => {
  const field = new FakeNode("textarea");
  field.value = "hello **world** ||shh||";
  const wrapper = createComposePreview(field, fakeDocument);
  const button = Array.from(wrapper.children).find((node) => node.tagName === "BUTTON");
  const pane = Array.from(wrapper.children).find((node) => node.tagName === "DIV");
  assert.equal(button.type, "button");
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.equal(pane.hidden, true);
  button.dispatch("click");
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(pane.hidden, false);
  assert.match(pane.textContent, /hello world shh/);
  field.value = "changed";
  field.dispatch("input");
  assert.match(pane.textContent, /changed/);
  assert.equal(field.value, "changed");
  button.dispatch("click");
  assert.equal(pane.hidden, true);
  assert.equal(button.getAttribute("aria-pressed"), "false");
});

test("an empty draft previews as a friendly note", () => {
  const field = new FakeNode("textarea");
  field.value = "   ";
  const wrapper = createComposePreview(field, fakeDocument);
  Array.from(wrapper.children).find((node) => node.tagName === "BUTTON").dispatch("click");
  const pane = Array.from(wrapper.children).find((node) => node.tagName === "DIV");
  assert.equal(pane.children.length, 1);
  assert.match(pane.children[0].className, /compose-preview-empty/);
});

test("composer wires the preview; module uses the shared renderer, no innerHTML/api", () => {
  const composer = read("public/js/routes/composer.js");
  assert.match(composer, /from "\.\.\/compose-preview\.js"/);
  assert.match(composer, /createComposePreview\(bodyField, document\)/);
  const module = read("public/js/compose-preview.js");
  assert.match(module, /renderBodyBlocks/);
  assert.doesNotMatch(module, /innerHTML|\bapi\(/);
});
