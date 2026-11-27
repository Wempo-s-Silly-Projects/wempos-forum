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

// v5.46.0: the client halves — F2 the thread outline ("Jump to" list, client
// only, built from the replies already on the page) and F1's Mute/Unmute
// toggle on the thread root card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeNode, countByClass, findByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";
import { GROWTH_FACTOR, LINEAR_GROWTH_CEILING, growthRatio } from "./helpers/timing.mjs";
import {
  OUTLINE_MIN_REPLIES, OUTLINE_STORAGE_KEY, clearAllThreadOutline, createThreadOutline,
  outlineEntries, outlineKey, readOutlineOpen, writeOutlineOpen,
} from "../public/js/thread-outline.js";
import { createPostCard } from "../public/js/render.js";
import { t } from "../public/js/i18n.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const NOW = Date.parse("2026-11-22T12:00:00Z");
const reply = (id, username = "user" + id, minutesAgo = 60 - id) => ({
  id, body: "reply " + id, author: { id, username },
  createdAt: new Date(NOW - minutesAgo * 60000).toISOString(),
});
const replies = (n) => Array.from({ length: n }, (_, index) => reply(index + 1));

function memoryStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    map,
  };
}

// A reply list with one card per rendered reply, the shape post.js builds.
function replyListFor(doc, list, { skip = [] } = {}) {
  const container = doc.createElement("div");
  container.className = "post-list replies-list";
  for (const item of list) {
    if (skip.includes(item.id)) continue;
    const card = doc.createElement("article");
    card.className = "post-card";
    card.dataset.postId = String(item.id);
    card.setAttribute("data-post-id", String(item.id));
    container.append(card);
  }
  return container;
}

const entriesOf = (outline) => outline.querySelectorAll("button.thread-outline-entry");

// ---- threshold + entries --------------------------------------------------------

test("no outline below OUTLINE_MIN_REPLIES (8); one at 8", () => {
  assert.equal(OUTLINE_MIN_REPLIES, 8);
  const doc = makeFakeDocument();
  const seven = replies(7);
  assert.equal(createThreadOutline(doc, seven, replyListFor(doc, seven), { now: NOW }), null);
  const eight = replies(8);
  const outline = createThreadOutline(doc, eight, replyListFor(doc, eight), { now: NOW });
  assert.ok(outline);
  assert.equal(entriesOf(outline).length, 8);
  assert.equal(createThreadOutline(doc, null, replyListFor(doc, []), { now: NOW }), null);
});

test("entries follow page order with author + relative time; only rendered replies are listed", () => {
  const doc = makeFakeDocument();
  const list = replies(10);
  const listEl = replyListFor(doc, list, { skip: [3, 7] });
  const entries = outlineEntries(list, listEl);
  assert.deepEqual(entries.map((entry) => entry.id), [1, 2, 4, 5, 6, 8, 9, 10]);
  const outline = createThreadOutline(doc, list, listEl, { now: NOW });
  const buttons = [...entriesOf(outline)];
  assert.equal(buttons.length, 8, "a reply the page does not render is never listed");
  assert.equal(findByClass(buttons[0], "thread-outline-author").textContent, "user1");
  const time = findByClass(buttons[0], "thread-outline-time");
  assert.equal(time.tagName.toLowerCase(), "time");
  assert.equal(time.getAttribute("datetime"), list[0].createdAt);
  assert.ok(time.textContent.length > 0);
  assert.notEqual(time.textContent, list[0].createdAt, "a relative stamp, not the raw ISO string");
  // Fewer than 8 RENDERED replies: no outline even when the payload had more.
  const sparse = replyListFor(doc, list, { skip: [1, 2, 3] });
  assert.equal(createThreadOutline(doc, list, sparse, { now: NOW }), null);
});

