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

// v5.55 (ORGANIZE #1): the thread page's root card keeps at most four
// primary actions; everything else moves into one grouped "More" menu with a
// nested "Staff" menu. Nothing is removed: every control the card had before
// is still on the card, findable by the same accessible name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

// Read aloud only renders where a speech engine exists; give it one so the
// card carries every control (read aloud stays, owner verdict).
globalThis.speechSynthesis ??= { speak() {}, cancel() {}, getVoices: () => [] };
globalThis.SpeechSynthesisUtterance ??= function Utterance() {};

const { createPostCard } = await import("../public/js/render.js");
const { createSaveThreadButton } = await import("../public/js/thread-text.js");
const { createSlowModeForm } = await import("../public/js/slow-mode.js");
const { createTagEditor } = await import("../public/js/tags.js");
const {
  PRIMARY_ACTION_LIMIT, MORE_GROUPS, organizeThreadActions, placeInThreadHeader,
} = await import("../public/js/thread-actions.js");
const { t } = await import("../public/js/i18n.js");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const doc = makeFakeDocument();
const OWNER = { id: 1, username: "boss", role: "owner" };
const MEMBER = { id: 3, username: "bob", role: null };
const AUTHOR = { id: 9, username: "alice", role: null };

function rootPost(overrides = {}) {
  return {
    id: 12, body: "thread root ||secret||", parent: null, visibility: "public", board: "showcase",
    createdAt: "2026-11-22T10:00:00.000Z", author: { id: 9, username: "alice", role: null, avatarUrl: null },
    likeCount: 1, dislikeCount: 0, viewerReaction: null, viewCount: 4, replyCount: 2, subReplyCount: 0,
    pinnedAt: null, staffPick: false, locked: false, subscribed: false, viewerMuted: false,
    viewerBookmarked: false, ...overrides,
  };
}

function fakeShare() {
  const wrap = new FakeNode("div");
  wrap.className = "share-wrap";
  const button = new FakeNode("button");
  button.className = "button button-secondary share-button";
  button.textContent = t("share.button");
  wrap.append(button);
  return wrap;
}

function threadCard(post, viewer) {
  const card = createPostCard(post, doc, viewer);
  card.querySelector(".post-actions")
    .append(createSaveThreadButton(doc, { getRoot: () => card, threadId: post.id }));
  return card;
}

const isControl = (node) => node.tagName === "BUTTON" || (node.tagName === "A" && Boolean(node.href || node.getAttribute("href")))
  || node.tagName === "FORM";
const accessibleName = (node) => node.tagName === "FORM"
  ? "form:" + node.dataset.form
  : (node.getAttribute("aria-label") || node.textContent).trim();
const controlNames = (root) => root.querySelectorAll("button, a, form")
  .values().filter(isControl).map(accessibleName).toArray().sort();
const actionRow = (card) => Array.from(card.children).find((node) => node.className === "post-actions");
const CHIPS = new Set(["view-count", "reply-count"]);
const primaryControls = (card) => Array.from(actionRow(card).children)
  .filter((node) => !String(node.className).split(" ").some((name) => CHIPS.has(name)));

test("the action row keeps at most four primary controls: like, dislike, share, More", () => {
  const card = threadCard(rootPost(), AUTHOR);
  organizeThreadActions(doc, card, { postId: 12, share: fakeShare() });
  const primary = primaryControls(card);
  assert.ok(primary.length <= PRIMARY_ACTION_LIMIT, `${primary.length} primary controls`);
  assert.equal(PRIMARY_ACTION_LIMIT, 4);
  assert.deepEqual(primary.map((node) => node.dataset.value ?? node.className),
    ["like", "dislike", "share-wrap", "thread-more"]);
  // The counters stay in the row (they are not controls).
  assert.ok(actionRow(card).querySelector(".view-count"));
  assert.ok(actionRow(card).querySelector(".reply-count"));
});

