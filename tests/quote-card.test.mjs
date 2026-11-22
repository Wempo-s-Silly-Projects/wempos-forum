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

// Batch O — "Make it a Quote" card (public/js/quote-card.js, lazy) and its
// menu hook (public/js/quote-card-action.js). Pins the vendored canvas-txt
// and bidi-js files byte for byte with their REUSE licensing, the constants
// mirror, the wrap/shrink maths, spoiler masking in the card text, RTL
// detection driving the canvas direction, same-origin-only avatar drawing,
// the action's absence on content the viewer cannot share, and the dialog's
// buttons (download, copy, theme, close + focus return). Client-only: the
// card never makes a server call of its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as constants from "../constants.mjs";
import {
  QUOTE_CARD_FONT_MAX, QUOTE_CARD_FONT_MIN, QUOTE_CARD_HEIGHT, QUOTE_CARD_LAYOUT, QUOTE_CARD_MAX_CHARS,
  QUOTE_CARD_THEMES, QUOTE_CARD_WIDTH, fitQuoteText, isDrawableAvatar, openQuoteCardDialog, quoteCardFileName,
  quoteCardText, renderQuoteCard, textDirection,
} from "../public/js/quote-card.js";
import { canQuoteCard, createQuoteCardButton } from "../public/js/quote-card-action.js";
import { SPOILER_MASK } from "../public/js/markdown.js";
import { createPostCard } from "../public/js/render.js";
import { t } from "../public/js/i18n.js";
import { FakeNode, countByClass, findByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const sha256 = (path) => createHash("sha256").update(readFileSync(new URL(path, ROOT))).digest("hex");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const ORIGIN = "https://wempos-forum.com";
const BOX = { width: 600, height: 360 };

// A 2D context stand-in: every glyph is half the font size wide, the font
// box is 0.8/0.2 of the size, and every paint call is recorded with the
// context state it ran under.
function fakeCanvas() {
  const calls = { fillText: [], drawImage: [], fillRect: [], toBlob: [] };
  const ctx = {
    font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic", direction: "inherit",
    fillStyle: "#000000", strokeStyle: "#000000", lineWidth: 1, letterSpacing: "0px", globalAlpha: 1,
    measureText(text) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10);
      return {
        width: Array.from(String(text)).length * size * 0.5,
        actualBoundingBoxAscent: size * 0.8, actualBoundingBoxDescent: size * 0.2,
        fontBoundingBoxAscent: size * 0.8, fontBoundingBoxDescent: size * 0.2,
      };
    },
    fillText(text, x, y) {
      calls.fillText.push({ text, x, y, direction: this.direction, font: this.font, fill: this.fillStyle });
    },
    fillRect(x, y, w, h) { calls.fillRect.push({ x, y, w, h, fill: this.fillStyle }); },
    drawImage(...args) { calls.drawImage.push(args); },
    createLinearGradient() { return { addColorStop() {} }; },
    save() {}, restore() {}, beginPath() {}, closePath() {}, rect() {}, clip() {}, arc() {}, fill() {},
    moveTo() {}, lineTo() {},
  };
  const canvas = {
    width: 0, height: 0,
    getContext: () => ctx,
    toDataURL: (type) => `data:${type ?? "image/png"};base64,AAAA`,
    toBlob(callback, type) { calls.toBlob.push(type); callback({ type, size: 4 }); },
  };
  return { canvas, ctx, calls };
}

// ---------------------------------------------------------------- vendor

test("vendored canvas-txt 5.0.2 and bidi-js 1.1.0 are byte-for-byte the published dist files", () => {
  assert.equal(sha256("public/js/vendor/canvas-txt.js"),
    "49f11a97777e305f9a5ef517c8868acaf5d68271dcf5e65b38de4b378b0627e0");
  assert.equal(sha256("public/js/vendor/bidi.js"),
    "59599182ffb089498d0eb4272c1e535a2f6932a4b2589e356f9302fe095bff0b");
});

