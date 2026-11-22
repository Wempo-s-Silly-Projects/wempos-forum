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

// Wave 5.29: fixes from the v5.28 security review
// (docs/security-reviews/2026-11-21-v5.24-v5.27.md). I2: a revealed spoiler
// is readable in high contrast (light and dark) while an unrevealed one stays
// blacked out. L1: Save as text skips replies the reply filter has hidden
// ([data-filtered-out] on the card or an ancestor). I1: a #reply-<id> hash
// does nothing for a filtered-out reply.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildThreadText } from "../public/js/thread-text.js";
import { anchorReplyCard, bindReplyHashChange, highlightReplyFromHash } from "../public/js/reply-anchor.js";
import { createPostCard } from "../public/js/render.js";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ORIGIN = "https://forum.example";
const AAA_RATIO = 7;

// --- I2: revealed spoilers in high contrast --------------------------------------------

const cssRules = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selector: selector.trim(), body }));
const declarations = (body) => Object.fromEntries([...body.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)]
  .map(([, name, value]) => [name, value.trim()]));

const HC_SELECTORS = [
  [":root.high-contrast", "light"],
  [':root.high-contrast[data-theme="dark"]', "dark (manual)"],
  [':root.high-contrast:not([data-theme="light"]):not([data-theme="dark"])', "dark (OS)"],
];

// Resolves var(--a, var(--b, #hex)) against one token block.
function resolve(value, tokens) {
  const match = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value.trim());
  if (!match) return value.trim();
  const [, name, fallback] = match;
  if (tokens[name] !== undefined) return resolve(tokens[name], tokens);
  assert.ok(fallback, `token ${name} has no value and no fallback`);
  return resolve(fallback, tokens);
}

function luminance(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(match, `expected a #rrggbb colour, got ${hex}`);
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(match[1].slice(at, at + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("a revealed spoiler is readable (>= 7:1) in light and dark high contrast", () => {
  const rules = cssRules(read("public/styles.css"));
  const revealed = declarations(rules.find((rule) => rule.selector === ".spoiler-revealed").body);
  assert.equal(revealed.color, "inherit", "revealed text takes the surrounding text colour");
  for (const [selector, label] of HC_SELECTORS) {
    const block = rules.find((rule) => rule.selector === selector);
    assert.ok(block, `high-contrast block ${label} found`);
    const tokens = declarations(block.body);
    const background = resolve(revealed.background, tokens);
    for (const ink of ["--ink", "--muted", "--link"]) {
      const ratio = contrast(resolve(`var(${ink})`, tokens), background);
      assert.ok(ratio >= AAA_RATIO, `${label}: ${ink} on revealed spoiler is ${ratio.toFixed(2)}:1`);
    }
  }
});

test("an unrevealed spoiler stays fully hidden: transparent text on solid ink, in every theme", () => {
  const rules = cssRules(read("public/styles.css"));
  const spoiler = declarations(rules.find((rule) => rule.selector === ".spoiler").body);
  assert.equal(spoiler.color, "transparent");
  assert.equal(spoiler.background, "var(--ink)");
  assert.equal(spoiler["user-select"], "none");
  const overrides = rules.filter((rule) => /\.spoiler(?![\w-])/.test(rule.selector) && rule.selector !== ".spoiler");
  for (const { selector, body } of overrides) {
    assert.doesNotMatch(body, /(?:^|;)\s*color\s*:/, `${selector} must not unmask the spoiler text`);
  }
});

// --- L1: Save as text skips filtered-out replies -----------------------------------------

const post = (id, username, body) => ({
  id, body, createdAt: "2026-11-21T10:05:00Z", author: { id, username },
  likeCount: 0, dislikeCount: 0, viewCount: 0,
});

test("buildThreadText skips a card with data-filtered-out and every card inside a filtered-out group", () => {
  const doc = makeFakeDocument({ documentElement: { dataset: {} }, body: new FakeNode("body") });
  const root = doc.createElement("main");
  root.append(createPostCard(post(7, "starter", "Thread title"), doc, null));
  const list = doc.createElement("div");
  list.className = "post-list replies-list";
  const shown = createPostCard(post(8, "ann", "Matching reply"), doc, null);
  const filtered = createPostCard(post(9, "bob", "Filtered card body"), doc, null);
  filtered.setAttribute("data-filtered-out", "");
  const group = doc.createElement("div");
  group.className = "sub-replies";
  group.setAttribute("data-filtered-out", "");
  group.append(createPostCard(post(10, "cat", "Filtered sub reply body"), doc, null));
  list.append(shown, filtered, group);
  root.append(list);
  const text = buildThreadText(root, { threadId: 7, origin: ORIGIN, siteName: "F" });
  assert.match(text, /Matching reply/);
  assert.doesNotMatch(text, /bob|Filtered card body/);
  assert.doesNotMatch(text, /cat|Filtered sub reply body/);
});

test("the thread-text comment promises filtered-out replies are skipped", () => {
  assert.match(read("public/js/thread-text.js"), /data-filtered-out/);
});

// --- I1: reply-anchor no-ops on filtered-out cards ---------------------------------------

test("a #reply-<id> hash (direct or via hashchange) is a no-op on a filtered-out reply", () => {
  const doc = makeFakeDocument({ documentElement: { dataset: {} } });
  const list = doc.createElement("div");
  const scrolled = [];
  const cards = [3, 4, 5].map((id) => {
    const card = createPostCard(post(id, "ann", "reply " + id), doc, null);
    card.scrollIntoView = () => scrolled.push(card.id);
    anchorReplyCard(doc, card, 7, { origin: ORIGIN });
    list.append(card);
    return card;
  });
  cards[0].setAttribute("data-filtered-out", "");
  const group = doc.createElement("div");
  group.setAttribute("data-filtered-out", "");
  list.append(group);
  group.append(cards[1]);
  const options = { reducedMotion: true, schedule: () => {} };
  assert.equal(highlightReplyFromHash(list, "#reply-3", options), null);
  assert.equal(highlightReplyFromHash(list, "#reply-4", options), null);
  const listeners = [];
  const win = { location: { hash: "#reply-3" }, addEventListener: (type, fn) => listeners.push([type, fn]) };
  bindReplyHashChange(win, () => list, options);
  listeners[0][1]();
  assert.deepEqual(scrolled, []);
  assert.equal(highlightReplyFromHash(list, "#reply-5", options), cards[2], "a shown reply still highlights");
});
