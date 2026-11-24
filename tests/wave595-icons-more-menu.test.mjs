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

// v5.95 (owner plan items 1, 4, 6): a vendored Lucide icon set, one "More"
// (⋯) menu per post card, an icon composer toolbar, and pin/lock icons.
// Nothing is removed: every moved control keeps its data-action and name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { makeFakeDocument } from "./helpers/fake-dom.mjs";

globalThis.speechSynthesis ??= { speak() {}, cancel() {}, getVoices: () => [] };
globalThis.SpeechSynthesisUtterance ??= function Utterance() {};

const { createPostCard, appendPostList, createSubReplyContainer } = await import("../public/js/render.js");
const { VENDOR_ICON_NAMES, vendorIcon } = await import("../public/js/icons.js");
const { organizePostActions, MOVED_ACTION_LABEL } = await import("../public/js/post-more.js");
const { createComposerToolbar } = await import("../public/js/composer-toolbar.js");
const { FORMAT_KINDS } = await import("../public/js/composer-format.js");
const { t } = await import("../public/js/i18n.js");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const doc = makeFakeDocument();
const OWNER = { id: 1, username: "boss", role: "owner" };
const AUTHOR = { id: 9, username: "alice", role: null };
const MEMBER = { id: 3, username: "bob", role: null };
const ICON_DIR = new URL("../public/icons/lucide/", import.meta.url);

function rootPost(overrides = {}) {
  return {
    id: 12, body: "thread root", parent: null, visibility: "public", board: "general",
    createdAt: "2026-11-22T10:00:00.000Z", author: { id: 9, username: "alice", role: null, avatarUrl: null },
    likeCount: 1, dislikeCount: 0, viewerReaction: null, viewCount: 4, replyCount: 2, subReplyCount: 0,
    pinnedAt: null, staffPick: false, locked: false, subscribed: false, viewerMuted: false,
    viewerBookmarked: false, ...overrides,
  };
}
const replyPost = (overrides = {}) => rootPost({
  id: 40, body: "a reply", parent: { id: 12, body: "thread root" }, publicLevel: 1, subscribed: undefined,
  viewerMuted: undefined, ...overrides,
});

const actionRow = (card) => card.querySelector(".post-actions");
const more = (card) => card.querySelector(".post-more");
const trigger = (card) => card.querySelector(".post-more-toggle");
const menu = (card) => card.querySelector(".post-more-menu");
const items = (card) => Array.from(menu(card).querySelectorAll("button"));
const nameOf = (node) => (node.getAttribute("aria-label") || node.textContent).trim();
const names = (root) => Array.from(root.querySelectorAll("button, a")).map(nameOf).sort();
const actionsIn = (root) => Array.from(root.querySelectorAll("button")).map((node) => node.dataset.action).filter(Boolean).sort();
const key = (name, extra = {}) => ({ key: name, preventDefault() {}, stopPropagation() {}, ...extra });
const resetFocus = (card) => {
  for (const node of [trigger(card), ...items(card)]) node.ownerFocused = false;
};
function organized(post, viewer) {
  const card = createPostCard(post, doc, viewer);
  organizePostActions(doc, card);
  return card;
}

// --- vendored icon set -------------------------------------------------------

test("the Lucide set is vendored verbatim with its upstream LICENSE and a REUSE override", () => {
  const files = readdirSync(ICON_DIR);
  assert.ok(files.includes("LICENSE"), "upstream LICENSE beside the SVGs");
  const license = readFileSync(new URL("LICENSE", ICON_DIR), "utf8");
  assert.match(license, /^ISC License/);
  assert.match(license, /Lucide Icons and Contributors/);
  const svgs = files.filter((name) => name.endsWith(".svg")).map((name) => name.slice(0, -4)).sort();
  assert.deepEqual(svgs, [...VENDOR_ICON_NAMES].sort(), "only the icons in use are vendored");
  for (const name of svgs) {
    const svg = readFileSync(new URL(name + ".svg", ICON_DIR), "utf8");
    assert.match(svg, /^<svg\n {2}xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, name + " is upstream-shaped");
    assert.match(svg, /stroke="currentColor"/, name);
    assert.doesNotMatch(svg, /<script|\bon[a-z]+=|href=|<foreignObject/i, name + " is inert");
  }
  const reuse = read("REUSE.toml");
  const block = reuse.slice(reuse.indexOf('path = "public/icons/lucide/**"'));
  assert.ok(reuse.includes('path = "public/icons/lucide/**"'), "REUSE annotation for the folder");
  assert.match(block, /^path = "public\/icons\/lucide\/\*\*"\nprecedence = "override"\nSPDX-FileCopyrightText = "2026 Lucide Icons and Contributors"\nSPDX-License-Identifier = "ISC"/);
  assert.match(reuse, /SPDX-FileCopyrightText = \["2026 Lucide Icons and Contributors", "2013-present Cole Bemis"\]\nSPDX-License-Identifier = "ISC AND MIT"/,
    "Feather-derived icons carry the MIT notice too");
});

