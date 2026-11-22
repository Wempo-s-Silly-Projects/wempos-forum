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

// Wave 5.28: security pins for v5.24.0-v5.27.0 (review:
// docs/security-reviews/2026-11-21-v5.24-v5.27.md). No bug behind these;
// they hold the properties the review checked so a later change cannot
// quietly undo them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { anchorReplyCard, bindReplyHashChange, highlightReplyFromHash, parseReplyHash } from "../public/js/reply-anchor.js";
import { buildThreadText, threadFileName } from "../public/js/thread-text.js";
import { startReadingProgress, stopReadingProgress } from "../public/js/reading-progress.js";
import { QUIET_HOURS_STORAGE_KEY, writeQuietHours } from "../public/js/quiet-hours.js";
import { createLineSpacingPicker, LINE_SPACING_STORAGE_KEY } from "../public/js/reading-comfort.js";
import { createContrastPicker, CONTRAST_STORAGE_KEY } from "../public/js/high-contrast.js";
import { createPostCard, openEditForm, renderEditHistoryPanel } from "../public/js/render.js";
import { SPOILER_MASK } from "../public/js/markdown.js";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ORIGIN = "https://forum.example";

const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
};

const post = (id, body) => ({
  id, body, createdAt: "2026-11-21T10:00:00Z", author: { id, username: "user" + id },
  likeCount: 0, dislikeCount: 0, viewCount: 0,
});

// --- reply anchors (v5.25) ---------------------------------------------------------------

test("reply hash: selector-shaped, unicode-digit and padded hashes are refused", () => {
  for (const hash of [
    '#reply-1"],a[x="', "#reply-1,#x", "#reply-1 ", " #reply-1", "#reply-\u0661", "#reply-1\u202e",
    "#reply-", "#reply-1234567890123456", "#REPLY-1", "#reply-1#reply-2", "#reply-0x1f",
  ]) {
    assert.equal(parseReplyHash(hash), null, JSON.stringify(hash));
  }
  assert.equal(parseReplyHash("#reply-42"), "42");
});

test("reply hash: the hash never reaches a selector; only the fixed card selector is queried", () => {
  const doc = makeFakeDocument({ documentElement: { dataset: {} } });
  const list = doc.createElement("div");
  const card = createPostCard(post(5, "five"), doc, null);
  card.scrollIntoView = () => {};
  anchorReplyCard(doc, card, 1, { origin: ORIGIN });
  list.append(card);
  const selectors = [];
  const realAll = list.querySelectorAll.bind(list);
  list.querySelectorAll = (selector) => { selectors.push(selector); return realAll(selector); };
  list.querySelector = (selector) => { selectors.push(selector); throw new Error("querySelector must not be used"); };
  for (const hash of ["#reply-5", '#reply-5"],*', "#x"]) {
    highlightReplyFromHash(list, hash, { reducedMotion: true, schedule: () => {} });
  }
  assert.deepEqual([...new Set(selectors)], ["article.post-card"]);
});

test("reply anchor: a card whose post id is not plain digits gets no id and no reply link", () => {
  const doc = makeFakeDocument({ documentElement: { dataset: {} } });
  const card = createPostCard(post(6, "six"), doc, null);
  card.dataset.postId = '6" onmouseover="x';
  anchorReplyCard(doc, card, 1, { origin: ORIGIN });
  assert.equal(card.id, "");
  assert.equal(card.attributes.id, undefined);
});

// --- save thread as text (v5.26) -------------------------------------------------------

function threadRoot(doc, posts) {
  const root = doc.createElement("main");
  const cards = posts.map((entry) => createPostCard(entry, doc, null));
  root.append(...cards);
  return { root, cards };
}

