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

// v5.23.0 F1: print-friendly threads. One @media print block in the site
// stylesheet hides the chrome (header, nav, composer, chat, buttons, footer
// text, toasts, dialogs), keeps the thread title and every post with its
// author and date, prints black on white, keeps a post on one page where it
// can, and spells out where external links go. CSS only: no script, no
// strings, so style-src 'self' and the i18n sweep are untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

// Returns the body of the first `@media print { ... }` block (brace-matched).
function printBlock(css) {
  const start = css.search(/@media\s+print\s*\{/);
  if (start === -1) return null;
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(open + 1, index);
  }
  return null;
}

// [{ selectors: [...], body }] for the flat rules inside the block.
function rules(block) {
  return [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectorText, body]) => ({
    selectors: selectorText.split(",").map((selector) => selector.trim()).filter(Boolean),
    body: body.trim(),
  }));
}

const css = stripComments(read("public/styles.css"));
const block = printBlock(css);

function declarationsFor(selector) {
  return rules(block ?? "")
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.body)
    .join(";");
}

test("the site stylesheet carries exactly one @media print block", () => {
  assert.notEqual(block, null, "no @media print block in public/styles.css");
  assert.equal(css.match(/@media\s+print\b/g).length, 1);
});

test("print hides the site chrome", () => {
  const hidden = [
    ".site-header", ".mobile-bar", ".status-bar", ".skip-link", "nav", "form", "button", "dialog",
    ".chat-widget-launcher", ".chat-widget-panel", ".who-online", ".post-actions", "#version-tag",
  ];
  for (const selector of hidden) {
    assert.match(declarationsFor(selector), /display\s*:\s*none\s*!important/, selector + " is not hidden in print");
  }
});

test("print keeps only the source link in the footer", () => {
  assert.match(declarationsFor(".site-footer p"), /visibility\s*:\s*hidden/);
  assert.match(declarationsFor(".site-footer [data-source-link]"), /visibility\s*:\s*visible/);
});

test("print never hides the thread title, the posts, their authors or their dates", () => {
  const kept = [".post-card", ".post-header", ".post-author", ".post-time", ".post-body", "main", "h1", "h2"];
  for (const rule of rules(block ?? "")) {
    if (!/display\s*:\s*none|visibility\s*:\s*hidden/.test(rule.body)) continue;
    for (const selector of kept) {
      assert.ok(!rule.selectors.includes(selector), selector + " must stay printed");
    }
  }
});

test("print unfolds folded replies and clipped long posts", () => {
  assert.match(declarationsFor(".post-card[data-folded] > *"), /display\s*:\s*revert\s*!important/);
  const clipped = declarationsFor(".post-body-fold-content");
  assert.match(clipped, /max-height\s*:\s*none\s*!important/);
  assert.match(clipped, /mask-image\s*:\s*none\s*!important/);
  assert.match(clipped, /overflow\s*:\s*visible\s*!important/);
});

test("a post avoids breaking across pages", () => {
  assert.match(declarationsFor(".post-card"), /break-inside\s*:\s*avoid/);
});

test("print is black on white", () => {
  const page = declarationsFor("body");
  assert.match(page, /color\s*:\s*#000\s*!important/);
  assert.match(page, /background\s*:\s*#fff\s*!important/);
});

test("external links print their target after the text", () => {
  assert.match(declarationsFor('a[href^="http"]::after'), /content\s*:\s*" \(" attr\(href\) "\)"/);
});

test("F1 is CSS only: index.html keeps its two stylesheets and no print script", () => {
  const html = read("public/index.html");
  assert.equal((html.match(/rel="stylesheet"/g) || []).length, 2);
  assert.doesNotMatch(html, /window\.print|onbeforeprint|<style/);
});