test("without a share button the row is like, dislike, More", () => {
  const card = threadCard(rootPost(), MEMBER);
  organizeThreadActions(doc, card, { postId: 12 });
  assert.deepEqual(primaryControls(card).map((node) => node.dataset.value ?? node.className),
    ["like", "dislike", "thread-more"]);
});

test("More is grouped: Reading, Following, Sharing, This post, in that order", () => {
  const card = threadCard(rootPost(), AUTHOR);
  organizeThreadActions(doc, card, { postId: 12 });
  const panel = card.querySelector(".thread-more-panel");
  const groups = Array.from(panel.children).filter((node) => node.getAttribute("role") === "group");
  assert.deepEqual(groups.map((group) => group.dataset.group), MORE_GROUPS);
  const inGroup = (name) => controlNames(groups.find((group) => group.dataset.group === name));
  assert.deepEqual(inGroup("reading"),
    [t("post.saveAsTextLabel"), t("render.readAloud"), t("render.revealSpoilers")].sort());
  assert.deepEqual(inGroup("following"),
    [t("render.muteThread"), t("render.savePost"), t("render.subscribe")].sort());
  assert.deepEqual(inGroup("sharing"), [t("render.copyLink"), t("render.openPost")].sort());
  assert.deepEqual(inGroup("post"), [t("quotecard.actionLabel", { name: "alice" }), t("render.deleteThread"),
    t("render.editPost"), t("render.reportPost")].sort());
  for (const group of groups) {
    const labelId = group.getAttribute("aria-labelledby");
    const heading = group.querySelector(`[id=${labelId}]`);
    assert.ok(heading?.textContent.trim(), group.dataset.group + " has a visible label");
  }
});

test("the Staff submenu exists only for staff and holds every staff tool", () => {
  const member = threadCard(rootPost(), MEMBER);
  organizeThreadActions(doc, member, { postId: 12 });
  assert.equal(member.querySelector(".thread-staff"), null);

  const staff = threadCard(rootPost({ board: "showcase" }), OWNER);
  const slow = createSlowModeForm(doc, 12, null);
  organizeThreadActions(doc, staff, { postId: 12, staffForms: [slow] });
  const submenu = staff.querySelector(".thread-staff");
  assert.ok(submenu, "staff submenu");
  assert.ok(staff.querySelector(".thread-more-panel").contains(submenu), "nested inside More");
  const names = controlNames(submenu.querySelector(".thread-staff-panel"));
  for (const name of [t("render.pin"), t("threadLock.lock"), t("staffPick.pick"), "form:thread-slowmode"]) {
    assert.ok(names.includes(name), name);
  }
  // No staff tool is left in the primary row.
  for (const node of primaryControls(staff)) {
    assert.ok(!["thread-pin", "thread-lock", "staff-pick"].includes(node.dataset.action));
  }
});

test("suggestion status buttons go to the Staff submenu", () => {
  const card = threadCard(rootPost({ board: "suggestions" }), OWNER);
  organizeThreadActions(doc, card, { postId: 12 });
  const names = controlNames(card.querySelector(".thread-staff-panel"));
  assert.ok(names.includes(t("render.resolve")) && names.includes(t("render.decline")));
});

test("menus are real buttons with aria-expanded/aria-controls, closed by default", () => {
  const card = threadCard(rootPost({ board: "suggestions" }), OWNER);
  organizeThreadActions(doc, card, { postId: 12, tagEditor: createTagEditor(doc, 12, [{ id: 1, slug: "art", label: "Art" }], []) });
  for (const kind of ["more", "staff", "tags"]) {
    const wrap = card.querySelector(`.thread-${kind}`);
    const toggle = wrap.querySelector(`.thread-${kind}-toggle`);
    const panel = wrap.querySelector(`.thread-${kind}-panel`);
    assert.equal(toggle.tagName, "BUTTON", kind);
    assert.equal(toggle.type, "button", kind);
    assert.equal(toggle.getAttribute("aria-expanded"), "false", kind);
    assert.equal(toggle.getAttribute("aria-controls"), panel.id, kind);
    assert.ok(panel.id, kind);
    assert.equal(panel.hidden, true, kind + " collapsed by default");
    assert.ok(toggle.textContent.trim(), kind + " has a visible name");
  }
});