test("REUSE.toml annotates each new vendor file as MIT under its upstream holder (last match wins)", () => {
  const reuse = read("REUSE.toml");
  const blocks = reuse.split("[[annotations]]");
  const prismIndex = blocks.findIndex((part) => part.includes('"public/js/vendor/**"'));
  for (const [path, holder] of [["public/js/vendor/canvas-txt.js", "Geon George"], ["public/js/vendor/bidi.js", "Jason Johnston"]]) {
    const index = blocks.findIndex((part) => part.includes(`"${path}"`));
    assert.ok(index > prismIndex, `${path} has its own block after the Prism catch-all`);
    assert.match(blocks[index], /SPDX-License-Identifier = "MIT"/);
    assert.match(blocks[index], new RegExp(`SPDX-FileCopyrightText = "[^"]*${holder}`));
    assert.match(blocks[index], /precedence = "override"/);
  }
  assert.match(read("LICENSES/MIT.txt"), /^MIT License/);
});

test("the vendor files keep no project header (verbatim) and no runtime CDN is referenced", () => {
  for (const path of ["public/js/vendor/canvas-txt.js", "public/js/vendor/bidi.js"]) {
    assert.doesNotMatch(read(path), /This file is part of Wempo's Forum/);
  }
  for (const path of ["public/js/quote-card.js", "public/js/quote-card-action.js"]) {
    const code = read(path).split("\n").slice(19).join("\n");
    assert.doesNotMatch(code, /https?:\/\//, `${path} references no remote origin`);
  }
});

// ---------------------------------------------------------------- constants

test("quote card caps live in root constants.mjs and the client mirrors them", () => {
  assert.equal(constants.QUOTE_CARD_WIDTH, 1200);
  assert.equal(constants.QUOTE_CARD_HEIGHT, 630);
  assert.equal(constants.QUOTE_CARD_MAX_CHARS, 500);
  assert.equal(constants.QUOTE_CARD_FONT_MAX, 64);
  assert.equal(constants.QUOTE_CARD_FONT_MIN, 24);
  assert.equal(QUOTE_CARD_WIDTH, constants.QUOTE_CARD_WIDTH);
  assert.equal(QUOTE_CARD_HEIGHT, constants.QUOTE_CARD_HEIGHT);
  assert.equal(QUOTE_CARD_MAX_CHARS, constants.QUOTE_CARD_MAX_CHARS);
  assert.equal(QUOTE_CARD_FONT_MAX, constants.QUOTE_CARD_FONT_MAX);
  assert.equal(QUOTE_CARD_FONT_MIN, constants.QUOTE_CARD_FONT_MIN);
});

// ---------------------------------------------------------------- wrap + shrink

test("fit: a short quote keeps the largest size on one line", () => {
  const { ctx } = fakeCanvas();
  const fit = fitQuoteText(ctx, "Hello there", { ...BOX, direction: "ltr" });
  assert.equal(fit.fontSize, QUOTE_CARD_FONT_MAX);
  assert.equal(fit.layout.lines.length, 1);
  assert.equal(fit.clipped, false);
});

test("fit: longer quotes shrink monotonically and every layout fits the box", () => {
  const { ctx } = fakeCanvas();
  let previous = Infinity;
  for (const words of [3, 10, 25, 50, 80]) {
    const fit = fitQuoteText(ctx, "word ".repeat(words).trim(), { ...BOX, direction: "ltr" });
    assert.ok(fit.fontSize <= previous, `${words} words: ${fit.fontSize} <= ${previous}`);
    assert.ok(fit.fontSize >= QUOTE_CARD_FONT_MIN && fit.fontSize <= QUOTE_CARD_FONT_MAX);
    assert.ok(fit.layout.height <= BOX.height, `${words} words fit the height`);
    for (const line of fit.layout.lines) assert.ok(line.width <= BOX.width, `line "${line.text}" fits the width`);
    previous = fit.fontSize;
  }
  assert.ok(previous < QUOTE_CARD_FONT_MAX, "the longest quote shrank");
});

test("fit: text too long even at the minimum size is clipped with an ellipsis", () => {
  const { ctx } = fakeCanvas();
  const fit = fitQuoteText(ctx, "word ".repeat(2000).trim(), { ...BOX, direction: "ltr" });
  assert.equal(fit.fontSize, QUOTE_CARD_FONT_MIN);
  assert.equal(fit.clipped, true);
  assert.ok(fit.layout.height <= BOX.height);
  assert.ok(fit.layout.lines.at(-1).text.endsWith("…"));
});

test("fit: an unbroken 300-character word breaks into lines no wider than the box", () => {
  const { ctx } = fakeCanvas();
  const fit = fitQuoteText(ctx, "x".repeat(300), { ...BOX, direction: "ltr" });
  assert.ok(fit.layout.lines.length > 1);
  for (const line of fit.layout.lines) assert.ok(line.width <= BOX.width);
  assert.equal(fit.layout.lines.map((line) => line.text).join(""), "x".repeat(300));
});

// ---------------------------------------------------------------- card text

test("card text masks ||spoilers|| so the hidden words never reach the image", () => {
  const text = quoteCardText("keep ||the twist|| quiet");
  assert.doesNotMatch(text, /twist/);
  assert.ok(text.includes(SPOILER_MASK));
  assert.doesNotMatch(quoteCardText("||ending||"), /ending/);
});

test("card text drops quoted lines and markdown marks, collapses spacing, strips GIF tokens", () => {
  assert.equal(quoteCardText("> @ann said hi\nmy own words"), "my own words");
  assert.equal(quoteCardText("**bold** and `code` and ~~gone~~"), "bold and code and gone");
  assert.equal(quoteCardText("a\n\n\n   b    c  "), "a\nb c");
  assert.equal(quoteCardText("[gif:12345678-1234-1234-1234-123456789abc] hi"), "hi");
});

test("card text caps at QUOTE_CARD_MAX_CHARS graphemes with an ellipsis, never splitting an emoji", () => {
  const long = quoteCardText("x".repeat(QUOTE_CARD_MAX_CHARS + 50));
  assert.equal(Array.from(long).length, QUOTE_CARD_MAX_CHARS);
  assert.ok(long.endsWith("…"));
  const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
  const emoji = quoteCardText(family.repeat(QUOTE_CARD_MAX_CHARS + 5));
  assert.ok(emoji.endsWith("…"));
  assert.equal(emoji.slice(0, -1).replaceAll(family, ""), "");
});

// ---------------------------------------------------------------- RTL

test("textDirection: Arabic, Hebrew and Persian are rtl; Latin, digits-first Latin and emoji are ltr", () => {
  assert.equal(textDirection("مرحبا بالعالم"), "rtl");
  assert.equal(textDirection("שלום עולם"), "rtl");
  assert.equal(textDirection("سلام دنیا"), "rtl");
  assert.equal(textDirection("2026 שלום"), "rtl", "the first STRONG character decides");
  assert.equal(textDirection("Hello مرحبا"), "ltr");
  assert.equal(textDirection("Hello"), "ltr");
  assert.equal(textDirection("\u{1F600}\u{1F389}"), "ltr");
});

test("an RTL quote is painted with ctx.direction = rtl and right-aligned in the text box", async () => {
  const { canvas, calls } = fakeCanvas();
  const body = "مرحبا بالعالم";
  const result = await renderQuoteCard({ canvas, item: { body, username: "ann" }, origin: ORIGIN });
  assert.equal(result.direction, "rtl");
  const quoteCalls = calls.fillText.filter((call) => call.text.trim() && body.includes(call.text.trim()));
  assert.ok(quoteCalls.length > 0, "the quote was painted");
  const { textX, textWidth } = QUOTE_CARD_LAYOUT;
  for (const call of quoteCalls) {
    assert.equal(call.direction, "rtl");
    const size = Number(/(\d+)px/.exec(call.font)[1]);
    const right = call.x + Array.from(call.text).length * size * 0.5;
    assert.ok(Math.abs(right - (textX + textWidth)) < 1, "flush with the box's right edge");
  }
});

test("an LTR quote is painted with ctx.direction = ltr from the box's left edge", async () => {
  const { canvas, calls } = fakeCanvas();
  const result = await renderQuoteCard({ canvas, item: { body: "Hello world", username: "ann" }, origin: ORIGIN });
  assert.equal(result.direction, "ltr");
  const call = calls.fillText.find((entry) => entry.text === "Hello world");
  assert.ok(call);
  assert.equal(call.direction, "ltr");
  assert.equal(call.x, QUOTE_CARD_LAYOUT.textX);
  assert.equal(canvas.width, QUOTE_CARD_WIDTH);
  assert.equal(canvas.height, QUOTE_CARD_HEIGHT);
});

test("the card paints the name, the @handle and the site wordmark", async () => {
  const { canvas, calls } = fakeCanvas();
  await renderQuoteCard({ canvas, item: { body: "hi", username: "ann", displayName: "Ann B" }, origin: ORIGIN });
  const texts = calls.fillText.map((call) => call.text);
  assert.ok(texts.includes("— Ann B"));
  assert.ok(texts.includes("@ann"));
  assert.ok(texts.includes(t("app.siteName")));
});

// ---------------------------------------------------------------- avatars

test("isDrawableAvatar: only same-origin /api/avatars/ URLs may touch the canvas", () => {
  assert.equal(isDrawableAvatar("/api/avatars/7?v=3", ORIGIN), true);
  assert.equal(isDrawableAvatar(`${ORIGIN}/api/avatars/7?v=3`, ORIGIN), true);
  for (const bad of [
    "https://evil.example/api/avatars/7", "//evil.example/api/avatars/7", "data:image/png;base64,AAAA",
    "javascript:alert(1)", "blob:https://wempos-forum.com/x", "/api/gifs/1", "", null, undefined, 42,
    "http://wempos-forum.com/api/avatars/7",
  ]) {
    assert.equal(isDrawableAvatar(bad, ORIGIN), false, String(bad));
  }
});

test("a cross-origin or missing avatar is never loaded: the fallback avatar is drawn instead", async () => {
  for (const avatarUrl of ["https://evil.example/a.png", null, undefined]) {
    const { canvas, calls } = fakeCanvas();
    const loads = [];
    const result = await renderQuoteCard({
      canvas, item: { body: "hi", username: "ann", avatarUrl }, origin: ORIGIN,
      loadImage: async (url) => { loads.push(url); return {}; },
    });
    assert.deepEqual(loads, [], String(avatarUrl));
    assert.equal(calls.drawImage.length, 0);
    assert.equal(result.avatar, "fallback");
    assert.ok(calls.fillText.some((call) => call.text === "A"), "the fallback monogram is painted");
  }
});

test("a same-origin avatar is loaded by its resolved URL and drawn; a failed load falls back", async () => {
  const image = { naturalWidth: 200, naturalHeight: 100 };
  const { canvas, calls } = fakeCanvas();
  const loads = [];
  const result = await renderQuoteCard({
    canvas, item: { body: "hi", username: "ann", avatarUrl: "/api/avatars/7?v=3" }, origin: ORIGIN,
    loadImage: async (url) => { loads.push(url); return image; },
  });
  assert.deepEqual(loads, [`${ORIGIN}/api/avatars/7?v=3`]);
  assert.equal(calls.drawImage.length, 1);
  assert.equal(calls.drawImage[0][0], image);
  assert.equal(result.avatar, "image");
  const failed = fakeCanvas();
  const fallback = await renderQuoteCard({
    canvas: failed.canvas, item: { body: "hi", username: "ann", avatarUrl: "/api/avatars/7" }, origin: ORIGIN,
    loadImage: async () => { throw new Error("404"); },
  });
  assert.equal(fallback.avatar, "fallback");
  assert.equal(failed.calls.drawImage.length, 0);
});

// ---------------------------------------------------------------- visibility

const member = { id: 7, role: null };
const staff = { id: 1, role: "owner" };
const post = (extra = {}) => ({
  id: 5, body: "hi there", createdAt: "2026-11-22T00:00:00Z", visibility: "public",
  author: { id: 9, username: "ann", role: null, avatarUrl: "/api/avatars/9?v=1" }, ...extra,
});

test("canQuoteCard: only visible public content by a present author, never a staff-only view", () => {
  assert.equal(canQuoteCard(post(), member), true);
  assert.equal(canQuoteCard(post(), null), true, "guests can see public posts");
  assert.equal(canQuoteCard(post({ visibility: "hidden" }), staff), false, "hidden content");
  assert.equal(canQuoteCard(post({ visibility: "hidden" }), member), false);
  assert.equal(canQuoteCard(post({ author: null }), member), false, "removed author");
  assert.equal(canQuoteCard(post({ body: "   " }), member), false, "nothing to quote");
  assert.equal(canQuoteCard(post({ body: "[gif:12345678-1234-1234-1234-123456789abc]" }), member), false);
  assert.equal(canQuoteCard(post(), staff), false, "staff can see banned/blocked content the public cannot");
  assert.equal(canQuoteCard(post({ author: { id: 1, username: "own" } }), staff), true, "staff may quote themselves");
  assert.equal(canQuoteCard({ id: 3, body: "lobby hi", author: { id: 9, username: "ann" } }, member), true,
    "a chat message the reader is looking at");
  assert.equal(canQuoteCard(null, member), false);
});

test("render.js hook: the Quote card action rides visible cards only", () => {
  const doc = () => makeFakeDocument();
  assert.equal(countByClass(createPostCard(post(), doc(), member), "quote-card-action"), 1);
  assert.equal(countByClass(createPostCard(post({ parent: { id: 2, body: "x" }, publicLevel: 1 }), doc(), member),
    "quote-card-action"), 1, "replies too");
  assert.equal(countByClass(createPostCard(post({ visibility: "hidden" }), doc(), staff), "quote-card-action"), 0);
  assert.equal(countByClass(createPostCard(post(), doc(), staff), "quote-card-action"), 0);
  assert.equal(countByClass(createPostCard(post({ author: null }), doc(), member), "quote-card-action"), 0);
});

test("chat lobby hook: each message row asks createQuoteCardButton with the widget's viewer", () => {
  const lobby = read("public/js/chat-widget-lobby.js");
  assert.match(lobby, /import \{ createQuoteCardButton \} from "\.\/quote-card-action\.js";/);
  assert.match(lobby, /createQuoteCardButton\(document, message, ui\.widgetUser\)/);
});

test("quote-card.js is lazy: nothing imports it statically; the action module import()s it", () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith(".js") ? [join(dir, entry.name)] : []);
  for (const file of walk(new URL("public/js/", ROOT).pathname)) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /from ["']\.{1,2}\/(?:[\w-]+\/)*quote-card\.js["']/, file);
  }
  assert.match(read("public/js/quote-card-action.js"), /import\("\.\/quote-card\.js"\)/);
  assert.doesNotMatch(read("public/js/quote-card.js"), /\bapi\(|fetch\(|XMLHttpRequest/, "no server call");
});

test("the action button: a real button that lazy-loads the card with a snapshot of the item", async () => {
  const opened = [];
  const item = post();
  const button = createQuoteCardButton(makeFakeDocument(), item, member, {
    load: async () => ({ openQuoteCardDialog: (document, snapshot, options) => opened.push({ snapshot, options }) }),
  });
  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.type, "button");
  assert.ok(button.className.split(" ").includes("quote-card-action"));
  assert.equal(button.textContent, t("quotecard.action"));
  assert.equal(button.getAttribute("aria-label"), t("quotecard.actionLabel", { name: "ann" }));
  item.body = "edited later";
  button.dispatch("click");
  await tick();
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0].snapshot,
    { body: "hi there", username: "ann", displayName: "ann", avatarUrl: "/api/avatars/9?v=1" });
  assert.equal(opened[0].options.opener, button);
  assert.equal(createQuoteCardButton(makeFakeDocument(), post({ visibility: "hidden" }), member), null);
});

