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

// Wave 5.25 F1: link to a specific reply. Client-only: every top-level reply
// on the thread page carries id="reply-<id>" and a "Copy link to this reply"
// button; a #reply-<id> hash scrolls to and briefly highlights that reply
// when it is already on the page, and does nothing otherwise (no fetch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  REPLY_HASH_PATTERN, REPLY_HIGHLIGHT_CLASS, REPLY_HIGHLIGHT_FADE_CLASS, REPLY_HIGHLIGHT_MS,
  anchorReplyCard, bindReplyHashChange, highlightReplyFromHash, parseReplyHash, replyAnchorId, replyPermalink,
} from "../public/js/reply-anchor.js";
import { createPostCard } from "../public/js/render.js";
import { makeFakeDocument, findByClass, countByClass } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ORIGIN = "https://wempos-forum.com";
const fakeDocument = makeFakeDocument({ documentElement: { dataset: {} } });

const reply = (id) => ({
  id, body: "reply " + id, createdAt: "2026-11-21T10:00:00Z", author: { id: 2, username: "ann" },
  likeCount: 0, dislikeCount: 0, viewCount: 0,
});

// A reply list with real cards, each scroll recorded.
function threadPage(ids, threadId = 7) {
  const list = fakeDocument.createElement("div");
  list.className = "post-list replies-list";
  const scrolled = [];
  for (const id of ids) {
    const card = createPostCard(reply(id), fakeDocument, null);
    card.scrollIntoView = (options) => scrolled.push([card.id, options]);
    anchorReplyCard(fakeDocument, card, threadId, { origin: ORIGIN });
    list.append(card);
  }
  return { list, scrolled };
}

test("replyAnchorId and replyPermalink accept plain numeric ids only", () => {
  assert.equal(replyAnchorId(12), "reply-12");
  assert.equal(replyAnchorId("12"), "reply-12");
  assert.equal(replyAnchorId("1 2"), null);
  assert.equal(replyAnchorId("-3"), null);
  assert.equal(replyAnchorId(undefined), null);
  assert.equal(replyPermalink(ORIGIN, 7, 12), ORIGIN + "/posts/7#reply-12");
  assert.equal(replyPermalink(ORIGIN, "7/../x", 12), null);
  assert.equal(replyPermalink(ORIGIN, 7, "12\"]"), null);
});

test("parseReplyHash only accepts ^#reply-<digits>$", () => {
  assert.equal(parseReplyHash("#reply-42"), "42");
  for (const bad of ["", "#", "reply-42", "#reply-", "#reply-4a", "#reply-42 ", "#reply-1,#x",
    "#reply-1\"],body[x", "#Reply-1", "#reply-1#reply-2", null, undefined, "#reply-" + "9".repeat(16)]) {
    assert.equal(parseReplyHash(bad), null, String(bad));
  }
  assert.equal(REPLY_HASH_PATTERN.source.startsWith("^#reply-"), true);
  assert.equal(REPLY_HASH_PATTERN.source.endsWith("$"), true);
});

test("every anchored reply card gets id reply-<id> and one reply copy-link button", () => {
  const { list } = threadPage([3, 4]);
  const cards = list.querySelectorAll("article.post-card");
  assert.equal(cards.length, 2);
  assert.equal(cards[0].id, "reply-3");
  assert.equal(cards[1].id, "reply-4");
  for (const card of cards) {
    assert.equal(countByClass(card, "copy-link"), 1, "the generic copy link is swapped, never doubled");
    assert.equal(findByClass(card, "copy-link").getAttribute("aria-label"), "render.copyReplyLink");
  }
});

test("the reply copy-link copies /posts/<thread>#reply-<id> and shows the Link copied status", async () => {
  const written = [];
  const card = createPostCard(reply(12), fakeDocument, null);
  anchorReplyCard(fakeDocument, card, 7, {
    origin: ORIGIN,
    clipboard: { writeText: async (text) => { written.push(text); } },
    schedule: () => {},
  });
  await findByClass(card, "copy-link").fire("click");
  assert.deepEqual(written, [ORIGIN + "/posts/7#reply-12"]);
  assert.equal(findByClass(card, "copy-link-status").textContent, "render.linkCopied");
});

