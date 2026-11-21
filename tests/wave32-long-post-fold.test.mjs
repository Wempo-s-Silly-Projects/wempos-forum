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

// Wave 2026-11-21-32 F2 (unique): long posts fold in the feed. A feed card
// (the feed decorates it with latestReplies) whose body runs past
// LONG_POST_CHARS characters or LONG_POST_LINES lines shows a clipped body
// with a "Show more" / "Show less" toggle. The thread page always shows the
// whole post. Page-view only: no storage, no request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countByClass, findByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";
import { closeEditForm, createPostCard, openEditForm } from "../public/js/render.js";
import { LONG_POST_CHARS, LONG_POST_LINES, isLongPost } from "../public/js/long-post.js";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const NEW_KEYS = ["longPost.showMore", "longPost.showLess"];
const LONG_BODY = "word ".repeat(LONG_POST_CHARS).trim();

const card = (body, extra = { latestReplies: [] }) => createPostCard({
  id: 9, body, createdAt: "2026-11-21T00:00:00Z", visibility: "public",
  author: { id: 3, username: "ann", role: null }, ...extra,
}, makeFakeDocument(), { id: 3, role: null });

test("isLongPost trips on characters or lines, not on short posts", () => {
  assert.equal(isLongPost("short"), false);
  assert.equal(isLongPost(""), false);
  assert.equal(isLongPost(null), false);
  assert.equal(isLongPost("x".repeat(LONG_POST_CHARS)), false);
  assert.equal(isLongPost("x".repeat(LONG_POST_CHARS + 1)), true);
  assert.equal(isLongPost(Array(LONG_POST_LINES).fill("a").join("\n")), false);
  assert.equal(isLongPost(Array(LONG_POST_LINES + 1).fill("a").join("\n")), true);
});

test("a long feed card folds; the toggle expands and collapses it", () => {
  const article = card(LONG_BODY);
  const fold = findByClass(article, "post-body-fold");
  assert.ok(fold, "fold wrapper present");
  assert.equal(fold.dataset.folded, "true");
  const content = findByClass(fold, "post-body-fold-content");
  assert.ok(countByClass(content, "post-body") >= 1, "body rendered inside the fold");
  const toggle = findByClass(fold, "post-fold-toggle");
  assert.equal(toggle.type, "button");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(toggle.getAttribute("aria-controls"), content.id);
  assert.ok(content.id);
  const showMore = toggle.textContent;
  toggle.dispatch("click", { preventDefault() {} });
  assert.equal(fold.dataset.folded, "false");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.notEqual(toggle.textContent, showMore);
  toggle.dispatch("click", { preventDefault() {} });
  assert.equal(fold.dataset.folded, "true");
  assert.equal(toggle.textContent, showMore);
});

test("tabbing into a folded body unfolds it", () => {
  const fold = findByClass(card(LONG_BODY), "post-body-fold");
  findByClass(fold, "post-body-fold-content").dispatch("focusin", {});
  assert.equal(fold.dataset.folded, "false");
  assert.equal(findByClass(fold, "post-fold-toggle").getAttribute("aria-expanded"), "true");
});

test("short feed cards and thread-page cards never fold", () => {
  assert.equal(countByClass(card("short and sweet"), "post-body-fold"), 0);
  assert.equal(countByClass(card(LONG_BODY, {}), "post-body-fold"), 0);
  assert.ok(countByClass(card(LONG_BODY, {}), "post-body") >= 1);
});

test("editing a folded feed card hides the fold, cancel restores it", () => {
  const document = makeFakeDocument();
  const article = createPostCard({
    id: 9, body: LONG_BODY, createdAt: "2026-11-21T00:00:00Z", visibility: "public",
    author: { id: 3, username: "ann", role: null }, latestReplies: [],
  }, document, { id: 3, role: null });
  const fold = findByClass(article, "post-body-fold");
  assert.equal(openEditForm(article, document), true);
  assert.equal(fold.hidden, true);
  assert.equal(closeEditForm(article), true);
  assert.equal(fold.hidden, false);
});

test("long-post.js is page-view only and builds with createElement", () => {
  const source = read("public/js/long-post.js");
  assert.doesNotMatch(source, /localStorage|sessionStorage|api\(|innerHTML/);
  assert.match(source, /createElement/);
  assert.match(read("public/styles.css"), /\.post-body-fold\[data-folded="true"\]/);
  assert.match(read("public/index.html"), /<link rel="modulepreload" href="\/js\/long-post\.js">/);
});

test("new strings exist in en and are translated in all 20 locales", () => {
  const en = JSON.parse(read("public/locales/en.json"));
  for (const key of NEW_KEYS) assert.equal(typeof en[key], "string", key);
  const locales = ["ar", "de", "es", "fr", "he", "hi", "id", "it", "ja", "ko", "nl", "pl", "pt", "ru", "th", "tr", "uk", "vi", "zh-Hans", "zh-Hant"];
  for (const locale of locales) {
    const bundle = JSON.parse(read("public/locales/" + locale + ".json"));
    for (const key of NEW_KEYS) {
      assert.equal(typeof bundle[key], "string", locale + " " + key);
      assert.notEqual(bundle[key], en[key], locale + " " + key + " untranslated");
    }
  }
});