test("a toggle opens and closes its panel; Escape closes and returns focus", () => {
  const card = threadCard(rootPost({ board: "suggestions" }), OWNER);
  organizeThreadActions(doc, card, { postId: 12 });
  const more = card.querySelector(".thread-more");
  const moreToggle = more.querySelector(".thread-more-toggle");
  const morePanel = more.querySelector(".thread-more-panel");
  moreToggle.dispatch("click");
  assert.equal(moreToggle.getAttribute("aria-expanded"), "true");
  assert.equal(morePanel.hidden, false);
  moreToggle.dispatch("click");
  assert.equal(morePanel.hidden, true);
  moreToggle.dispatch("click");

  const staff = card.querySelector(".thread-staff");
  const staffToggle = staff.querySelector(".thread-staff-toggle");
  const staffPanel = staff.querySelector(".thread-staff-panel");
  staffToggle.dispatch("click");
  assert.equal(staffPanel.hidden, false);
  // Escape inside Staff closes only Staff (the event stops there).
  let stopped = false;
  staff.dispatch("keydown", { key: "Escape", preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(staffPanel.hidden, true);
  assert.equal(staffToggle.getAttribute("aria-expanded"), "false");
  assert.equal(staffToggle.ownerFocused, true, "focus back on the Staff button");
  assert.equal(stopped, true);
  assert.equal(morePanel.hidden, false, "More stays open");
  // The next Escape closes More.
  more.dispatch("keydown", { key: "Escape", preventDefault() {}, stopPropagation() {} });
  assert.equal(morePanel.hidden, true);
  assert.equal(moreToggle.ownerFocused, true, "focus back on More");
  // Escape on a closed menu does nothing and lets the key through.
  let stoppedClosed = false;
  more.dispatch("keydown", { key: "Escape", preventDefault() {}, stopPropagation() { stoppedClosed = true; } });
  assert.equal(stoppedClosed, false);
  // Other keys are ignored.
  moreToggle.dispatch("click");
  more.dispatch("keydown", { key: "a", preventDefault() {}, stopPropagation() {} });
  assert.equal(morePanel.hidden, false);
});

test("every control stays reachable by its accessible name (nothing removed)", () => {
  for (const [label, post, viewer] of [
    ["guest", rootPost(), null],
    ["member", rootPost(), MEMBER],
    ["author", rootPost(), AUTHOR],
    ["owner showcase", rootPost(), OWNER],
    ["owner suggestion", rootPost({ board: "suggestions", pinnedAt: "2026-11-22T00:00:00Z", locked: true }), OWNER],
  ]) {
    const card = threadCard(post, viewer);
    const share = viewer?.role === "owner" ? null : fakeShare();
    const slow = viewer?.role === "owner" ? createSlowModeForm(doc, 12, null) : null;
    const editor = viewer ? createTagEditor(doc, 12, [{ id: 1, slug: "art", label: "Art" }], []) : null;
    const before = [...controlNames(card), ...(share ? controlNames(share) : []),
      ...(slow ? ["form:thread-slowmode", ...controlNames(slow)] : []),
      ...(editor ? ["form:thread-tags", ...controlNames(editor)] : [])].sort();
    organizeThreadActions(doc, card, {
      postId: 12, share, tagEditor: editor, staffForms: slow ? [slow] : [],
    });
    const after = controlNames(card);
    const added = [t("threadActions.more")];
    if (viewer?.role === "owner") added.push(t("threadActions.staff"));
    if (editor) added.push(t("threadActions.editTags"));
    assert.deepEqual(after, [...before, ...added].sort(), label);
    // Every moved control keeps its data-action, so the page's one click
    // handler still reaches it.
    for (const action of ["reaction", "toggle-bookmark", "toggle-subscribe", "toggle-thread-mute", "report",
      "edit-post", "delete-post", "thread-pin", "thread-unpin", "thread-lock", "thread-unlock", "staff-pick",
      "suggestion-status"]) {
      // v5.57: counted by dataset; the fake DOM's [data-action=...] selector
      // never sees dataset writes, so the old query compared 0 with 0.
      const withAction = (root) => Array.from(root.querySelectorAll("button"))
        .filter((node) => node.dataset.action === action).length;
      const was = withAction(createPostCard(post, doc, viewer));
      assert.equal(withAction(card), was, `${label} ${action}`);
    }
  }
});

test("the tag editor sits collapsed under This post", () => {
  const card = threadCard(rootPost(), AUTHOR);
  const editor = createTagEditor(doc, 12, [{ id: 1, slug: "art", label: "Art" }], []);
  organizeThreadActions(doc, card, { postId: 12, tagEditor: editor });
  const group = Array.from(card.querySelectorAll(".thread-more-group")).find((node) => node.dataset.group === "post");
  const tags = group.querySelector(".thread-tags");
  assert.ok(tags.querySelector(".thread-tags-panel").contains(editor));
  assert.equal(tags.querySelector(".thread-tags-panel").hidden, true);
});

test("placeInThreadHeader puts tags and the TL;DR above the action row", () => {
  const card = threadCard(rootPost(), MEMBER);
  const chips = new FakeNode("ul");
  chips.className = "tag-chips";
  const tldr = new FakeNode("section");
  tldr.className = "thread-summary";
  placeInThreadHeader(card, chips);
  placeInThreadHeader(card, tldr);
  placeInThreadHeader(card, null);
  const order = Array.from(card.children).map((node) => node.className);
  const row = order.indexOf("post-actions");
  assert.equal(order.indexOf("tag-chips"), row - 2);
  assert.equal(order.indexOf("thread-summary"), row - 1);
});

test("a card without an action row is left alone", () => {
  const bare = new FakeNode("article");
  assert.doesNotThrow(() => organizeThreadActions(doc, bare, { postId: 1 }));
  assert.equal(bare.children.length, 0);
});

test("post.js organizes the root thread card; the module is DOM-safe, storage-free, network-free", () => {
  const post = read("public/js/routes/post.js");
  assert.match(post, /import \{[^}]*organizeThreadActions[^}]*\} from "\.\.\/thread-actions\.js"/);
  assert.match(post, /organizeThreadActions\(document, rootCard, /);
  assert.match(post, /placeInThreadHeader\(rootCard, /);
  // Moved off the page body: share, the slow-mode form and the tag editor.
  assert.doesNotMatch(post, /main\.append\(share\)/);
  assert.doesNotMatch(post, /main\.append\(createSlowModeForm/);
  assert.doesNotMatch(post, /main\.append\(editor\)/);
  const module = read("public/js/thread-actions.js");
  assert.doesNotMatch(module, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser/);
  assert.doesNotMatch(module, /localStorage|sessionStorage|indexedDB|\bapi\(|fetch\(/);
  assert.match(read("public/index.html"), /<link rel="modulepreload" href="\/js\/thread-actions\.js">/);
});

test("menu strings exist in en and all 65 locales", () => {
  const files = readdirSync(new URL("../public/locales/", import.meta.url)).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 65);
  const keys = ["threadActions.more", "threadActions.reading", "threadActions.following", "threadActions.sharing",
    "threadActions.thisPost", "threadActions.staff", "threadActions.editTags"];
  const en = JSON.parse(read("public/locales/en.json"));
  for (const file of files) {
    const table = JSON.parse(read("public/locales/" + file));
    for (const key of keys) {
      assert.equal(typeof table[key], "string", file + " " + key);
      assert.ok(table[key].trim(), file + " " + key);
      if (file !== "en.json" && key !== "threadActions.staff") {
        assert.notEqual(table[key], en[key], file + " " + key + " is translated");
      }
    }
  }
});
