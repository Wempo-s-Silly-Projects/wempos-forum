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

// Wave 5.26 F1: save thread as text. Client-only: the file is built only
// from what the thread page already shows (nothing inside [hidden], folded
// reply bodies left out, unrevealed spoilers stay masked), handed to the
// browser as a Blob download, and the object URL is revoked. No request is
// made and nothing is stored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  SLUG_FALLBACK, SLUG_MAX, THREAD_TEXT_SEPARATOR, THREAD_TEXT_TYPE,
  buildThreadText, createSaveThreadButton, formatLocalDate, saveThreadAsText, threadFileName,
} from "../public/js/thread-text.js";
import { createPostCard } from "../public/js/render.js";
import { SPOILER_MASK, revealSpoiler } from "../public/js/markdown.js";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ORIGIN = "https://forum.example";
const CREATED = "2026-11-21T10:05:00Z";

// A fake document with a body; every <a> records its clicks.
function fakeDoc() {
  const anchors = [];
  const doc = makeFakeDocument({ documentElement: { dataset: {} }, body: new FakeNode("body") });
  const create = doc.createElement;
  doc.createElement = (tag) => {
    const node = create(tag);
    if (tag === "a") {
      node.clicks = 0;
      node.click = () => { node.clicks += 1; node.parentAtClick = node.parentNode; };
      anchors.push(node);
    }
    return node;
  };
  // Post cards build their own <a> links; only download links count here.
  return { doc, anchors: { get length() { return downloads().length; }, at: (i) => downloads()[i] } };
  function downloads() { return anchors.filter((node) => node.download); }
}

const post = (id, username, body, extra = {}) => ({
  id, body, createdAt: CREATED, author: { id, username },
  likeCount: 0, dislikeCount: 0, viewCount: 0, ...extra,
});

// A thread page: root card plus reply cards inside a replies list.
function threadPage(doc, replies) {
  const root = doc.createElement("main");
  const rootCard = createPostCard(post(7, "starter", "My first thread title\nSecond line of the root."), doc, null);
  root.append(rootCard);
  const list = doc.createElement("div");
  list.className = "post-list replies-list";
  const cards = replies.map((reply) => createPostCard(reply, doc, null));
  list.append(...cards);
  root.append(list);
  return { root, rootCard, cards };
}

test("buildThreadText: header, title, each visible post as 'Author — date' + body, dash separators", () => {
  const { doc } = fakeDoc();
  const { root } = threadPage(doc, [post(8, "ann", "First reply body"), post(9, "bob", "Second reply body")]);
  const text = buildThreadText(root, { threadId: 7, origin: ORIGIN, siteName: "Test Forum" });
  const lines = text.split("\n");
  assert.equal(lines[0], "Test Forum — " + ORIGIN + "/posts/7");
  assert.ok(lines.includes("My first thread title"), "title is the root's first line");
  const date = formatLocalDate(CREATED);
  for (const [author, body] of [["starter", "Second line of the root."], ["ann", "First reply body"], ["bob", "Second reply body"]]) {
    assert.ok(lines.includes(author + " — " + date), author);
    assert.ok(text.includes(body), body);
  }
  assert.ok(THREAD_TEXT_SEPARATOR.length >= 10 && /^-+$/.test(THREAD_TEXT_SEPARATOR));
  assert.ok(lines.filter((line) => line === THREAD_TEXT_SEPARATOR).length >= 3);
  assert.ok(text.indexOf("ann") < text.indexOf("bob"), "page order kept");
});