test("a matching hash scrolls the reply into view and adds the temporary highlight", () => {
  const { list, scrolled } = threadPage([3, 4, 5]);
  const timers = [];
  const card = highlightReplyFromHash(list, "#reply-4", {
    reducedMotion: false, schedule: (fn, ms) => timers.push([fn, ms]),
  });
  assert.equal(card?.id, "reply-4");
  assert.deepEqual(scrolled.map(([id]) => id), ["reply-4"]);
  assert.equal(scrolled[0][1].behavior, "smooth");
  assert.ok(card.classList.contains(REPLY_HIGHLIGHT_CLASS));
  assert.ok(card.classList.contains(REPLY_HIGHLIGHT_FADE_CLASS));
  assert.equal(timers[0][1], REPLY_HIGHLIGHT_MS);
  timers[0][0]();
  assert.ok(!card.classList.contains(REPLY_HIGHLIGHT_CLASS), "the highlight is temporary");
  assert.ok(!card.classList.contains(REPLY_HIGHLIGHT_FADE_CLASS));
});

test("reduced motion: the highlight stays static (no fade class) and the scroll is instant", () => {
  const { list, scrolled } = threadPage([3]);
  const card = highlightReplyFromHash(list, "#reply-3", { reducedMotion: true, schedule: () => {} });
  assert.ok(card.classList.contains(REPLY_HIGHLIGHT_CLASS));
  assert.ok(!card.classList.contains(REPLY_HIGHLIGHT_FADE_CLASS));
  assert.equal(scrolled[0][1].behavior, "auto");
});

test("an unknown, absent, hidden or malformed hash is a no-op", () => {
  const { list, scrolled } = threadPage([3, 4]);
  list.querySelectorAll("article.post-card")[1].setAttribute("hidden", "");
  for (const hash of ["", "#reply-99", "#reply-4", "#reply-3,article", "#top", "#reply-3\"]"]) {
    assert.equal(highlightReplyFromHash(list, hash, { reducedMotion: false, schedule: () => {} }), null, hash);
  }
  assert.equal(highlightReplyFromHash(null, "#reply-3"), null);
  assert.deepEqual(scrolled, []);
  assert.equal(countByClass(list, REPLY_HIGHLIGHT_CLASS), 0);
});

test("hashchange re-runs the highlight against the current page, bound once", () => {
  const { list, scrolled } = threadPage([3, 4]);
  const listeners = [];
  const win = { location: { hash: "" }, addEventListener: (type, fn) => listeners.push([type, fn]) };
  bindReplyHashChange(win, () => list, { reducedMotion: true, schedule: () => {} });
  bindReplyHashChange(win, () => list, { reducedMotion: true, schedule: () => {} });
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0][0], "hashchange");
  win.location.hash = "#reply-3";
  listeners[0][1]();
  assert.deepEqual(scrolled.map(([id]) => id), ["reply-3"]);
});

test("the module never builds a selector from the hash and never fetches or stores", () => {
  const source = read("public/js/reply-anchor.js");
  assert.doesNotMatch(source, /querySelector(All)?\([^)]*hash/i);
  assert.doesNotMatch(source, /getElementById/);
  assert.doesNotMatch(source, /innerHTML|localStorage|sessionStorage|api\(|fetch\(/);
});

test("the thread page anchors its replies and checks the hash on load and on hashchange", () => {
  const post = read("public/js/routes/post.js");
  assert.match(post, /from "\.\.\/reply-anchor\.js"/);
  assert.match(post, /anchorReplyCard\(document, card, post\.id\)/);
  assert.match(post, /highlightReplyFromHash\(main, location\.hash\)/);
  assert.match(post, /bindReplyHashChange\(window, \(\) => main\)/);
  // Older replies are anchored too, so a link to one works once loaded.
  assert.match(post, /anchorReplyCard\(document, card, postId\)/);
});

test("the highlight CSS animates only when motion is allowed", () => {
  const css = read("public/styles.css");
  assert.match(css, /\.post-card\.reply-target\s*\{/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.post-card\.reply-target-fade/);
});
