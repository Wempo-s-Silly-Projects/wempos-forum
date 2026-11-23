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

// Still GIFs under prefers-reduced-motion, beyond post attachments: the image
// lightbox and the staff GIF queue get the still frame plus the play/pause
// toggle (chat's GIF label); the showcase gallery / staff-pick tiles are
// links, so a button cannot nest inside them — they get the still frame only
// (the post itself offers the toggle). All reuse public/js/still-gif.js. With
// no reduced-motion preference nothing changes.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const drawn = [];
const makeElement = (tag) => {
  const node = new FakeNode(tag);
  if (tag.toLowerCase() === "canvas") {
    node.getContext = (kind) => (kind === "2d" ? { drawImage: (img) => drawn.push(img) } : null);
  }
  return node;
};
const doc = makeFakeDocument({ createElement: makeElement });
globalThis.document = doc;

const { openLightbox } = await import("../public/js/lightbox.js");
const { createGifQueue } = await import("../public/js/desk/media.js");
const { createShowcaseGallery, createStaffPickTile } = await import("../public/js/traditions.js");
const { createPostCard } = await import("../public/js/render.js");
const { t } = await import("../public/js/i18n.js");

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

const setReducedMotion = (reduce) => {
  globalThis.matchMedia = (query) => ({ media: query, matches: reduce && query === "(prefers-reduced-motion: reduce)" });
};
const loadImage = (img, width = 64, height = 48) => {
  img.naturalWidth = width;
  img.naturalHeight = height;
  img.dispatch("load");
};

afterEach(() => {
  delete globalThis.matchMedia;
  drawn.length = 0;
});

// ---- lightbox --------------------------------------------------------------