test("vendorIcon paints a decorative span from a same-origin mask; every icon has a CSS rule", () => {
  const css = read("public/styles.css");
  for (const name of VENDOR_ICON_NAMES) {
    const icon = vendorIcon(doc, name);
    assert.equal(icon.tagName, "SPAN");
    assert.equal(icon.getAttribute("aria-hidden"), "true");
    assert.equal(icon.className, "vicon vicon-" + name);
    assert.ok(css.includes(`.vicon-${name} { -webkit-mask-image: url("/icons/lucide/${name}.svg"); mask-image: url("/icons/lucide/${name}.svg"); }`),
      name + " CSS rule");
  }
  assert.throws(() => vendorIcon(doc, "nope"), /No such icon/);
  assert.match(css, /\.vicon \{[^}]*background-color: currentColor;/);
  const module = read("public/js/icons.js");
  assert.doesNotMatch(module, /\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML\(|fetch\(|XMLHttpRequest/);
});

// --- the per-post More menu -------------------------------------------------

test("Reply, Like and Quote stay visible as named icon buttons with tooltips", () => {
  const card = organized(replyPost(), MEMBER);
  const row = actionRow(card);
  const visible = Array.from(row.children);
  const like = visible.find((node) => node.dataset.value === "like");
  const reply = visible.find((node) => node.dataset.action === "reply-to");
  const quote = visible.find((node) => node.dataset.action === "quote");
  for (const [label, node, expected] of [["like", like, null], ["reply", reply, t("common.reply")], ["quote", quote, t("render.quote")]]) {
    assert.ok(node, label + " is in the visible row");
    assert.ok(node.getAttribute("aria-label")?.trim(), label + " has an accessible name");
    assert.ok(String(node.title || node.getAttribute("title") || "").trim(), label + " has a tooltip");
    if (expected) assert.equal(node.getAttribute("aria-label"), expected);
  }
  assert.ok(String(reply.className).split(" ").includes("icon-button"));
  assert.ok(reply.querySelector(".vicon-reply"), "reply icon");
  assert.ok(quote.querySelector(".vicon-quote"), "quote icon");
  assert.equal(reply.textContent.trim(), "", "no visible word on the icon button");
});

test("More is a WAI-ARIA menu button, closed by default, holding every moved action", () => {
  const card = organized(rootPost(), AUTHOR);
  const toggle = trigger(card);
  const list = menu(card);
  assert.equal(toggle.tagName, "BUTTON");
  assert.equal(toggle.type, "button");
  assert.equal(toggle.getAttribute("aria-haspopup"), "menu");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(toggle.getAttribute("aria-controls"), list.id);
  assert.ok(list.id);
  assert.equal(toggle.getAttribute("aria-label"), t("threadActions.more"));
  assert.equal(toggle.title, t("threadActions.more"));
  assert.ok(toggle.querySelector(".vicon-ellipsis"));
  assert.equal(list.getAttribute("role"), "menu");
  assert.equal(list.getAttribute("aria-labelledby"), toggle.id);
  assert.equal(list.hidden, true);
  // Every moved action, by class or data-action.
  for (const cls of ["copy-link", "read-aloud-button", "quote-card-action", "bookmark-toggle", "subscribe-toggle", "thread-mute-toggle"]) {
    assert.ok(list.querySelector("." + cls), cls + " is in More");
  }
  // Report shows for every signed-in viewer of a visible post, the author too.
  assert.deepEqual(actionsIn(list), ["delete-post", "edit-post", "report", "toggle-bookmark", "toggle-subscribe",
    "toggle-thread-mute"].sort());
  for (const item of items(card)) {
    assert.match(item.getAttribute("role"), /^menuitem(checkbox)?$/, nameOf(item));
    assert.equal(item.tabIndex, -1, nameOf(item) + " roves");
    assert.ok(nameOf(item), "named");
  }
  const bookmark = list.querySelector(".bookmark-toggle");
  assert.equal(bookmark.getAttribute("role"), "menuitemcheckbox");
  assert.equal(bookmark.getAttribute("aria-checked"), "false");
  // The moved actions are no longer loose in the row.
  for (const node of Array.from(actionRow(card).children)) {
    assert.ok(!["toggle-bookmark", "edit-post", "delete-post", "report"].includes(node.dataset.action));
  }
  assert.equal(MOVED_ACTION_LABEL, "threadActions.more");
});

test("report lands in More for a member; staff tools stay on the card", () => {
  const card = organized(rootPost(), MEMBER);
  assert.ok(actionsIn(menu(card)).includes("report"));
  const staff = organized(rootPost(), OWNER);
  const row = actionRow(staff);
  assert.ok(Array.from(row.children).some((node) => node.dataset.action === "thread-pin"));
});

test("nothing is removed: every control keeps its name and data-action after organizing", () => {
  for (const [label, post, viewer] of [
    ["guest root", rootPost(), null],
    ["member root", rootPost(), MEMBER],
    ["author root", rootPost(), AUTHOR],
    ["owner root", rootPost({ pinnedAt: "2026-11-22T00:00:00Z", locked: true }), OWNER],
    ["member reply", replyPost(), MEMBER],
    ["author reply", replyPost({ author: { id: 3, username: "bob", role: null, avatarUrl: null } }), MEMBER],
  ]) {
    const before = createPostCard(post, doc, viewer);
    const after = organized(post, viewer);
    const added = more(after) ? [t("threadActions.more")] : [];
    assert.deepEqual(names(after), [...names(before), ...added].sort(), label);
    assert.deepEqual(actionsIn(after), actionsIn(before), label);
  }
});

test("Enter, Space and ArrowDown open on the first item; ArrowUp opens on the last", () => {
  for (const opener of ["Enter", " ", "ArrowDown"]) {
    const card = organized(rootPost(), AUTHOR);
    let prevented = false;
    trigger(card).dispatch("keydown", key(opener, { preventDefault() { prevented = true; } }));
    assert.equal(menu(card).hidden, false, opener);
    assert.equal(trigger(card).getAttribute("aria-expanded"), "true", opener);
    assert.equal(items(card)[0].ownerFocused, true, opener + " focuses the first item");
    assert.equal(prevented, true, opener + " is handled");
    menu(card).dispatch("keydown", key("Escape"));
  }
  const card = organized(rootPost(), AUTHOR);
  trigger(card).dispatch("keydown", key("ArrowUp"));
  assert.equal(items(card).at(-1).ownerFocused, true);
  menu(card).dispatch("keydown", key("Escape"));
});

test("Escape closes and returns focus to the trigger; other keys rove the items", () => {
  const card = organized(rootPost(), AUTHOR);
  trigger(card).dispatch("keydown", key("Enter"));
  const list = items(card);
  resetFocus(card);
  menu(card).dispatch("keydown", key("ArrowDown", { target: list[0] }));
  assert.equal(list[1].ownerFocused, true, "ArrowDown moves to the next item");
  resetFocus(card);
  menu(card).dispatch("keydown", key("ArrowUp", { target: list[0] }));
  assert.equal(list.at(-1).ownerFocused, true, "ArrowUp wraps to the last item");
  resetFocus(card);
  menu(card).dispatch("keydown", key("End", { target: list[0] }));
  assert.equal(list.at(-1).ownerFocused, true);
  resetFocus(card);
  menu(card).dispatch("keydown", key("Home", { target: list.at(-1) }));
  assert.equal(list[0].ownerFocused, true);
  resetFocus(card);
  let stopped = false;
  menu(card).dispatch("keydown", key("Escape", { target: list[0], stopPropagation() { stopped = true; } }));
  assert.equal(menu(card).hidden, true);
  assert.equal(trigger(card).getAttribute("aria-expanded"), "false");
  assert.equal(trigger(card).ownerFocused, true, "focus back on More");
  assert.equal(stopped, true, "Escape stops at the menu");
  // Escape on the trigger of a closed menu lets the key through.
  let stoppedClosed = false;
  trigger(card).dispatch("keydown", key("Escape", { stopPropagation() { stoppedClosed = true; } }));
  assert.equal(stoppedClosed, false);
});

test("Tab closes the menu; a click toggles it; choosing an item closes it and refocuses More", () => {
  const card = organized(rootPost(), AUTHOR);
  trigger(card).dispatch("keydown", key("Enter"));
  menu(card).dispatch("keydown", key("Tab", { target: items(card)[0] }));
  assert.equal(menu(card).hidden, true);
  trigger(card).dispatch("click", { detail: 1 });
  assert.equal(menu(card).hidden, false);
  assert.equal(items(card)[0].ownerFocused, true);
  trigger(card).dispatch("click", { detail: 1 });
  assert.equal(menu(card).hidden, true);
  trigger(card).dispatch("click", { detail: 1 });
  resetFocus(card);
  const edit = items(card).find((node) => node.dataset.action === "edit-post");
  menu(card).dispatch("click", { target: edit });
  assert.equal(menu(card).hidden, true);
  assert.equal(trigger(card).ownerFocused, true);
});

test("opening one card's menu closes another's (one open menu at a time)", () => {
  const first = organized(rootPost(), AUTHOR);
  const second = organized(rootPost({ id: 13 }), AUTHOR);
  trigger(first).dispatch("keydown", key("Enter"));
  trigger(second).dispatch("keydown", key("Enter"));
  assert.equal(menu(first).hidden, true);
  assert.equal(menu(second).hidden, false);
  assert.notEqual(menu(first).id, menu(second).id, "ids are unique");
  menu(second).dispatch("keydown", key("Escape"));
});

test("live status regions stay outside the hidden menu so they are announced", () => {
  const card = organized(rootPost(), AUTHOR);
  const statuses = Array.from(more(card).querySelectorAll("span")).filter((node) => node.getAttribute("role") === "status");
  assert.ok(statuses.length >= 1);
  for (const status of statuses) assert.ok(!menu(card).contains(status), "status outside the menu");
});

test("lists, sub-reply cascades and thread replies get the menu; the thread root keeps its grouped More", () => {
  const container = doc.createElement("main");
  appendPostList(container, [rootPost()], doc, AUTHOR);
  assert.ok(container.querySelector(".post-more"), "feed card has More");
  const cascade = createSubReplyContainer(12, [replyPost({ publicLevel: 2 })], doc, MEMBER);
  assert.ok(cascade.querySelector(".post-more"), "sub-reply has More");
  const route = read("public/js/routes/post.js");
  assert.match(route, /import \{ organizePostActions \} from "\.\.\/post-more\.js";/);
  assert.equal(route.match(/organizePostActions\(document, card\)/g)?.length, 2, "both reply-card paths");
  assert.match(route, /if \(post\.parent\) organizePostActions\(document, rootCard\)/);
});

test("the menu drops over the page (no layout shift) and its targets are at least 24px", () => {
  const css = read("public/styles.css");
  assert.match(css, /\.post-more \{ position: relative;/);
  assert.match(css, /\.post-more-menu \{[^}]*position: absolute;/);
  assert.match(css, /\.post-more-menu\[hidden\] \{ display: none; \}/);
  assert.match(css, /\.post-more-menu \[role\^="menuitem"\] \{[^}]*min-height: 2\.75rem;/);
  assert.match(css, /\.post-more-menu \.icon-button::after \{ content: attr\(aria-label\); \}/);
  // .icon-button is 2.5rem square (40px) and the composer tools 2.25rem.
  assert.match(css, /\.icon-button \{\n {2}width: 2\.5rem;\n {2}height: 2\.5rem;/);
  assert.match(css, /\.composer-tool \{\n {2}min-width: 2\.25rem;\n {2}min-height: 2\.25rem;/);
  const module = read("public/js/post-more.js");
  assert.doesNotMatch(module, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser/);
  assert.doesNotMatch(module, /localStorage|sessionStorage|indexedDB|\bapi\(|fetch\(/);
  assert.match(read("public/index.html"), /<link rel="modulepreload" href="\/js\/post-more\.js">/);
});

// --- pin and lock ---------------------------------------------------------------

test("staff Pin/Lock controls are named icon buttons; pinned and locked chips are icons", () => {
  const open = createPostCard(rootPost(), doc, OWNER);
  const pin = Array.from(open.querySelectorAll("button")).find((node) => node.dataset.action === "thread-pin");
  const lock = Array.from(open.querySelectorAll("button")).find((node) => node.dataset.action === "thread-lock");
  assert.equal(pin.getAttribute("aria-label"), t("render.pin"));
  assert.equal(pin.title, t("render.pin"));
  assert.ok(pin.querySelector(".vicon-pin"));
  assert.equal(lock.getAttribute("aria-label"), t("threadLock.lock"));
  assert.equal(lock.title, t("threadLock.lock"));
  assert.ok(lock.querySelector(".vicon-lock"));
  for (const node of [pin, lock]) assert.ok(String(node.className).split(" ").includes("icon-button"));

  const shut = createPostCard(rootPost({ pinnedAt: "2026-11-22T00:00:00Z", locked: true }), doc, OWNER);
  const unpin = Array.from(shut.querySelectorAll("button")).find((node) => node.dataset.action === "thread-unpin");
  const unlock = Array.from(shut.querySelectorAll("button")).find((node) => node.dataset.action === "thread-unlock");
  assert.equal(unpin.getAttribute("aria-label"), t("render.unpin"));
  assert.ok(unpin.querySelector(".vicon-pin-off"));
  assert.equal(unlock.getAttribute("aria-label"), t("threadLock.unlock"));
  assert.ok(unlock.querySelector(".vicon-lock-open"));

  const header = shut.querySelector(".post-header");
  const pinned = header.querySelector(".post-pinned");
  assert.ok(pinned.querySelector(".vicon-pin"));
  assert.equal(pinned.querySelector(".visually-hidden").textContent, t("render.pinned"));
  const locked = header.querySelector(".post-locked");
  assert.ok(locked, "locked chip");
  assert.ok(locked.querySelector(".vicon-lock"));
  assert.equal(locked.querySelector(".visually-hidden").textContent, t("threadLock.note"));
  assert.equal(locked.title, t("threadLock.note"));
  // A reply never carries a lock chip; an open thread has none.
  assert.equal(createPostCard(rootPost(), doc, null).querySelector(".post-locked"), null);
  assert.equal(createPostCard(replyPost({ locked: true }), doc, null).querySelector(".post-locked"), null);
});

// --- composer ------------------------------------------------------------------

test("the formatting toolbar shows icons, each with a name and a tooltip", () => {
  const field = doc.createElement("textarea");
  const toolbar = createComposerToolbar(field, doc, { emoji: false });
  const buttons = Array.from(toolbar.children).filter((node) => node.tagName === "BUTTON");
  assert.equal(buttons.length, FORMAT_KINDS.length);
  for (const [index, button] of buttons.entries()) {
    const entry = FORMAT_KINDS[index];
    assert.ok(VENDOR_ICON_NAMES.includes(entry.icon), entry.kind + " icon is vendored");
    assert.ok(button.querySelector(".vicon-" + entry.icon), entry.kind);
    assert.equal(button.getAttribute("aria-label"), t(entry.labelKey));
    assert.equal(button.title, t(entry.labelKey));
    assert.equal(button.textContent.trim(), "", entry.kind + " has no glyph text");
  }
});

test("attach images stays (Gallery is the shared library, not a per-post upload) and the row is iconified", () => {
  const composer = read("public/js/routes/composer.js");
  assert.match(composer, /attach\.dataset\.action = "composer-attach";/, "attach images is kept");
  assert.match(composer, /iconAction\("paperclip", t\("composer\.attachImagesLabel"\)\)/);
  assert.match(composer, /iconAction\("images", t\("composer\.gallery"\)\)/);
  assert.match(composer, /iconAction\("chart-column", t\("composer\.pollLabel"\)\)/);
  assert.doesNotMatch(composer, /t\("composer\.attachImages"\)\)|t\("composer\.poll"\)\)/);
});

test("the new labels exist in en and every locale, translated", () => {
  const files = readdirSync(new URL("../public/locales/", import.meta.url)).filter((name) => name.endsWith(".json"));
  const en = JSON.parse(read("public/locales/en.json"));
  for (const file of files) {
    const table = JSON.parse(read("public/locales/" + file));
    for (const name of ["composer.attachImagesLabel", "composer.pollLabel"]) {
      assert.equal(typeof table[name], "string", file + " " + name);
      assert.ok(table[name].trim(), file + " " + name);
      assert.doesNotMatch(table[name], /\p{Extended_Pictographic}/u, file + " " + name + " has no emoji");
      if (file !== "en.json") assert.notEqual(table[name], en[name], file + " " + name + " is translated");
    }
  }
});

test("the TL;DR box is compact: inline title and body, tighter panel", () => {
  const css = read("public/styles.css");
  assert.match(css, /\.thread-tldr \{ padding: 0\.5rem 0\.75rem; margin-block: 0\.5rem; \}/);
  assert.match(css, /\.thread-tldr-title \{ display: inline; margin: 0; margin-inline-end: 0\.4rem; font-size: 0\.85rem;/);
  assert.match(css, /\.thread-tldr-body \{ display: inline; margin: 0;/);
});
