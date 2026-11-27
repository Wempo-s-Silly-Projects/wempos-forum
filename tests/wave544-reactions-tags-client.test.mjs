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

// v5.44.0 client: the DM bubble's reaction pair, the thread page's tag chips
// and tag picker, the /tag/:slug page and the desk's tag manager. DOM-pure
// builders over fake-dom; tag labels and thread previews land through
// textContent only, hrefs are built with the URL API from validated slugs,
// and nothing touches device storage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { makeFakeDocument, findByClass, countByClass } from "./helpers/fake-dom.mjs";
import { bestOf } from "./helpers/timing.mjs";
import { routeForPath } from "../public/js/router.js";
import { buildDmReactions, dmReactionPath } from "../public/js/dm-reactions.js";
import {
  THREAD_TAG_MAX as CLIENT_THREAD_MAX,
  TAG_TOTAL_MAX as CLIENT_TOTAL_MAX,
  createTagChips,
  createTagEditor,
  createTagIndex,
  createTagManager,
  createTagPage,
  postTagsPath,
  tagListingPath,
  tagPagePath,
} from "../public/js/tags.js";
import { TAG_TOTAL_MAX, THREAD_TAG_MAX } from "../api/tags.mjs";
import { t, tn } from "../public/js/i18n.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const doc = makeFakeDocument();
const TAGS = [
  { id: 1, slug: "news", label: "<b>News</b>" },
  { id: 2, slug: "help-me", label: "Help" },
];

test("caps mirror the server; paths come from validated ids and slugs only", () => {
  assert.equal(CLIENT_THREAD_MAX, THREAD_TAG_MAX);
  assert.equal(CLIENT_TOTAL_MAX, TAG_TOTAL_MAX);
  assert.equal(tagPagePath("news"), "/tag/news");
  assert.equal(tagListingPath("news"), "/api/tags/news/posts");
  assert.equal(tagListingPath("news", 42), "/api/tags/news/posts?before=42");
  assert.equal(postTagsPath(7), "/api/posts/7/tags");
  assert.equal(dmReactionPath(9), "/api/dm/messages/9/reaction");
  for (const junk of ["../x", "a", "UP", "a/b", "x".repeat(25), "//evil.example", ""]) {
    assert.throws(() => tagPagePath(junk), RangeError, junk);
    assert.throws(() => tagListingPath(junk), RangeError, junk);
  }
  for (const junk of ["1/../x", "abc", -1, 0, 1.5]) {
    assert.throws(() => postTagsPath(junk), RangeError, String(junk));
    assert.throws(() => dmReactionPath(junk), RangeError, String(junk));
  }
});

test("router: /tag/<slug> routes to the tag page; malformed slugs are 404", () => {
  assert.deepEqual(routeForPath("/tag/news", ""), { name: "tag", slug: "news" });
  assert.deepEqual(routeForPath("/tag/help-me", ""), { name: "tag", slug: "help-me" });
  for (const path of ["/tag/", "/tag/A", "/tag/a", "/tag/x_y", "/tag/news/more", "/tag/" + "x".repeat(25)]) {
    assert.equal(routeForPath(path, "").name, "not-found", path);
  }
});

test("tag index: /tags routes to the index; every tag is a chip, none is the empty state", () => {
  assert.deepEqual(routeForPath("/tags", ""), { name: "tags" });
  assert.equal(routeForPath("/tags/", "").name, "not-found");
  const page = createTagIndex(doc, TAGS);
  assert.equal(page.className, "tag-index");
  assert.deepEqual([...page.querySelectorAll("a")].map((link) => link.href), ["/tag/news", "/tag/help-me"]);
  const empty = createTagIndex(doc, []);
  assert.equal(findByClass(empty, "empty-state").textContent, t("tags.none"));
  assert.equal(createTagIndex(doc, undefined).querySelectorAll("a").length, 0);
  // Wiring: the pages module renders it from GET /api/tags; Browse links it.
  const pages = read("public/js/routes/pages.js");
  assert.match(pages, /async function renderTagsRoute\(context, version\) \{\n\s*const data = await api\("\/api\/tags"\);/);
  assert.match(read("public/js/route-modules.js"), /tags: "pages",/);
  assert.match(read("public/js/app.js"), /tags: \(\) => renderTagsRoute\(context, version\),/);
  assert.match(read("public/js/nav-items.js"), /id: "tags", href: "\/tags", icon: "tag", labelKey: "nav\.tags"/);
});

test("tag index strings reuse each locale's own Tags label", () => {
  const dir = new URL("../public/locales/", import.meta.url);
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".json"))) {
    const messages = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
    for (const key of ["nav.tags", "app.pageTags"]) assert.equal(messages[key], messages["admin.section.tags"], name + " " + key);
  }
});

