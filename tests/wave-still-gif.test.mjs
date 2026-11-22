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

// Reduced-motion GIFs beyond chat: post image attachments (library GIFs ride
// posts BY REFERENCE as gifIds and come back as image/gif attachment rows),
// the composer's selected-gallery chips and the gallery picker show a still
// first frame under prefers-reduced-motion. One shared implementation
// (public/js/still-gif.js) also serves chat. Only same-origin images are drawn
// to a canvas; cross-origin images stay the plain animated <img>.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const drawn = [];
const makeElement = (tag) => {
  const node = new FakeNode(tag);
  if (tag.toLowerCase() === "canvas") {
    node.getContext = (kind) => (kind === "2d" ? { drawImage: (img, x, y) => drawn.push({ img, x, y }) } : null);
  }
  return node;
};
const doc = makeFakeDocument({ createElement: makeElement });
globalThis.document = doc;

const { createPostCard } = await import("../public/js/render.js");
const { renderGifThumbs } = await import("../public/js/gifs.js");
const { messageBodyNode } = await import("../public/js/chat-widget-gifs.js");
const { t } = await import("../public/js/i18n.js");
const still = await import("../public/js/still-gif.js");

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const GIF_ID = "0123abcd-0123-4567-89ab-0123456789ab";

const setReducedMotion = (reduce) => {
  globalThis.matchMedia = (query) => ({
    media: query,
    matches: reduce && query === "(prefers-reduced-motion: reduce)",
  });
};
const loadImage = (img, width = 120, height = 80) => {
  img.naturalWidth = width;
  img.naturalHeight = height;
  img.dispatch("load");
};
const postWith = (attachments) => createPostCard({
  id: 9, body: "look", createdAt: "2026-11-22T00:00:00Z", visibility: "public",
  author: { id: 2, username: "ann", role: null }, attachments,
}, doc, null);
const GIF_ROW = { id: 41, status: "approved", mime: "image/gif", version: 3, awaiting: false };
const PNG_ROW = { id: 42, status: "approved", mime: "image/png", version: 1, awaiting: false };

afterEach(() => {
  delete globalThis.matchMedia;
  drawn.length = 0;
});

test("reduced motion: a post's GIF attachment freezes to a canvas inside the expand button, image kept for the lightbox", () => {
  setReducedMotion(true);
  const card = postWith([GIF_ROW]);
  const expand = card.querySelector("button.attachment-expand");
  const img = expand.querySelector("img");
  assert.ok(img.classList.contains("still-gif-loading"), "hidden until its first frame is captured");
  loadImage(img, 120, 80);
  const canvas = expand.querySelector("canvas");
  assert.ok(canvas, "a still canvas is shown in the expand button");
  assert.equal(canvas.width, 120);
  assert.equal(canvas.height, 80);
  assert.ok(canvas.classList.contains("post-attachment"));
  assert.equal(img.hidden, true, "the animated image is hidden");
  assert.equal(expand.querySelector("img"), img, "the lightbox still finds the image source");
  assert.deepEqual(drawn, [{ img, x: 0, y: 0 }]);
});

test("reduced motion: the post GIF has a play/pause toggle labelled with the chat GIF key", () => {
  setReducedMotion(true);
  const card = postWith([GIF_ROW]);
  const toggle = card.querySelector("button.still-gif-toggle");
  assert.ok(toggle, "a toggle sits beside the expand button");
  assert.equal(toggle.type, "button");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(toggle.getAttribute("aria-label"), t("chat.gifAlt"));
  toggle.dispatch("click");
  assert.equal(toggle.getAttribute("aria-pressed"), "false", "a click before the frame is captured does nothing");
  const img = card.querySelector("img");
  loadImage(img);
  const canvas = card.querySelector("canvas");
  toggle.dispatch("click");
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(img.hidden, false);
  assert.equal(canvas.hidden, true);
  toggle.dispatch("click");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(img.hidden, true);
  assert.equal(canvas.hidden, false);
});

test("reduced motion: non-GIF attachments are untouched", () => {
  setReducedMotion(true);
  const card = postWith([PNG_ROW]);
  const img = card.querySelector("img");
  assert.equal(img.classList.contains("still-gif-loading"), false);
  loadImage(img);
  assert.equal(card.querySelector("canvas"), null);
  assert.equal(card.querySelector("button.still-gif-toggle"), null);
});

