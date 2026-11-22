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

// Wave 5.73.1 (engagement audit MEDIUM): chat GIFs honour
// prefers-reduced-motion. Under `reduce` a message GIF shows its first frame
// on a <canvas> inside a toggle button (aria-pressed swaps canvas <-> the
// animated <img>); picker thumbnails show the still frame with no toggle.
// Without `reduce` the markup is unchanged.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const drawn = [];
const makeElement = (tag) => {
  const node = new FakeNode(tag);
  if (tag.toLowerCase() === "canvas") {
    node.width = 300;
    node.height = 150;
    node.getContext = (kind) => (kind === "2d" ? { drawImage: (img, x, y) => drawn.push({ img, x, y }) } : null);
  }
  return node;
};
globalThis.document = makeFakeDocument({ createElement: makeElement });

const { messageBodyNode, buildGifPicker } = await import("../public/js/chat-widget-gifs.js");
const { ui } = await import("../public/js/chat-widget-state.js");
const { t } = await import("../public/js/i18n.js");

const GIF_ID = "0123abcd-0123-4567-89ab-0123456789ab";
const GIF_BODY = `[gif:${GIF_ID}]`;
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

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

afterEach(() => {
  delete globalThis.matchMedia;
  drawn.length = 0;
  ui.gifLibrary = null;
});

test("reduced motion: a message GIF sits in an unpressed toggle button labelled with the existing alt key", () => {
  setReducedMotion(true);
  const node = messageBodyNode("chat-message-body", GIF_BODY);
  assert.ok(node.classList.contains("chat-gif-body"));
  const button = node.querySelector("button");
  assert.ok(button, "the GIF is wrapped in a button");
  assert.equal(button.type, "button");
  assert.ok(button.classList.contains("chat-gif-toggle"));
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.equal(button.getAttribute("aria-label"), t("chat.gifAlt"));
  const img = button.querySelector("img");
  assert.ok(img, "the animated image loads inside the button");
  assert.equal(img.src, "/api/gifs/" + GIF_ID);
  assert.ok(img.classList.contains("chat-gif-loading"), "hidden until its first frame is captured");
});

test("reduced motion: once loaded, the first frame is drawn to a same-size canvas that replaces the image", () => {
  setReducedMotion(true);
  const node = messageBodyNode("chat-message-body", GIF_BODY);
  const button = node.querySelector("button");
  const img = button.querySelector("img");
  loadImage(img, 120, 80);
  const canvas = button.querySelector("canvas");
  assert.ok(canvas, "a still canvas is shown");
  assert.equal(button.querySelector("img"), null, "the animated image is not shown");
  assert.equal(canvas.width, 120);
  assert.equal(canvas.height, 80);
  assert.ok(canvas.classList.contains("chat-gif"));
  assert.deepEqual(drawn, [{ img, x: 0, y: 0 }]);
  assert.equal(img.classList.contains("chat-gif-loading"), false);
});

test("reduced motion: clicking toggles aria-pressed and swaps canvas and animated image", () => {
  setReducedMotion(true);
  const node = messageBodyNode("chat-message-body", GIF_BODY);
  const button = node.querySelector("button");
  const img = button.querySelector("img");
  loadImage(img);
  const canvas = button.querySelector("canvas");
  button.dispatch("click");
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(button.firstElementChild, img);
  assert.equal(button.childElementCount, 1);
  button.dispatch("click");
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.equal(button.firstElementChild, canvas);
  assert.equal(button.childElementCount, 1);
});

test("reduced motion: a click before the frame is captured does nothing", () => {
  setReducedMotion(true);
  const node = messageBodyNode("chat-message-body", GIF_BODY);
  const button = node.querySelector("button");
  button.dispatch("click");
  assert.equal(button.getAttribute("aria-pressed"), "false");
});

