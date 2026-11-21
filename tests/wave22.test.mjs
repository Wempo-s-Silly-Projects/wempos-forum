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

// Wave 2026-11-21-22. F1: code-level accessibility pass 2 over the UI shipped
// v4.13..v4.26 (focus kept after self-hiding/disabling controls and route
// repaints, async results spoken, states spoken not just styled, toggles
// with valid roles). F2: "Fold all replies" on long threads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeNode, makeFakeDocument, findByClass } from "./helpers/fake-dom.mjs";
import { parseInline } from "../public/js/markdown.js";
import { createRevealSpoilersButton } from "../public/js/reveal-spoilers.js";
import { openLightbox } from "../public/js/lightbox.js";
import { focusPageHeading } from "../public/js/focus-utils.js";
import { createSettingsFilter } from "../public/js/settings-tools.js";
import { renderNotificationsPage } from "../public/js/notifications.js";
import {
  addReplyFolds, createFoldAllToggle, FOLD_ALL_MIN_REPLIES, FOLD_BUTTON_CLASS,
} from "../public/js/reply-fold.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fakeDocument = makeFakeDocument();

const collect = (root, predicate, out = []) => {
  if (predicate(root)) out.push(root);
  for (const child of root.children || []) collect(child, predicate, out);
  return out;
};

// --- F1.1 Show spoilers: focus survives the button hiding itself --------------------

test("Show spoilers moves focus to the first revealed spoiler of its own card", async () => {
  const article = new FakeNode("article");
  const paragraph = new FakeNode("p");
  paragraph.append(...parseInline(fakeDocument, "one ||a|| two ||b||"));
  article.append(paragraph);
  const button = createRevealSpoilersButton(fakeDocument, article);
  article.append(button);
  await button.fire("click");
  const spoilers = Array.from(article.querySelectorAll(".spoiler"));
  assert.equal(button.hidden, true);
  assert.equal(spoilers[0].ownerFocused, true, "focus lands on revealed content, not <body>");
  assert.equal(spoilers[0].getAttribute("tabindex"), "-1");
  assert.notEqual(spoilers[1].ownerFocused, true);
});

// --- F1.2 Lightbox: a step button disabled under focus hands focus on ---------------