// ---------------------------------------------------------------- dialog

function dialogHarness({ clipboard = true } = {}) {
  const body = new FakeNode("body");
  const clicked = [];
  const document = makeFakeDocument({
    body,
    createElement: (tag) => {
      const node = new FakeNode(tag);
      if (tag === "dialog") {
        node.open = false;
        node.showModal = () => { node.open = true; };
        node.close = () => { node.open = false; node.dispatch("close"); };
      }
      if (tag === "a") node.click = () => clicked.push({ href: node.href, download: node.download });
      return node;
    },
  });
  const surfaces = [];
  const createCanvas = () => { const surface = fakeCanvas(); surfaces.push(surface); return surface.canvas; };
  const writes = [];
  const revoked = [];
  const navigator = clipboard ? { clipboard: { write: async (items) => { writes.push(items); } } } : {};
  class FakeClipboardItem { constructor(data) { this.data = data; } }
  const opener = new FakeNode("button");
  const { dialog, ready } = openQuoteCardDialog(document, { body: "Hello world", username: "ann", avatarUrl: null }, {
    opener, origin: ORIGIN, createCanvas, navigator, ClipboardItem: clipboard ? FakeClipboardItem : undefined,
    URL: { createObjectURL: () => "blob:quote", revokeObjectURL: (url) => revoked.push(url) },
  });
  return { body, clicked, dialog, ready, surfaces, writes, revoked, opener, FakeClipboardItem };
}