test("thread text: an open edit form and an edit-history panel never reach the file", () => {
  const doc = makeFakeDocument({ documentElement: { dataset: {} }, body: new FakeNode("body") });
  const { root, cards } = threadRoot(doc, [post(1, "Root body"), post(2, "Saved reply body")]);
  assert.equal(openEditForm(cards[1], doc), true);
  const textarea = cards[1].querySelector("textarea");
  textarea.value = "UNSENT EDIT DRAFT";
  textarea.textContent = "UNSENT EDIT DRAFT";
  cards[0].append(renderEditHistoryPanel(doc, [{ editedAt: "2026-11-20T10:00:00Z", body: "OLD VERSION TEXT" }]));
  const text = buildThreadText(root, { threadId: 1, origin: ORIGIN, siteName: "F" });
  assert.doesNotMatch(text, /UNSENT EDIT DRAFT/);
  assert.doesNotMatch(text, /OLD VERSION TEXT/);
  assert.match(text, /Root body/);
});

test("thread text: unrevealed spoilers stay masked inside quotes, lists and headings", () => {
  const doc = makeFakeDocument({ documentElement: { dataset: {} }, body: new FakeNode("body") });
  const { root } = threadRoot(doc, [
    post(1, "Root"),
    post(2, "> quoted ||quote secret||\n\n- item ||list secret||\n\n# Heading ||heading secret||"),
  ]);
  const text = buildThreadText(root, { threadId: 1, origin: ORIGIN, siteName: "F" });
  assert.doesNotMatch(text, /quote secret|list secret|heading secret/);
  assert.ok(text.split(SPOILER_MASK).length - 1 >= 3, "each spoiler left as the mask");
});

test("thread text: markup in a body is carried as literal text", () => {
  const doc = makeFakeDocument({ documentElement: { dataset: {} }, body: new FakeNode("body") });
  const { root } = threadRoot(doc, [post(1, "<img src=x onerror=alert(1)> and <script>x</script>")]);
  const text = buildThreadText(root, { threadId: 1, origin: ORIGIN, siteName: "F" });
  assert.match(text, /<img src=x onerror=alert\(1\)> and <script>x<\/script>/);
});

test("thread file name: RTL overrides, control chars, path and reserved chars never survive", () => {
  const nasty = [
    "evil\u202etxt.exe", "a\u0000b\u0007c", "../../etc/passwd", "C:\\Windows\\x", "con:aux|nul?*<>\"",
    "\u200b\u2066\u2069zero", "\u0627\u0644\u0639\u0631\u0628\u064a\u0629", "  .  ", "\ud83d\ude00",
  ];
  for (const title of nasty) {
    assert.match(threadFileName(title, 7), /^[a-z0-9]+(-[a-z0-9]+)*-7\.txt$/, JSON.stringify(title));
  }
  for (const id of ["7/../x", "7\u202e", "-1", "1e3", ""]) {
    assert.match(threadFileName("ok", id), /^ok\.txt$/, JSON.stringify(id));
  }
});

// --- storage: wipe vs survive (v5.25, v5.27) -------------------------------------------

test("quiet hours stores only enabled/start/end, never anything account-shaped", () => {
  const storage = memoryStorage();
  writeQuietHours(storage, { enabled: true, start: 1, end: 2, userId: 7, username: "ann", token: "t" });
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(QUIET_HOURS_STORAGE_KEY))).sort(), ["enabled", "end", "start"]);
});

test("surviving reading prefs only ever store their fixed values", () => {
  const storage = memoryStorage();
  const doc = makeFakeDocument({ documentElement: new FakeNode("html") });
  const spacing = createLineSpacingPicker(doc, storage).querySelector("select");
  spacing.value = "user:7<b>";
  spacing.dispatch("change");
  assert.equal(storage.getItem(LINE_SPACING_STORAGE_KEY), "default");
  const contrast = createContrastPicker(doc, storage, { matchMedia: () => ({ matches: false }) }).querySelector("select");
  contrast.value = "ann@example";
  contrast.dispatch("change");
  assert.equal(storage.getItem(CONTRAST_STORAGE_KEY), "auto");
});

// --- theme-preload + CSP (v5.27) -------------------------------------------------------