const buildStrip = (count) => {
  const strip = new FakeNode("div");
  strip.className = "post-attachments";
  const thumbs = Array.from({ length: count }, (_, index) => {
    const thumb = new FakeNode("button");
    thumb.className = "attachment-expand";
    const img = new FakeNode("img");
    img.src = `/api/attachments/a${index}?v=1`;
    thumb.append(img);
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

test("lightbox: Next reaching the last image moves focus to Previous", () => {
  const thumbs = buildStrip(2);
  const dialog = buildDialog();
  openLightbox(dialog, thumbs[0], makeFakeDocument());
  const previous = dialog.querySelector(".lightbox-previous");
  const next = dialog.querySelector(".lightbox-next");
  next.dispatch("click");
  assert.equal(next.disabled, true);
  assert.equal(previous.ownerFocused, true);
});

test("lightbox: Previous reaching the first image (also by Home key on it) moves focus to Next", () => {
  const thumbs = buildStrip(3);
  const dialog = buildDialog();
  openLightbox(dialog, thumbs[2], makeFakeDocument());
  const previous = dialog.querySelector(".lightbox-previous");
  const next = dialog.querySelector(".lightbox-next");
  next.ownerFocused = false;
  dialog.dispatch("keydown", { key: "Home", target: previous, preventDefault() {} });
  assert.equal(previous.disabled, true);
  assert.equal(next.ownerFocused, true);
  next.ownerFocused = false;
  dialog.dispatch("keydown", { key: "End", target: dialog, preventDefault() {} });
  assert.notEqual(next.ownerFocused, true, "keys pressed elsewhere never steal focus");
});

// --- F1.3 Mod desk: focus after the restore / hide-recent repaint -------------------

test("focusPageHeading focuses the repainted page's h1 (made focusable)", () => {
  const main = new FakeNode("main");
  const h1 = new FakeNode("h1");
  h1.scrollIntoView = () => {};
  main.append(new FakeNode("section"), h1);
  focusPageHeading(main, { reducedMotion: true });
  assert.equal(h1.ownerFocused, true);
  assert.equal(h1.getAttribute("tabindex"), "-1");
  assert.doesNotThrow(() => focusPageHeading(new FakeNode("main")));
  assert.doesNotThrow(() => focusPageHeading(null));
});

test("mod desk restore and hide-recent re-focus the page heading after the repaint", () => {
  const admin = read("public/js/routes/admin.js");
  assert.match(admin, /import \{ focusPageHeading \} from "\.\.\/focus-utils\.js"/);
  assert.match(admin, /renderRoute\(state\.activeRoute\);\n\s+focusPageHeading\(main\);\n\s+setMessage\(tn\("admin\.msg\.hidRecent"/);
  assert.match(admin, /renderRoute\(state\.activeRoute\);\n\s+focusPageHeading\(main\);\n\s+setMessage\(tn\("admin\.msg\.restored"/);
});

// --- F1.4 Settings filter: the no-match result is spoken ----------------------------

test("settings filter announces no matches through a status mounted empty", () => {
  const panel = new FakeNode("section");
  panel.textContent = "Two-factor";
  const filter = createSettingsFilter(fakeDocument, [panel]);
  const status = findByClass(filter, "settings-filter-status");
  const input = filter.querySelector("input");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.hidden, false, "a live region must exist before it speaks");
  assert.equal(status.textContent, "");
  input.value = "zzz";
  input.dispatch("input");
  assert.equal(status.textContent, "settings.filterEmpty");
  input.value = "two";
  input.dispatch("input");
  assert.equal(status.textContent, "");
});

// --- F1.5 Notifications: unread is a spoken word, not aria-current -----------------

test("unread notification rows (single and grouped) say Unread; none misuse aria-current", () => {
  const item = (id, targetPostId, read = false) => ({ id, targetPostId, replyId: id + 100, read, postPreview: "", label: null });
  const main = new FakeNode("main");
  main.ownerDocument = fakeDocument;
  renderNotificationsPage(main, [item(9, 1), item(8, 1), item(7, 2), item(6, 3, true)]);
  const rows = collect(main, (node) => String(node.className || "").includes("notification-item"));
  assert.equal(rows.length, 3);
  for (const row of rows) assert.equal(row.getAttribute("aria-current"), null);
  const tagOf = (row) => row.children[0]?.className === "visually-hidden" ? row.children[0].textContent : null;
  assert.match(tagOf(rows[0]), /^bell\.unreadTag /, "grouped unread row");
  assert.match(tagOf(rows[1]), /^bell\.unreadTag /, "single unread row");
  assert.equal(tagOf(rows[2]), null, "read row carries no tag");
});

// --- F1.6 Gallery picker: selection state is spoken ---------------------------------

test("gallery grids are groups of pressed toggles, not listboxes of options", () => {
  const html = read("public/index.html");
  assert.match(html, /id="gif-grid" class="gif-grid" role="group"/);
  assert.match(html, /id="gif-recents"[^>]*role="group"/);
  const composer = read("public/js/routes/composer.js");
  assert.doesNotMatch(composer, /thumb\.setAttribute\("role", "option"\)/, "option ignores aria-pressed");
  assert.match(composer, /thumb\.setAttribute\("aria-pressed"/);
});

// --- F2 Fold all replies --------------------------------------------------------------

const replyCard = () => {
  const card = new FakeNode("article");
  card.className = "post-card";
  const header = new FakeNode("header");
  header.className = "post-header";
  card.append(header, new FakeNode("div"));
  return card;
};
const thread = (count) => {
  const list = new FakeNode("div");
  const cards = Array.from({ length: count }, replyCard);
  list.append(...cards);
  addReplyFolds(fakeDocument, list);
  return { list, cards };
};

test("fold all: only on threads with enough replies", () => {
  assert.equal(FOLD_ALL_MIN_REPLIES, 3);
  assert.equal(createFoldAllToggle(fakeDocument, thread(2).list, 2), null);
  assert.equal(createFoldAllToggle(fakeDocument, null, 9), null);
  const button = createFoldAllToggle(fakeDocument, thread(3).list, 3);
  assert.equal(button.type, "button");
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.equal(button.textContent, "post.foldAll");
});

test("fold all folds every reply and syncs each Fold toggle; pressing again unfolds all", () => {
  const { list, cards } = thread(3);
  const button = createFoldAllToggle(fakeDocument, list, 3);
  const label = button.textContent;
  button.dispatch("click");
  assert.ok(cards.every((card) => card.hasAttribute("data-folded")));
  assert.ok(cards.every((card) => findByClass(card, FOLD_BUTTON_CLASS).getAttribute("aria-pressed") === "true"));
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(button.textContent, label, "aria-pressed alone carries the state");
  button.dispatch("click");
  assert.ok(cards.every((card) => !card.hasAttribute("data-folded")));
  assert.ok(cards.every((card) => findByClass(card, FOLD_BUTTON_CLASS).getAttribute("aria-pressed") === "false"));
  assert.equal(button.getAttribute("aria-pressed"), "false");
});

test("fold all after a manual unfold folds the rest instead of unfolding everything", () => {
  const { list, cards } = thread(3);
  const button = createFoldAllToggle(fakeDocument, list, 3);
  button.dispatch("click");
  const single = findByClass(cards[1], FOLD_BUTTON_CLASS);
  single.dispatch("click");
  list.dispatch("click", { target: single }); // the fake DOM does not bubble
  assert.equal(button.getAttribute("aria-pressed"), "false", "the bulk toggle follows the cards");
  button.dispatch("click");
  assert.ok(cards.every((card) => card.hasAttribute("data-folded")));
});

test("fold all: wired on the thread page above the replies, nothing stored", () => {
  const post = read("public/js/routes/post.js");
  // Wave 24: the gate counts an unloaded older page (knownReplyTotal).
  assert.match(post, /createFoldAllToggle\(document, replyList, knownReplyTotal\(post\)\)/);
  const source = read("public/js/reply-fold.js");
  assert.doesNotMatch(source, /localStorage|api\(|fetch\(/);
});

// --- strings ----------------------------------------------------------------------------

test("wave-22 strings exist and are translated in every locale", () => {
  const en = JSON.parse(read("public/locales/en.json"));
  const locales = ["ar", "de", "es", "fr", "he", "hi", "id", "it", "ja", "ko", "nl", "pl", "pt",
    "ru", "th", "tr", "uk", "vi", "zh-Hans", "zh-Hant"];
  for (const key of ["bell.unreadTag", "post.foldAll", "post.foldAllTitle"]) {
    assert.ok(en[key], `en has ${key}`);
    for (const locale of locales) {
      const value = JSON.parse(read(`public/locales/${locale}.json`))[key];
      assert.ok(value, `${locale} has ${key}`);
      assert.notEqual(value, en[key], `${locale} ${key} is translated`);
    }
  }
});