test("buildThreadText: excludes anything inside [hidden] (property or attribute) and folded reply bodies", () => {
  const { doc } = fakeDoc();
  const { root, cards } = threadPage(doc, [
    post(8, "ann", "Visible reply"),
    post(9, "hiddenprop", "Filtered out by property"),
    post(10, "hiddenattr", "Filtered out by attribute"),
    post(11, "folder", "Folded body text"),
  ]);
  cards[1].hidden = true;
  const wrap = doc.createElement("div");
  wrap.setAttribute("hidden", "");
  cards[2].parentNode.insertBefore(wrap, cards[2]);
  wrap.append(cards[2]);
  cards[3].setAttribute("data-folded", "");
  const text = buildThreadText(root, { threadId: 7, origin: ORIGIN, siteName: "F" });
  assert.match(text, /Visible reply/);
  assert.doesNotMatch(text, /hiddenprop|Filtered out by property/);
  assert.doesNotMatch(text, /hiddenattr|Filtered out by attribute/);
  assert.doesNotMatch(text, /Folded body text/);
  assert.match(text, /folder — /, "a folded reply keeps only its visible header line");
});

test("buildThreadText: an unrevealed spoiler stays masked, a revealed one shows its text", () => {
  const { doc } = fakeDoc();
  const { root, cards } = threadPage(doc, [post(8, "ann", "Ending: ||the butler||"), post(9, "bob", "Twist: ||it was a dream||")]);
  revealSpoiler(cards[1].querySelector("span.spoiler"));
  const text = buildThreadText(root, { threadId: 7, origin: ORIGIN, siteName: "F" });
  assert.doesNotMatch(text, /the butler/);
  assert.ok(text.includes("Ending: " + SPOILER_MASK));
  assert.match(text, /Twist: it was a dream/);
});