test("a missing author reads as a member; nothing throws on odd rows", () => {
  const doc = makeFakeDocument();
  const list = [...replies(7), { id: 8, createdAt: "not a date" }];
  const outline = createThreadOutline(doc, list, replyListFor(doc, list), { now: NOW });
  const last = [...entriesOf(outline)].at(-1);
  assert.equal(findByClass(last, "thread-outline-author").textContent, t("glance.aMember"));
});

// ---- collapse + a11y ------------------------------------------------------------

test("collapsed by default: toggle is a button with aria-expanded/aria-controls; the list is hidden", () => {
  const doc = makeFakeDocument();
  const list = replies(9);
  const outline = createThreadOutline(doc, list, replyListFor(doc, list), { now: NOW });
  assert.equal(outline.tagName.toLowerCase(), "nav");
  assert.equal(outline.getAttribute("aria-label"), t("outline.label"));
  const toggle = outline.querySelector("button.thread-outline-toggle");
  const listEl = outline.querySelector("ol.thread-outline-list");
  assert.equal(toggle.type, "button");
  assert.equal(toggle.textContent, t("outline.toggle"));
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(toggle.getAttribute("aria-controls"), listEl.id);
  assert.ok(listEl.hasAttribute("hidden"));
  toggle.dispatch("click", { preventDefault() {} });
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(listEl.hasAttribute("hidden"), false);
  toggle.dispatch("click", { preventDefault() {} });
  assert.ok(listEl.hasAttribute("hidden"));
});

test("an entry scrolls to and focuses its reply and marks itself aria-current", () => {
  const doc = makeFakeDocument();
  const list = replies(9);
  const listEl = replyListFor(doc, list);
  const outline = createThreadOutline(doc, list, listEl, { now: NOW });
  const buttons = [...entriesOf(outline)];
  const target = listEl.querySelector('[data-post-id="5"]');
  const scrolled = [];
  target.scrollIntoView = (options) => scrolled.push(options);
  buttons[4].dispatch("click", { preventDefault() {} });
  assert.equal(scrolled.length, 1);
  assert.equal(target.ownerFocused, true);
  assert.equal(target.getAttribute("tabindex"), "-1");
  assert.equal(buttons[4].getAttribute("aria-current"), "true");
  buttons[6].dispatch("click", { preventDefault() {} });
  assert.equal(buttons[4].hasAttribute("aria-current"), false, "only one current entry");
  assert.equal(buttons[6].getAttribute("aria-current"), "true");
  // A reply removed from the page after the outline was built is a no-op.
  listEl.querySelector('[data-post-id="9"]').remove();
  buttons[8].dispatch("click", { preventDefault() {} });
  assert.equal(buttons[8].hasAttribute("aria-current"), false);
  for (const button of buttons) assert.equal(button.type, "button", "entries are keyboard reachable buttons");
});

// ---- per-viewer storage -----------------------------------------------------------

test("open state is per account (:u<id>), read and written only once the id is known", () => {
  assert.equal(outlineKey(null), null);
  assert.equal(outlineKey(7), OUTLINE_STORAGE_KEY + ":u7");
  const storage = memoryStorage();
  assert.equal(readOutlineOpen(storage, 7), false);
  writeOutlineOpen(storage, null, true);
  assert.equal(storage.map.size, 0, "a guest writes nothing");
  writeOutlineOpen(storage, 7, true);
  assert.equal(readOutlineOpen(storage, 7), true);
  assert.equal(readOutlineOpen(storage, 8), false, "another account on the browser is unaffected");
  const doc = makeFakeDocument();
  const list = replies(9);
  const outline = createThreadOutline(doc, list, replyListFor(doc, list), { now: NOW, storage, accountId: 7 });
  assert.equal(outline.querySelector("button.thread-outline-toggle").getAttribute("aria-expanded"), "true");
  outline.querySelector("button.thread-outline-toggle").dispatch("click", { preventDefault() {} });
  assert.equal(readOutlineOpen(storage, 7), false, "collapsing is remembered");
  const guest = createThreadOutline(doc, list, replyListFor(doc, list), { now: NOW, storage });
  guest.querySelector("button.thread-outline-toggle").dispatch("click", { preventDefault() {} });
  assert.deepEqual([...storage.map.keys()], [], "collapsed = no key; guest toggles stay page-view only");
});

