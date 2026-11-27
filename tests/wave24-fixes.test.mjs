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

// Wave 24 F1b–d: wall bodies render per block (like maskSpoilers), the
// lightbox skips imageless thumbnails, and fold-all appears on long threads
// whose replies page in later.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

globalThis.document = { ...makeFakeDocument(), querySelector: () => new FakeNode("div") };
globalThis.window ??= { location: { assign() {}, origin: "https://wempos-forum.com", hostname: "wempos-forum.com" } };
const { maskSpoilers } = await import("../public/js/markdown.js");
const { renderWallBody } = await import("../public/js/wall.js");
const { openLightbox } = await import("../public/js/lightbox.js");
const { ensureFoldAllToggle } = await import("../public/js/reply-fold.js");

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const collect = (node, className, out = []) => {
  if (String(node.className ?? "").split(" ").includes(className)) out.push(node);
  for (const child of node.children ?? []) collect(child, className, out);
  return out;
};

// --- F1b: wall renders per block, matching maskSpoilers -----------------------

test("wall: a '||' split across a paragraph and a list renders the same spoilers maskSpoilers hides", () => {
  const body = "see ||x\n- ||y|| end";
  const node = renderWallBody(makeFakeDocument(), body);
  const spoilers = collect(node, "spoiler").map((span) => span.textContent);
  assert.deepEqual(spoilers, ["y"]);
  assert.equal(maskSpoilers(body).includes("y"), false);
  assert.equal(maskSpoilers(body).includes("x"), true);
  assert.equal(collect(node, "md-list").length, 1);
});

test("wall: the body keeps its wall-post-body class and uses the shared block renderer", () => {
  const node = renderWallBody(makeFakeDocument(), "plain **bold**");
  assert.match(node.className, /\bwall-post-body\b/);
  assert.match(read("public/js/wall.js"), /renderBodyBlocks\(/);
});

// --- F1c: lightbox skips thumbnails without an <img> --------------------------

const buildStrip = (withImage) => {
  const strip = new FakeNode("div");
  strip.className = "post-attachments";
  const thumbs = withImage.map((has, index) => {
    const thumb = new FakeNode("button");
    thumb.className = "attachment-expand";
    if (has) {
      const img = new FakeNode("img");
      img.src = `/api/attachments/a${index}?v=1`;
      thumb.append(img);
    }
    strip.append(thumb);
    return thumb;
  });
  new FakeNode("article").append(strip);
  return thumbs;
};
const buildDialog = () => {
  const dialog = new FakeNode("dialog");
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatch("close"); };
  dialog.append(new FakeNode("img"));
  return dialog;
};

test("lightbox: Next steps past a thumbnail with no image instead of sticking on the previous one", () => {
  const thumbs = buildStrip([true, false, true]);
  const dialog = buildDialog();
  openLightbox(dialog, thumbs[0], makeFakeDocument());
  dialog.querySelector(".lightbox-next").dispatch("click");
  assert.equal(dialog.querySelector("img").src, "/api/attachments/a2?v=1");
  assert.equal(dialog.querySelector(".lightbox-next").disabled, true);
});

test("lightbox: opening an imageless thumbnail never shows the previous image", () => {
  const thumbs = buildStrip([true, false]);
  const dialog = buildDialog();
  openLightbox(dialog, thumbs[0], makeFakeDocument());
  dialog.close();
  openLightbox(dialog, thumbs[1], makeFakeDocument());
  assert.equal(dialog.open, false, "no viewer opens on the stale image");
});

// --- F1d: fold-all on long threads paged in later ----------------------------

const replyCard = () => {
  const card = new FakeNode("article");
  card.className = "post-card";
  return card;
};

test("fold-all: appears once older replies bring a short first page past the threshold", () => {
  const wrapper = new FakeNode("main");
  const list = new FakeNode("div");
  list.className = "post-list replies-list";
  list.append(replyCard(), replyCard());
  wrapper.append(list);
  assert.equal(ensureFoldAllToggle(makeFakeDocument(), list), null);
  list.prepend(replyCard(), replyCard());
  const toggle = ensureFoldAllToggle(makeFakeDocument(), list);
  assert.ok(toggle);
  assert.equal(wrapper.children[0], toggle, "the toggle sits just above the reply list");
  assert.equal(ensureFoldAllToggle(makeFakeDocument(), list), toggle, "idempotent");
  assert.equal(collect(wrapper, "fold-all-replies").length, 1);
});

test("fold-all: paging adds it inside the thread toolbar, before the reply filter (trim list #14)", () => {
  const wrapper = new FakeNode("main");
  const toolbar = new FakeNode("div");
  toolbar.className = "thread-tools";
  const filter = new FakeNode("div");
  filter.className = "reply-filter";
  toolbar.append(filter);
  const list = new FakeNode("div");
  list.className = "post-list replies-list";
  list.append(replyCard(), replyCard(), replyCard());
  wrapper.append(toolbar, list);
  const toggle = ensureFoldAllToggle(makeFakeDocument(), list);
  assert.deepEqual([...toolbar.children], [toggle, filter]);
  assert.equal(wrapper.children[1], list, "nothing loose lands above the list");
});

test("fold-all: the first render counts unloaded pages and paging re-checks the gate", () => {
  const post = read("public/js/routes/post.js");
  assert.match(post, /createFoldAllToggle\(document, replyList, knownReplyTotal\(post\)\)/);
  assert.match(post, /repliesNextBefore \? 1 : 0/);
  assert.match(post, /ensureFoldAllToggle\(document, replyList\)/);
});