test("tag chips: labels as text, hrefs to /tag/<slug>, nothing when the thread has none", () => {
  assert.equal(createTagChips(doc, []), null);
  assert.equal(createTagChips(doc, undefined), null);
  const chips = createTagChips(doc, TAGS);
  assert.equal(chips.getAttribute("aria-label"), t("tags.chipsLabel"));
  const links = chips.querySelectorAll("a");
  assert.equal(links.length, 2);
  assert.equal(links[0].textContent, "<b>News</b>");
  assert.equal(links[0].childElementCount, 0, "markup stays text");
  assert.equal(links[0].href, "/tag/news");
  assert.ok(links[0].hasAttribute("data-app-link"));
  assert.equal(links[1].href, "/tag/help-me");
  // A bad slug from the server never becomes a link.
  const filtered = createTagChips(doc, [{ id: 3, slug: "javascript:alert(1)", label: "x" }, TAGS[1]]);
  assert.equal(filtered.querySelectorAll("a").length, 1);
});

test("tag editor: one checkbox per tag, current ones checked, a save button, capped hint", () => {
  assert.equal(createTagEditor(doc, 5, [], []), null);
  const form = createTagEditor(doc, 5, TAGS, [2]);
  assert.equal(form.dataset.form, "thread-tags");
  assert.equal(form.dataset.postId, "5");
  const boxes = [...form.querySelectorAll("input")];
  assert.deepEqual(boxes.map((box) => box.value), ["1", "2"]);
  assert.ok(boxes.every((box) => box.type === "checkbox" && box.name === "tagId"));
  assert.deepEqual(boxes.map((box) => box.checked), [false, true]);
  const labels = [...form.querySelectorAll("label")];
  assert.equal(labels[0].getAttribute("for"), boxes[0].id);
  assert.equal(findByClass(form, "tag-editor-legend").textContent, t("tags.editLabel", { count: THREAD_TAG_MAX }));
  const button = form.querySelector("button");
  assert.equal(button.type, "submit");
  assert.equal(button.textContent, t("common.save"));
});

test("tag page: the threads as links with masked previews, an empty state, a load-older button", () => {
  const empty = createTagPage(doc, { tag: TAGS[0], threads: [], nextBefore: null });
  assert.equal(findByClass(empty, "empty-state").textContent, t("tags.empty"));
  const threads = [
    { id: 12, excerpt: "first ||spoiler|| <i>x</i>", board: "general", authorName: "alice", replyCount: 2 },
    { id: 9, excerpt: "second", board: "general", authorName: "bob", replyCount: 0 },
  ];
  const page = createTagPage(doc, { tag: TAGS[0], threads, nextBefore: 9 });
  assert.equal(countByClass(page, "tag-thread"), 2);
  const link = findByClass(page, "tag-thread-link");
  assert.equal(link.href, "/posts/12");
  assert.doesNotMatch(link.textContent, /spoiler/);
  assert.equal(link.childElementCount, 0);
  assert.match(findByClass(page, "tag-thread-meta").textContent, new RegExp(tn("counts.replies", 2)));
  const more = page.querySelector("button");
  assert.equal(more.dataset.action, "load-more-tag");
  assert.equal(more.dataset.before, "9");
  assert.equal(more.dataset.slug, "news");
  assert.equal(more.textContent, t("feed.loadOlderPosts"));
  assert.equal(createTagPage(doc, { tag: TAGS[0], threads, nextBefore: null }).querySelector("button"), null);
});