test("dialog: opens modal with the preview image whose alt text is the quote", async () => {
  const h = dialogHarness();
  await h.ready;
  assert.equal(h.dialog.open, true);
  assert.equal(h.dialog.parentNode, h.body);
  const image = findByClass(h.dialog, "quote-card-preview");
  assert.equal(image.tagName, "IMG");
  assert.equal(image.alt, "Hello world");
  assert.match(image.src, /^data:image\/png/);
  assert.ok(h.dialog.getAttribute("aria-labelledby"));
});

test("dialog: Download PNG goes through canvas.toBlob and an <a download> click", async () => {
  const h = dialogHarness();
  await h.ready;
  findByClass(h.dialog, "quote-card-download").dispatch("click");
  await tick();
  assert.deepEqual(h.surfaces[0].calls.toBlob, ["image/png"]);
  assert.deepEqual(h.clicked, [{ href: "blob:quote", download: quoteCardFileName({ username: "ann" }) }]);
  assert.equal(quoteCardFileName({ username: "ann" }), "quote-ann.png");
  assert.equal(quoteCardFileName({ username: "../a b" }), "quote-___a_b.png");
});

test("dialog: Copy image writes one image/png ClipboardItem; the button hides when unsupported", async () => {
  const h = dialogHarness();
  await h.ready;
  const copy = findByClass(h.dialog, "quote-card-copy");
  assert.equal(copy.hidden, false);
  copy.dispatch("click");
  await tick();
  await tick();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].length, 1);
  assert.ok(h.writes[0][0] instanceof h.FakeClipboardItem);
  assert.deepEqual(Object.keys(h.writes[0][0].data), ["image/png"]);
  const bare = dialogHarness({ clipboard: false });
  await bare.ready;
  assert.equal(findByClass(bare.dialog, "quote-card-copy").hidden, true);
});