test("theme-preload adds no globals, one media listener, and no eval-like or markup sink", () => {
  const source = read("public/js/theme-preload.js");
  assert.doesNotMatch(source, /\beval\s*\(|new\s+Function|innerHTML|outerHTML|insertAdjacentHTML|document\.write|setTimeout\s*\(\s*["'`]/);
  const listeners = [];
  const context = {
    localStorage: memoryStorage({ "forum-contrast": "auto" }),
    document: { documentElement: new FakeNode("html") },
    matchMedia: () => ({ matches: false, addEventListener: (type, fn) => listeners.push([type, fn]) }),
  };
  const before = Object.keys(context).sort();
  vm.runInNewContext(source, context);
  assert.deepEqual(Object.keys(context).sort(), before, "no new global properties");
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0][0], "change");
});

test("index.html has no inline script and the CSP still forbids inline script and style", () => {
  const html = read("public/index.html");
  for (const tag of html.match(/<script\b[^>]*>/g) ?? []) assert.match(tag, /\bsrc="\/js\/[a-z0-9-]+\.js"/, tag);
  assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>/);
  assert.doesNotMatch(html, /\son[a-z]+=/i, "no inline event handlers");
  const http = read("api/vendor/http.mjs");
  assert.match(http, /script-src 'self' https:\/\/challenges\.cloudflare\.com; style-src 'self';/);
  assert.doesNotMatch(http, /unsafe-inline|unsafe-eval/);
});

// --- CSS: high contrast never unmasks or hides (v5.27) ----------------------------------

const cssRules = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selector: selector.trim(), body }));

test("high-contrast rules never touch spoilers, the footer or the source link, and hide nothing", () => {
  const rules = cssRules(read("public/styles.css")).filter((rule) => rule.selector.includes("high-contrast"));
  assert.ok(rules.length >= 4, "high-contrast rules found");
  for (const { selector, body } of rules) {
    assert.doesNotMatch(selector, /spoiler|site-footer|source-link/, selector);
    assert.doesNotMatch(body, /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d])/, selector);
  }
  const spoiler = cssRules(read("public/styles.css")).find((rule) => rule.selector === ".spoiler");
  assert.match(spoiler.body, /color:\s*transparent/);
});

// --- gitleaks allowlist (1f9bcd9) -------------------------------------------------------

test("gitleaks allowlist is exact anchored fixture values only, on the secret, with default rules", () => {
  const toml = read(".gitleaks.toml");
  assert.match(toml, /^useDefault = true$/m);
  assert.match(toml, /^regexTarget = "secret"$/m);
  assert.doesNotMatch(toml, /^\s*(paths|stopwords|commits)\s*=/m);
  const values = [...toml.matchAll(/^\s*'''(.*)'''\s*,?\s*$/gm)].map(([, value]) => value);
  assert.ok(values.length >= 4);
  for (const value of values) assert.match(value, /^\^[A-Za-z0-9-]{8,}\$$/, value);
});

// --- listener lifecycle across re-renders (v5.25, v5.26) --------------------------------

test("ten thread renders leave one scroll, one resize, one hashchange listener and one bar", () => {
  const counts = {};
  const win = {
    innerHeight: 500,
    location: { hash: "" },
    addEventListener: (type) => { counts[type] = (counts[type] ?? 0) + 1; },
    removeEventListener: (type) => { counts[type] -= 1; },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  };
  const doc = makeFakeDocument({ body: new FakeNode("body") });
  const content = { getBoundingClientRect: () => ({ top: 0, height: 2000 }) };
  for (let i = 0; i < 10; i += 1) {
    startReadingProgress(doc, win, content, { reducedMotion: true });
    bindReplyHashChange(win, () => null);
  }
  assert.deepEqual(counts, { scroll: 1, resize: 1, hashchange: 1 });
  assert.equal(doc.body.children.length, 1);
  stopReadingProgress();
  assert.deepEqual(counts, { scroll: 0, resize: 0, hashchange: 1 });
  assert.equal(doc.body.children.length, 0);
});
