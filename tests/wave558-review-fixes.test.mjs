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

// v5.58: the thread page's duplicate entry points (ia-map §5.1, §5.2) and the
// two LOW findings of the v5.57 review (docs/security-reviews/
// 2026-11-22-v5.53-v5.56.md): L4 flat settings headings, L5 focus lost after
// an action inside the thread's More menu.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

globalThis.speechSynthesis ??= { speak() {}, cancel() {}, getVoices: () => [] };
globalThis.SpeechSynthesisUtterance ??= function Utterance() {};

const { createPostCard } = await import("../public/js/render.js");
const { createShareButton, shareMenuOffersCopyLink } = await import("../public/js/share.js");
const { createSlowModeForm } = await import("../public/js/slow-mode.js");
const {
  organizeThreadActions, captureMoreFocus, restoreMoreFocus,
} = await import("../public/js/thread-actions.js");
const { buildSettingsHub } = await import("../public/js/settings-groups.js");
const { t } = await import("../public/js/i18n.js");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const doc = makeFakeDocument();
const OWNER = { id: 1, username: "boss", role: "owner" };
const MEMBER = { id: 3, username: "bob", role: null };

function rootPost(overrides = {}) {
  return {
    id: 12, body: "thread root", parent: null, visibility: "public", board: "showcase",
    createdAt: "2026-11-22T10:00:00.000Z", author: { id: 9, username: "alice", role: null, avatarUrl: null },
    likeCount: 1, dislikeCount: 0, viewerReaction: null, viewCount: 4, replyCount: 2, subReplyCount: 0,
    pinnedAt: null, staffPick: false, locked: false, subscribed: false, viewerMuted: false,
    viewerBookmarked: false, ...overrides,
  };
}

const nameOf = (node) => String(node.getAttribute("aria-label") || node.textContent).trim();
const named = (root, name) => Array.from(root.querySelectorAll("button, a")).filter((node) => nameOf(node) === name);
const share = (navigator) => createShareButton(doc, rootPost(), MEMBER,
  { origin: "https://wempos-forum.com", navigator, storage: null, clipboard: null });

// ------------------------------------------------------- duplicate copy link

test("shareMenuOffersCopyLink: the Share menu (with its Copy link) is the path only without a share sheet", () => {
  assert.equal(shareMenuOffersCopyLink({}), true);
  assert.equal(shareMenuOffersCopyLink(null), true);
  assert.equal(shareMenuOffersCopyLink({ share() {} }), false);
});

test("thread page: one visible Copy link — inside Share when its menu has one, else inside More", () => {
  // No device share sheet: Share opens its own menu, which has Copy link.
  const withMenu = createPostCard(rootPost(), doc, MEMBER);
  const menuShare = share({});
  organizeThreadActions(doc, withMenu, {
    postId: 12, share: menuShare, currentPath: "/posts/12", shareHasCopyLink: shareMenuOffersCopyLink({}),
  });
  const copies = named(withMenu, t("render.copyLink"));
  assert.equal(copies.length, 1, "one Copy link");
  assert.ok(withMenu.querySelector(".share-menu").contains(copies[0]), "the one inside Share");
  assert.equal(withMenu.querySelector(".copy-link-wrap"), null);

  // A device share sheet: Share never shows its menu, so More keeps Copy link.
  const withSheet = createPostCard(rootPost(), doc, MEMBER);
  organizeThreadActions(doc, withSheet, {
    postId: 12, share: share({ share() {} }), currentPath: "/posts/12", shareHasCopyLink: false,
  });
  const more = withSheet.querySelector(".thread-more-panel");
  assert.equal(named(more, t("render.copyLink")).length, 1, "Copy link stays in More");

  // No Share at all (staff viewer): More keeps Copy link.
  const staff = createPostCard(rootPost(), doc, OWNER);
  organizeThreadActions(doc, staff, { postId: 12, share: null, currentPath: "/posts/12", shareHasCopyLink: false });
  assert.equal(named(staff.querySelector(".thread-more-panel"), t("render.copyLink")).length, 1);
});

test("thread page: the Open post link that points at this very page is hidden here only", () => {
  const card = createPostCard(rootPost(), doc, MEMBER);
  organizeThreadActions(doc, card, { postId: 12, currentPath: "/posts/12", shareHasCopyLink: false });
  assert.equal(named(card, t("render.openPost")).length, 0);
  // Anywhere else (a feed card, another page) the link stays.
  const elsewhere = createPostCard(rootPost(), doc, MEMBER);
  organizeThreadActions(doc, elsewhere, { postId: 12, currentPath: "/posts/99", shareHasCopyLink: false });
  assert.equal(named(elsewhere, t("render.openPost")).length, 1);
  assert.equal(named(createPostCard(rootPost(), doc, MEMBER), t("render.openPost")).length, 1, "feed card unchanged");
});

test("post.js passes the page path and the Share copy-link state", () => {
  const post = read("public/js/routes/post.js");
  assert.match(post, /currentPath: location\.pathname/);
  assert.match(post, /shareHasCopyLink: Boolean\(share\) && shareMenuOffersCopyLink\(\)/);
});

// ------------------------------------------------------------------- L5

// A page document whose getElementById searches the current card.
const pageWith = (holder) => ({
  ...makeFakeDocument(),
  getElementById: (id) => holder.card.querySelectorAll("div").values().find((node) => node.id === id) ?? null,
});
const buttonWith = (root, action) => Array.from(root.querySelectorAll("button")).find((node) => node.dataset.action === action);
const openMore = (card) => card.querySelector(".thread-more-toggle").dispatch("click");