test("buildThreadText: an invalid thread id gives no link in the header", () => {
  const { doc } = fakeDoc();
  const { root } = threadPage(doc, []);
  const text = buildThreadText(root, { threadId: "7/../x", origin: ORIGIN, siteName: "F" });
  assert.doesNotMatch(text.split("\n")[0], /\/posts\//);
});

test("threadFileName: lowercase ASCII letters, digits and hyphens only, max 60, fallback 'thread'", () => {
  assert.equal(SLUG_MAX, 60);
  assert.equal(SLUG_FALLBACK, "thread");
  assert.equal(threadFileName("Hello, World!", 7), "hello-world-7.txt");
  assert.equal(threadFileName("../../etc/passwd", 7), "etc-passwd-7.txt");
  assert.equal(threadFileName("a\\b:c*d?e\"f<g>h|i", 7), "a-b-c-d-e-f-g-h-i-7.txt");
  assert.equal(threadFileName("Café crème", 7), "cafe-creme-7.txt");
  assert.equal(threadFileName("日本語のスレッド", 7), "thread-7.txt");
  assert.equal(threadFileName("", 7), "thread-7.txt");
  assert.equal(threadFileName(null, 7), "thread-7.txt");
  assert.equal(threadFileName("   ---   ", 7), "thread-7.txt");
  const long = threadFileName("word ".repeat(80), 12);
  const slug = long.replace(/-12\.txt$/, "");
  assert.ok(slug.length <= SLUG_MAX, String(slug.length));
  assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(threadFileName("Hi", "7/../x"), "hi.txt", "a non-numeric id is dropped");
  for (const name of [threadFileName("x/y", 1), threadFileName("..", 2), long]) {
    assert.match(name, /^[a-z0-9-]+\.txt$/);
  }
});

test("saveThreadAsText: text/plain Blob, <a download> clicked, removed, object URL revoked, no fetch", async () => {
  const { doc, anchors } = fakeDoc();
  const { root } = threadPage(doc, [post(8, "ann", "Reply body")]);
  const created = [];
  const revoked = [];
  const urls = {
    createObjectURL: (blob) => { created.push(blob); return "blob:fake-1"; },
    revokeObjectURL: (href) => revoked.push(href),
  };
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = () => { fetched += 1; throw new Error("no fetch allowed"); };
  try {
    saveThreadAsText({ doc, root, threadId: 7, origin: ORIGIN, siteName: "F", urls, schedule: (fn) => fn() });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(fetched, 0);
  assert.equal(created.length, 1);
  assert.equal(THREAD_TEXT_TYPE, "text/plain;charset=utf-8");
  assert.equal(created[0].type, THREAD_TEXT_TYPE);
  assert.match(await created[0].text(), /Reply body/);
  assert.equal(anchors.length, 1);
  const link = anchors.at(0);
  assert.equal(link.download, "my-first-thread-title-7.txt");
  assert.equal(link.href, "blob:fake-1");
  assert.equal(link.clicks, 1);
  assert.equal(link.parentAtClick, doc.body);
  assert.equal(link.parentNode, null, "link removed after the click");
  assert.deepEqual(revoked, ["blob:fake-1"]);
});

test("saveThreadAsText revokes the object URL even when the click throws", () => {
  const { doc } = fakeDoc();
  const { root } = threadPage(doc, []);
  const create = doc.createElement;
  doc.createElement = (tag) => {
    const node = create(tag);
    if (tag === "a") node.click = () => { throw new Error("blocked"); };
    return node;
  };
  const revoked = [];
  const urls = { createObjectURL: () => "blob:fake-2", revokeObjectURL: (href) => revoked.push(href) };
  assert.throws(() => saveThreadAsText({ doc, root, threadId: 7, origin: ORIGIN, siteName: "F", urls, schedule: (fn) => fn() }));
  assert.deepEqual(revoked, ["blob:fake-2"]);
});

test("createSaveThreadButton: translated label + aria-label, click saves", () => {
  const { doc, anchors } = fakeDoc();
  const { root } = threadPage(doc, []);
  const urls = { createObjectURL: () => "blob:fake-3", revokeObjectURL: () => {} };
  const button = createSaveThreadButton(doc, { getRoot: () => root, threadId: 7, origin: ORIGIN, urls, schedule: (fn) => fn() });
  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.type, "button");
  assert.equal(button.textContent, "post.saveAsText");
  assert.equal(button.getAttribute("aria-label"), "post.saveAsTextLabel");
  assert.match(button.className, /save-thread-text/);
  button.dispatch("click");
  assert.equal(anchors.length, 1);
  assert.equal(anchors.at(0).clicks, 1);
});

test("formatLocalDate: absolute local YYYY-MM-DD HH:MM; bad input gives an empty string", () => {
  const date = new Date(CREATED);
  const pad = (n) => String(n).padStart(2, "0");
  const expected = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  assert.equal(formatLocalDate(CREATED), expected);
  assert.equal(formatLocalDate("not a date"), "");
  assert.equal(formatLocalDate(undefined), "");
});

test("post cards carry the creation time on <time data-created-at>", () => {
  const { doc } = fakeDoc();
  const card = createPostCard(post(5, "ann", "x", { lastActivityAt: "2026-11-22T00:00:00Z" }), doc, null);
  assert.equal(card.querySelector("time.post-time").dataset.createdAt, CREATED);
});

test("thread-text.js makes no request, stores nothing and never writes markup", () => {
  const source = read("public/js/thread-text.js");
  assert.doesNotMatch(source, /\bfetch\s*\(|\bapi\(|XMLHttpRequest|localStorage|sessionStorage|innerHTML|outerHTML|insertAdjacentHTML/);
  assert.match(source, /revokeObjectURL/);
});

test("the thread page puts Save as text in the root card's actions", () => {
  const source = read("public/js/routes/post.js");
  assert.match(source, /import \{[^}]*createSaveThreadButton[^}]*\} from "\.\.\/thread-text\.js"/);
  assert.match(source, /createSaveThreadButton\(document,/);
  assert.match(read("public/index.html"), /<link rel="modulepreload" href="\/js\/thread-text\.js">/);
});

test("Save as text strings exist in en and every locale", () => {
  const files = readdirSync(new URL("../public/locales/", import.meta.url)).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 74);
  for (const file of files) {
    const table = JSON.parse(read("public/locales/" + file));
    for (const key of ["post.saveAsText", "post.saveAsTextLabel"]) {
      assert.equal(typeof table[key], "string", file + " " + key);
      assert.ok(table[key].trim(), file + " " + key);
    }
  }
});