test("reduced motion: a bad id still falls back to the plain text body", () => {
  setReducedMotion(true);
  const node = messageBodyNode("chat-message-body", GIF_BODY);
  node.querySelector("img").dispatch("error");
  assert.equal(node.classList.contains("chat-gif-body"), false);
  assert.equal(node.childElementCount, 0);
  assert.equal(node.textContent, GIF_BODY);
});

test("no reduced motion (or no matchMedia): the message GIF is the bare animated image, unchanged", () => {
  for (const setup of [() => setReducedMotion(false), () => delete globalThis.matchMedia]) {
    setup();
    const node = messageBodyNode("chat-message-body", GIF_BODY);
    assert.equal(node.querySelector("button"), null);
    const img = node.firstElementChild;
    assert.equal(img.tagName, "IMG");
    assert.equal(img.className, "chat-gif");
    assert.equal(img.alt, t("chat.gifAlt"));
    loadImage(img);
    assert.equal(node.firstElementChild, img, "the image stays after load");
    assert.equal(node.querySelector("canvas"), null);
  }
  assert.equal(drawn.length, 0);
});

const openPicker = async () => {
  ui.gifLibrary = [{ id: GIF_ID, url: "/api/gifs/" + GIF_ID }];
  const { toggle, grid } = buildGifPicker(() => {});
  await toggle.fire("click");
  return grid;
};

test("reduced motion: picker thumbnails show the still frame with no toggle", async () => {
  setReducedMotion(true);
  const grid = await openPicker();
  const pick = grid.querySelector("button.chat-widget-gif-pick");
  assert.ok(pick);
  const img = pick.querySelector("img");
  loadImage(img, 64, 64);
  const canvas = pick.querySelector("canvas");
  assert.ok(canvas, "the thumbnail is a still canvas");
  assert.equal(pick.querySelector("img"), null);
  assert.equal(canvas.width, 64);
  assert.equal(pick.hasAttribute("aria-pressed"), false, "no play toggle in the picker");
  assert.equal(pick.getAttribute("aria-label"), t("chat.sendThisGif"));
});

test("no reduced motion: picker thumbnails stay animated images", async () => {
  setReducedMotion(false);
  const grid = await openPicker();
  const pick = grid.querySelector("button.chat-widget-gif-pick");
  const img = pick.querySelector("img");
  loadImage(img);
  assert.equal(pick.querySelector("img"), img);
  assert.equal(pick.querySelector("canvas"), null);
});

test("source: no innerHTML, no new i18n keys, reduced-motion query read via matchMedia", () => {
  const source = read("public/js/chat-widget-gifs.js");
  assert.doesNotMatch(source, /innerHTML/);
  assert.match(source, /import \{ prefersReducedMotion \} from "\.\/focus-utils\.js"/);
  const keys = [...new Set([...source.matchAll(/\bt\("([^"]+)"\)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(keys, ["chat.gifAlt", "chat.gifLibrary", "chat.gifsEmpty", "chat.gifsFailed",
    "chat.gifsLoading", "chat.sendGif", "chat.sendThisGif"]);
});

test("css: the GIF toggle has no chrome, a visible focus ring, and a fixed box across states", () => {
  const css = read("public/styles.css");
  const rule = css.match(/\.chat-gif-toggle\s*\{([^}]*)\}/);
  assert.ok(rule, ".chat-gif-toggle rule exists");
  assert.match(rule[1], /padding:\s*0/);
  assert.match(rule[1], /border:\s*0/);
  assert.match(rule[1], /background:\s*none/);
  assert.match(css, /\.chat-gif-toggle:focus-visible\s*\{[^}]*outline:[^}]*var\(--focus\)/);
  assert.doesNotMatch(css, /\.chat-gif-toggle\[aria-pressed[^{]*\{[^}]*(width|height|padding|border-width|font-size)/,
    "no size change on state change");
  assert.match(css, /\.chat-gif-loading\s*\{[^}]*visibility:\s*hidden/);
  assert.match(css, /\.chat-widget-gif-pick canvas/);
});