test("desk tag manager: a create form with the slug pattern, a delete per tag, the empty state", () => {
  const manager = createTagManager(doc, TAGS);
  const form = manager.querySelector("form");
  assert.equal(form.dataset.form, "tag-create");
  const inputs = [...form.querySelectorAll("input")];
  assert.deepEqual(inputs.map((input) => input.name), ["slug", "label"]);
  assert.equal(inputs[0].getAttribute("pattern"), "[a-z0-9\\-]{2,24}");
  assert.equal(String(inputs[1].maxLength), "24");
  const deletes = [...manager.querySelectorAll("button")].filter((button) => button.dataset.action === "tag-delete");
  assert.equal(deletes.length, 2);
  assert.equal(deletes[0].dataset.tagId, "1");
  assert.equal(findByClass(manager, "tag-manager-label").textContent, "<b>News</b>");
  const none = createTagManager(doc, []);
  assert.equal(findByClass(none, "empty-state").textContent, t("tags.none"));
});

test("DM reaction pair: like/dislike with counts, aria-pressed on the viewer's own", () => {
  const calls = [];
  const pair = buildDmReactions(doc, { id: 9, reactions: { like: 2, dislike: 0, mine: "like" } }, (id, value) => calls.push([id, value]));
  assert.equal(pair.getAttribute("aria-label"), t("dm.reactionsLabel"));
  const [like, dislike] = [...pair.querySelectorAll("button")];
  assert.equal(like.getAttribute("aria-pressed"), "true");
  assert.equal(dislike.getAttribute("aria-pressed"), "false");
  assert.equal(like.getAttribute("aria-label"), t("render.like"));
  assert.equal(dislike.getAttribute("aria-label"), t("render.dislike"));
  assert.equal(findByClass(like, "dm-reaction-count").textContent, "2");
  assert.equal(findByClass(dislike, "dm-reaction-count"), null, "zero counts stay quiet");
  like.dispatch("click", { preventDefault() {} });
  dislike.dispatch("click", { preventDefault() {} });
  // Pressing your own reaction removes it (null); the other one sets it.
  assert.deepEqual(calls, [[9, null], [9, "dislike"]]);
  const bare = buildDmReactions(doc, { id: 3 }, () => {});
  assert.equal(bare.querySelectorAll("button").length, 2);
});

test("tag page render stays linear at a full page", () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, excerpt: "row " + i, board: "general", authorName: "a", replyCount: i }));
  const small = bestOf(() => createTagPage(doc, { tag: TAGS[0], threads: rows(5), nextBefore: null }));
  const large = bestOf(() => createTagPage(doc, { tag: TAGS[0], threads: rows(20), nextBefore: 3 }));
  assert.ok(large < Math.max(small, 0.05) * 16, `5 rows ${small}ms, 20 rows ${large}ms`);
});

test("wiring: thread page chips + editor, tag route + 404, desk section, DM bubbles, preloads", () => {
  const post = read("public/js/routes/post.js");
  assert.match(post, /createTagChips\(document, /);
  assert.match(post, /createTagEditor\(document, post\.id, /);
  assert.ok(post.includes("\"thread-tags\""));
  const app = read("public/js/app.js");
  assert.match(app, /tag: \(\) => renderTagRoute\(route, context, version\)/);
  assert.match(app, /route\.name !== "post" && route\.name !== "tag"/);
  const admin = read("public/js/routes/admin.js");
  for (const key of ["slug: \"tags\"", "\"tag-create\"", "\"tag-delete\"", "createTagManager("]) assert.ok(admin.includes(key), key);
  const composer = read("public/js/chat-widget-composer.js");
  assert.match(composer, /buildDmReactions\(document, message, /);
  const index = read("public/index.html");
  assert.match(index, /<link rel="modulepreload" href="\/js\/tags\.js">/);
});

test("new client modules: no HTML sinks, no device storage", () => {
  for (const file of ["public/js/tags.js", "public/js/dm-reactions.js"]) {
    const source = read(file);
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser/, file);
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/, file);
  }
});