test("blocked or broken storage reads as collapsed and never throws", () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); }, get length() { throw new Error("blocked"); } };
  assert.equal(readOutlineOpen(broken, 3), false);
  writeOutlineOpen(broken, 3, true);
  clearAllThreadOutline(broken);
  assert.equal(readOutlineOpen(null, 3), false);
});

test("sign-out: clearAllThreadOutline wipes every account's key and is registered in wipeAccountLocalData", () => {
  const storage = memoryStorage();
  writeOutlineOpen(storage, 1, true);
  writeOutlineOpen(storage, 2, true);
  storage.setItem("forum-theme", "dark");
  clearAllThreadOutline(storage);
  assert.deepEqual([...storage.map.keys()], ["forum-theme"]);
  const nav = read("public/js/routes/account-nav.js");
  assert.match(nav, /import \{ clearAllThreadOutline \} from "\.\.\/thread-outline\.js";/);
  assert.match(nav.match(/function wipeAccountLocalData\(\)\s*\{([\s\S]*?)\n\}/)[1], /clearAllThreadOutline\(\);/);
});

// ---- wiring + safety ----------------------------------------------------------------

test("post.js mounts the outline from the rendered reply list; the module is DOM-safe and network-free", () => {
  const post = read("public/js/routes/post.js");
  assert.match(post, /from "\.\.\/thread-outline\.js"/);
  assert.match(post, /createThreadOutline\(document, post\.replies, replyList,/);
  const module = read("public/js/thread-outline.js");
  assert.doesNotMatch(module, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\bapi\(|fetch\(/);
  assert.match(read("public/index.html"), /<link rel="modulepreload" href="\/js\/thread-outline\.js/);
});

test("building the outline stays linear (4x replies must not ~16x the cost)", () => {
  const doc = makeFakeDocument();
  const sized = (n) => ({ list: replies(n), listEl: replyListFor(doc, replies(n)) });
  const build = ({ list, listEl }) => createThreadOutline(doc, list, listEl, { now: NOW });
  const { ratio } = growthRatio(build, sized(50), sized(50 * GROWTH_FACTOR));
  assert.ok(ratio < LINEAR_GROWTH_CEILING, "outline growth " + ratio.toFixed(1) + "x");
});

// ---- F1 client: the Mute/Unmute toggle ------------------------------------------------

const rootPost = (extra) => ({
  id: 42, body: "root", createdAt: "2026-11-21T10:05:00Z", author: { id: 1, username: "ann" },
  likeCount: 0, dislikeCount: 0, viewCount: 0, subscribed: false, ...extra,
});

test("the root card shows Mute thread / Unmute thread for members when the payload carries viewerMuted", () => {
  const doc = makeFakeDocument({ documentElement: { dataset: {} }, body: new FakeNode("body") });
  const me = { id: 2, username: "bob", role: "member" };
  const off = findByClass(createPostCard(rootPost({ viewerMuted: false }), doc, me), "thread-mute-toggle");
  assert.ok(off);
  assert.equal(off.type, "button");
  assert.equal(off.dataset.action, "toggle-thread-mute");
  assert.equal(off.dataset.postId, "42");
  assert.equal(off.dataset.muted, "0");
  assert.equal(off.getAttribute("aria-pressed"), "false");
  assert.equal(off.textContent, t("render.muteThread"));
  const on = findByClass(createPostCard(rootPost({ viewerMuted: true }), doc, me), "thread-mute-toggle");
  assert.equal(on.dataset.muted, "1");
  assert.equal(on.getAttribute("aria-pressed"), "true");
  assert.equal(on.textContent, t("render.unmuteThread"));
  assert.equal(countByClass(createPostCard(rootPost({}), doc, me), "thread-mute-toggle"), 0, "feed cards (no field) get no toggle");
  assert.equal(countByClass(createPostCard(rootPost({ viewerMuted: false }), doc, null), "thread-mute-toggle"), 0, "guests get none");
  assert.equal(countByClass(createPostCard(rootPost({ viewerMuted: false, parent: 1 }), doc, me), "thread-mute-toggle"), 0, "replies get none");
});

test("the toggle action PUTs or DELETEs /api/posts/:id/mute through api() and re-renders", () => {
  const feed = read("public/js/routes/feed.js");
  const handler = feed.match(/"toggle-thread-mute": async \(button\) => \{([\s\S]*?)\n {2}\},/)?.[1] ?? "";
  assert.match(handler, /api\("\/api\/posts\/" \+ button\.dataset\.postId \+ "\/mute", \{\s*method: muted \? "DELETE" : "PUT",/);
  assert.match(handler, /state\.renderRoute\(state\.activeRoute\)/);
  assert.match(handler, /t\("feed\.threadUnmuted"\) : t\("feed\.threadMuted"\)/);
});

// ---- trim list #1: the jump buttons ride the outline's quick row ------------------

test("quick jumps: a short thread gets a Jump to with just them; both parts share the toggle", () => {
  const doc = makeFakeDocument();
  const few = replies(3);
  const jump = (name) => Object.assign(doc.createElement("button"), { className: name });
  assert.equal(createThreadOutline(doc, few, replyListFor(doc, few), { now: NOW, quickJumps: [null] }), null,
    "nulls (jumps that do not apply) count as none");
  const short = createThreadOutline(doc, few, replyListFor(doc, few), { now: NOW, quickJumps: [jump("a"), null] });
  const quick = short.querySelector("div.thread-outline-quick");
  assert.equal(quick.children.length, 1);
  assert.equal(short.querySelector("ol.thread-outline-list"), null, "no reply list below eight replies");
  const toggle = short.querySelector("button.thread-outline-toggle");
  assert.equal(toggle.getAttribute("aria-controls"), quick.id);
  assert.ok(quick.hasAttribute("hidden"));
  const many = replies(9);
  const long = createThreadOutline(doc, many, replyListFor(doc, many), { now: NOW, quickJumps: [jump("a"), jump("b")] });
  const parts = [long.querySelector("div.thread-outline-quick"), long.querySelector("ol.thread-outline-list")];
  assert.equal(long.children[1], parts[0], "quick jumps sit above the list");
  const longToggle = long.querySelector("button.thread-outline-toggle");
  assert.equal(longToggle.getAttribute("aria-controls"), parts.map((part) => part.id).join(" "));
  longToggle.dispatch("click", { preventDefault() {} });
  assert.ok(parts.every((part) => !part.hasAttribute("hidden")));
  longToggle.dispatch("click", { preventDefault() {} });
  assert.ok(parts.every((part) => part.hasAttribute("hidden")));
});

test("post.js: the four jumps feed the outline; Jump to, Fold all and the filter share one toolbar", () => {
  const post = read("public/js/routes/post.js");
  assert.match(post, /const quickJumps = \[\n\s*createLatestReplyJump\(/);
  assert.match(post, /accountId: state\.currentUser\?\.id, quickJumps,/);
  assert.match(post, /const tools = \[outline, foldAll, replyFilter\]\.filter\(Boolean\);/);
  assert.match(post, /element\("div", "thread-tools"\)/);
  assert.doesNotMatch(post, /main\.append\((latestJump|myJump|authorJump|firstJump)\)/, "no loose jump buttons");
  const css = read("public/styles.css");
  assert.match(css, /\.thread-tools \{/);
  assert.match(css, /\.thread-outline-quick\[hidden\]/);
});