const buildStrip = (mimes) => {
  const strip = new FakeNode("div");
  strip.className = "post-attachments";
  const thumbs = mimes.map((mime, index) => {
    const button = new FakeNode("button");
    button.className = "attachment-expand";
    const img = new FakeNode("img");
    img.className = "post-attachment";
    img.src = `/api/attachments/a${index}?v=1`;
    img.dataset.mime = mime;
    button.append(img);
    strip.append(button);
    return button;
  });
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

test("render.js tags each attachment image with its mime for the lightbox", () => {
  const card = createPostCard({
    id: 9, body: "x", createdAt: "2026-11-22T00:00:00Z", visibility: "public",
    author: { id: 2, username: "ann", role: null },
    attachments: [{ id: 41, status: "approved", mime: "image/gif", version: 3, awaiting: false }],
  }, doc, null);
  assert.equal(card.querySelector("button.attachment-expand").querySelector("img").dataset.mime, "image/gif");
});

test("reduced motion: the lightbox shows a GIF's still frame with the play/pause toggle", () => {
  setReducedMotion(true);
  const thumbs = buildStrip(["image/gif"]);
  const dialog = buildDialog();
  const main = dialog.querySelector("img");
  openLightbox(dialog, thumbs[0], doc);
  assert.equal(main.hidden, true, "the shared viewer image steps aside");
  const gif = dialog.querySelector("img.lightbox-gif");
  assert.ok(gif, "a GIF image is mounted for the still frame");
  assert.equal(gif.src, "/api/attachments/a0?v=1");
  const toggle = dialog.querySelector("button.still-gif-toggle");
  assert.ok(toggle);
  assert.equal(toggle.getAttribute("aria-label"), t("chat.gifAlt"));
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  loadImage(gif);
  const canvas = dialog.querySelector("canvas.lightbox-still");
  assert.ok(canvas, "the still frame is shown");
  assert.equal(gif.hidden, true);
  assert.deepEqual(drawn, [gif]);
  toggle.dispatch("click");
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(gif.hidden, false);
  assert.equal(canvas.hidden, true);
});

test("reduced motion: stepping from a GIF to a PNG tears the still frame down", () => {
  setReducedMotion(true);
  const thumbs = buildStrip(["image/gif", "image/png"]);
  const dialog = buildDialog();
  const main = dialog.querySelector("img");
  openLightbox(dialog, thumbs[0], doc);
  loadImage(dialog.querySelector("img.lightbox-gif"));
  dialog.querySelector(".lightbox-next").dispatch("click");
  assert.equal(main.hidden, false);
  assert.equal(main.src, "/api/attachments/a1?v=1");
  assert.equal(dialog.querySelector("img.lightbox-gif"), null);
  assert.equal(dialog.querySelector("canvas.lightbox-still"), null);
  assert.equal(dialog.querySelector("button.still-gif-toggle"), null);
  dialog.querySelector(".lightbox-previous").dispatch("click");
  assert.equal(dialog.querySelectorAll("button.still-gif-toggle").length, 1, "one toggle, never stacked");
  dialog.close();
  assert.equal(dialog.querySelector("button.still-gif-toggle"), null, "closing clears the GIF view");
  assert.equal(main.hidden, false);
});

test("reduced motion: a click on the still frame closes the viewer like the image does", () => {
  setReducedMotion(true);
  const thumbs = buildStrip(["image/gif"]);
  const dialog = buildDialog();
  openLightbox(dialog, thumbs[0], doc);
  loadImage(dialog.querySelector("img.lightbox-gif"));
  dialog.dispatch("click", { target: dialog.querySelector("canvas.lightbox-still") });
  assert.equal(dialog.open, false);
});

test("no reduced motion: the lightbox shows the animated GIF in the shared image, unchanged", () => {
  for (const setup of [() => setReducedMotion(false), () => delete globalThis.matchMedia]) {
    setup();
    const thumbs = buildStrip(["image/gif"]);
    const dialog = buildDialog();
    const main = dialog.querySelector("img");
    openLightbox(dialog, thumbs[0], doc);
    assert.equal(main.src, "/api/attachments/a0?v=1");
    assert.equal(main.hidden, false);
    assert.equal(dialog.querySelector("img.lightbox-gif"), null);
    assert.equal(dialog.querySelector("button.still-gif-toggle"), null);
  }
  assert.equal(drawn.length, 0);
});

// ---- staff GIF queue ---------------------------------------------------------

const QUEUE = [{ id: "g1", uploader: "ann", createdAt: "2026-11-22T00:00:00Z", previewUrl: "/api/gifs/g1" }];

test("reduced motion: the staff GIF queue shows a still frame with the play/pause toggle", () => {
  setReducedMotion(true);
  const list = createGifQueue(QUEUE, doc);
  const card = list.querySelector(".gif-review-card");
  const img = card.querySelector("img");
  const toggle = card.querySelector("button.still-gif-toggle");
  assert.ok(toggle);
  assert.equal(toggle.getAttribute("aria-label"), t("chat.gifAlt"));
  loadImage(img);
  const canvas = card.querySelector("canvas.gif-review-still");
  assert.ok(canvas);
  assert.equal(img.hidden, true);
  assert.equal(canvas.getAttribute("aria-label"), img.alt, "the still frame keeps the image's name");
  toggle.dispatch("click");
  assert.equal(img.hidden, false);
  assert.equal(canvas.hidden, true);
  const actions = [...card.querySelectorAll("button")].map((button) => button.dataset.action).filter(Boolean);
  assert.deepEqual(actions, ["gif-approve", "gif-reject"], "the decision buttons stay");
});

test("no reduced motion: the staff GIF queue keeps the animated preview", () => {
  setReducedMotion(false);
  const card = createGifQueue(QUEUE, doc).querySelector(".gif-review-card");
  loadImage(card.querySelector("img"));
  assert.equal(card.querySelector("canvas"), null);
  assert.equal(card.querySelector("button.still-gif-toggle"), null);
});

// ---- showcase gallery / staff pick ------------------------------------------

const GIF_IMAGE = { id: "a1", version: "v1", mime: "image/gif" };
const PNG_IMAGE = { id: "a2", version: "v1", mime: "image/png" };

test("reduced motion: a GIF gallery tile shows its still frame (no button nested in the link)", () => {
  setReducedMotion(true);
  const grid = createShowcaseGallery(doc, [{ id: 5, body: "my build", authorName: "ann", image: GIF_IMAGE }]);
  const tile = grid.querySelector("a.gallery-tile");
  const img = tile.querySelector("img");
  loadImage(img);
  const canvas = tile.querySelector("canvas.gallery-image");
  assert.ok(canvas);
  assert.equal(img.hidden, true);
  assert.equal(canvas.getAttribute("aria-label"), img.alt);
  assert.equal(tile.querySelector("button"), null);
});

test("reduced motion: a GIF staff pick freezes; PNG tiles are untouched", () => {
  setReducedMotion(true);
  const pick = createStaffPickTile(doc, { id: 6, excerpt: "pick", authorName: "bo", image: GIF_IMAGE });
  loadImage(pick.querySelector("img"));
  assert.ok(pick.querySelector("canvas.gallery-image"));
  const grid = createShowcaseGallery(doc, [{ id: 7, body: "png", authorName: "cy", image: PNG_IMAGE }]);
  const img = grid.querySelector("img");
  assert.equal(img.classList.contains("still-gif-loading"), false);
  loadImage(img);
  assert.equal(grid.querySelector("canvas"), null);
});

test("no reduced motion: GIF gallery tiles stay animated", () => {
  setReducedMotion(false);
  const grid = createShowcaseGallery(doc, [{ id: 5, body: "b", authorName: "ann", image: GIF_IMAGE }]);
  loadImage(grid.querySelector("img"));
  assert.equal(grid.querySelector("canvas"), null);
  assert.equal(grid.querySelector("img").hidden, false);
});

// ---- source pins -------------------------------------------------------------

test("source: every surface reuses the shared still-gif helper; no canvas code of its own", () => {
  for (const [path, from] of [
    ["public/js/lightbox.js", "./still-gif.js"],
    ["public/js/desk/media.js", "../still-gif.js"],
    ["public/js/traditions.js", "./still-gif.js"],
  ]) {
    const source = read(path);
    assert.ok(source.includes(`from "${from}"`), path);
    assert.doesNotMatch(source, /getContext|innerHTML/, path);
  }
});

test("server: gallery and staff-pick images carry their mime", () => {
  const source = read("api/traditions.mjs");
  assert.equal((source.match(/mime: String\(cover\.mime/g) || []).length, 2);
});

test("css: the lightbox still frame is sized like the viewer image", () => {
  const css = read("public/styles.css");
  assert.match(css, /\.attachment-lightbox canvas/);
  assert.match(css, /\.gif-review-card canvas/);
});