test("dialog: dark by default; the light toggle re-renders with the light palette", async () => {
  const h = dialogHarness();
  await h.ready;
  const surface = h.surfaces[0];
  assert.equal(surface.calls.fillRect[0].fill, QUOTE_CARD_THEMES.dark.background);
  const toggle = findByClass(h.dialog, "quote-card-theme");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  const before = surface.calls.fillRect.length;
  toggle.dispatch("click");
  await tick();
  await tick();
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(surface.calls.fillRect[before].fill, QUOTE_CARD_THEMES.light.background);
});

test("dialog: Escape and Close both close it, remove it, and return focus to the opener", async () => {
  const h = dialogHarness();
  await h.ready;
  h.dialog.dispatch("keydown", { key: "Escape" });
  assert.equal(h.dialog.open, false);
  assert.equal(h.dialog.parentNode, null);
  assert.equal(h.opener.ownerFocused, true);
  const again = dialogHarness();
  await again.ready;
  findByClass(again.dialog, "quote-card-close").dispatch("click");
  assert.equal(again.dialog.open, false);
  assert.equal(again.opener.ownerFocused, true);
});

// ---------------------------------------------------------------- strings

const QUOTE_CARD_KEYS = [
  "quotecard.action", "quotecard.actionLabel", "quotecard.title", "quotecard.preparing", "quotecard.download",
  "quotecard.copy", "quotecard.copied", "quotecard.copyFailed", "quotecard.failed", "quotecard.lightTheme",
];

test("every locale carries the quotecard.* strings with matching placeholders, translated beyond English", () => {
  const en = JSON.parse(read("public/locales/en.json"));
  const files = readdirSync(new URL("public/locales/", ROOT)).filter((name) => name.endsWith(".json"));
  for (const file of files) {
    const table = JSON.parse(read(`public/locales/${file}`));
    for (const key of QUOTE_CARD_KEYS) {
      assert.equal(typeof table[key], "string", `${file} ${key}`);
      assert.ok(table[key].trim(), `${file} ${key} non-empty`);
      assert.deepEqual(table[key].match(/\{\w+\}/g) ?? [], en[key].match(/\{\w+\}/g) ?? [], `${file} ${key} placeholders`);
    }
    if (file !== "en.json") {
      const same = QUOTE_CARD_KEYS.filter((key) => table[key] === en[key]).length;
      assert.ok(same <= 2, `${file}: ${same} quotecard strings left in English`);
    }
  }
});