test("no reduced motion: a post GIF attachment stays the animated image, unchanged", () => {
  for (const setup of [() => setReducedMotion(false), () => delete globalThis.matchMedia]) {
    setup();
    const card = postWith([GIF_ROW]);
    const img = card.querySelector("img");
    assert.equal(img.className, "post-attachment");
    loadImage(img);
    assert.equal(card.querySelector("canvas"), null);
    assert.equal(card.querySelector("button.still-gif-toggle"), null);
    assert.equal(img.hidden, false);
  }
  assert.equal(drawn.length, 0);
});

test("reduced motion: selected-gallery chips show the still frame, named by the image's alt", () => {
  setReducedMotion(true);
  const wrap = renderGifThumbs(doc, { composerGifs: [GIF_ID] });
  const chip = wrap.querySelector(".gif-chip");
  const img = chip.querySelector("img");
  loadImage(img, 40, 40);
  const canvas = chip.querySelector("canvas");
  assert.ok(canvas);
  assert.equal(img.hidden, true);
  assert.equal(canvas.getAttribute("role"), "img");
  assert.equal(canvas.getAttribute("aria-label"), t("gifs.selectedImage"));
  assert.ok(chip.querySelector("button.gif-remove"), "the remove button stays");
});

test("no reduced motion: selected-gallery chips stay animated images", () => {
  setReducedMotion(false);
  const wrap = renderGifThumbs(doc, { composerGifs: [GIF_ID] });
  const img = wrap.querySelector("img");
  loadImage(img);
  assert.equal(wrap.querySelector("canvas"), null);
  assert.equal(img.hidden, false);
});

test("cross-origin images are never drawn to a canvas: they stay the plain <img>", () => {
  assert.equal(still.isSameOriginImage("/api/gifs/" + GIF_ID), true);
  assert.equal(still.isSameOriginImage("https://forum.test/api/gifs/x", "https://forum.test"), true);
  assert.equal(still.isSameOriginImage("https://elsewhere.example/a.gif", "https://forum.test"), false);
  assert.equal(still.isSameOriginImage("//elsewhere.example/a.gif"), false);
  assert.equal(still.isSameOriginImage("data:image/gif;base64,R0lGOD"), false);
  const img = makeElement("img");
  img.src = "https://elsewhere.example/a.gif";
  const host = makeElement("span");
  host.append(img);
  assert.equal(still.freezeInPlace(doc, img), false);
  assert.equal(still.stillGifToggle(doc, img, { label: "x", buttonClass: "still-gif-toggle", host }), null);
  loadImage(img);
  assert.equal(host.querySelector("canvas"), null);
  assert.equal(img.classList.contains("still-gif-loading"), false);
  assert.equal(drawn.length, 0);
});

test("chat keeps its behaviour through the shared module", () => {
  setReducedMotion(true);
  const node = messageBodyNode("chat-message-body", `[gif:${GIF_ID}]`);
  const button = node.querySelector("button.chat-gif-toggle");
  assert.ok(button);
  loadImage(button.querySelector("img"));
  assert.ok(button.querySelector("canvas.chat-gif"));
  const source = read("public/js/chat-widget-gifs.js");
  assert.match(source, /from "\.\/still-gif\.js"/);
  assert.doesNotMatch(source, /getContext/, "chat no longer carries its own canvas code");
});

test("source: the gallery picker and composer chips use the shared still frame; no innerHTML", () => {
  const composer = read("public/js/routes/composer.js");
  assert.match(composer, /from "\.\.\/still-gif\.js"/);
  assert.match(composer, /prefersReducedMotion\(\)\) freezeInPlace\(document, img/);
  for (const path of ["public/js/still-gif.js", "public/js/gifs.js", "public/js/render.js"]) {
    assert.doesNotMatch(read(path), /innerHTML/, path);
  }
});

test("css: the post GIF toggle has a visible focus ring and the loading state is hidden", () => {
  const css = read("public/styles.css");
  assert.match(css, /\.still-gif-toggle:focus-visible\s*\{[^}]*outline:[^}]*var\(--focus\)/);
  assert.match(css, /\.still-gif-loading\s*\{[^}]*visibility:\s*hidden/);
  assert.match(css, /\.gif-grid-item canvas/);
  assert.match(css, /\.gif-chip canvas/);
});