test("L5: after an in-More action re-renders the page, More reopens and the same control has focus", () => {
  const holder = { card: createPostCard(rootPost(), doc, MEMBER) };
  organizeThreadActions(doc, holder.card, { postId: 12 });
  openMore(holder.card);
  const snapshot = captureMoreFocus(buttonWith(holder.card, "toggle-bookmark"));
  assert.ok(snapshot, "a control inside More is remembered");
  // The action re-renders the route: a brand-new card, More closed.
  holder.card = createPostCard(rootPost({ viewerBookmarked: true }), doc, MEMBER);
  organizeThreadActions(doc, holder.card, { postId: 12 });
  assert.equal(holder.card.querySelector(".thread-more-panel").hidden, true);
  restoreMoreFocus(pageWith(holder), snapshot);
  const toggle = holder.card.querySelector(".thread-more-toggle");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(holder.card.querySelector(".thread-more-panel").hidden, false);
  assert.equal(buttonWith(holder.card, "toggle-bookmark").ownerFocused, true, "focus on the acted-on control");
});

test("L5: inside the Staff submenu both menus reopen; a control that is gone hands focus to More", () => {
  const holder = { card: createPostCard(rootPost(), doc, OWNER) };
  organizeThreadActions(doc, holder.card, { postId: 12, staffForms: [createSlowModeForm(doc, 12, null)] });
  const snapshot = captureMoreFocus(buttonWith(holder.card, "thread-pin"));
  // After pinning, the button is Unpin: same slot, different action.
  holder.card = createPostCard(rootPost({ pinnedAt: "2026-11-22T11:00:00.000Z" }), doc, OWNER);
  organizeThreadActions(doc, holder.card, { postId: 12, staffForms: [createSlowModeForm(doc, 12, null)] });
  restoreMoreFocus(pageWith(holder), snapshot);
  assert.equal(holder.card.querySelector(".thread-more-panel").hidden, false);
  assert.equal(holder.card.querySelector(".thread-staff-panel").hidden, false);
  assert.equal(holder.card.querySelector(".thread-staff-toggle").getAttribute("aria-expanded"), "true");
  const focused = Array.from(holder.card.querySelectorAll("button")).filter((node) => node.ownerFocused);
  assert.deepEqual(focused.map((node) => node.dataset.action), ["thread-unpin"], "Pin became Unpin: focus follows");

  // The acted-on control no longer exists (a guest-shaped card has no Save
  // post): focus goes back to the More button, with More open.
  const gone = { card: createPostCard(rootPost(), doc, MEMBER) };
  organizeThreadActions(doc, gone.card, { postId: 12 });
  const lost = captureMoreFocus(buttonWith(gone.card, "toggle-bookmark"));
  gone.card = createPostCard(rootPost(), doc, null);
  organizeThreadActions(doc, gone.card, { postId: 12 });
  restoreMoreFocus(pageWith(gone), lost);
  assert.equal(gone.card.querySelector(".thread-more-toggle").ownerFocused, true);
  assert.equal(gone.card.querySelector(".thread-more-panel").hidden, false);
});

test("L5: an action that does not re-render (a dialog opens) leaves focus alone", () => {
  const holder = { card: createPostCard(rootPost(), doc, MEMBER) };
  organizeThreadActions(doc, holder.card, { postId: 12 });
  openMore(holder.card);
  const report = buttonWith(holder.card, "report");
  const snapshot = captureMoreFocus(report);
  restoreMoreFocus(pageWith(holder), snapshot);
  assert.equal(report.ownerFocused, undefined, "no focus steal from the dialog");
  assert.equal(holder.card.querySelector(".thread-more-toggle").ownerFocused, undefined);
  // A control outside More is not tracked at all.
  assert.equal(captureMoreFocus(buttonWith(holder.card, "reaction")), null);
  assert.doesNotThrow(() => restoreMoreFocus(pageWith(holder), null));
});

test("L5: the page's click handler remembers and restores around every action", () => {
  const app = read("public/js/app.js");
  assert.match(app, /import \{[^}]*captureMoreFocus[^}]*restoreMoreFocus[^}]*\} from "\.\/thread-actions\.js"/);
  assert.match(app, /const moreFocus = captureMoreFocus\(button\);/);
  assert.match(app, /finally \{\s*restoreMoreFocus\(document, moreFocus\);\s*\}/);
});

// ------------------------------------------------------------------- L4

const makePanel = (title) => {
  const panel = new FakeNode("section");
  panel.className = "panel";
  const heading = new FakeNode("h2");
  heading.textContent = title;
  panel.append(heading);
  return panel;
};

test("L4: in the settings hub, panel headings sit one level below their group heading", () => {
  const root = new FakeNode("div");
  const panels = ["feed.appearanceTitle", "quietHours.title", "blocks.title", "twofa.title"].map(makePanel);
  const groups = buildSettingsHub(doc, root, panels);
  for (const group of groups) {
    const heading = group.querySelector("h2.settings-group-title");
    assert.equal(heading.getAttribute("aria-level"), null, "group heading keeps its native level 2");
  }
  for (const panel of panels) {
    const heading = panel.querySelector("h2");
    // Still an H2 element: twofa.js and account-security.js keep finding it.
    assert.equal(heading.tagName, "H2");
    assert.equal(heading.getAttribute("aria-level"), "3", heading.textContent);
  }
});
