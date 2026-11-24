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

// v5.96.0 Part A (WCAG 2.2 AA audit, 2026-11-24): author-name contrast,
// attachment button box, edit-history target size, Who's Online heading
// name, focus not obscured by the chat launcher, and More-menu ARIA.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeFakeDocument } from "./helpers/fake-dom.mjs";

globalThis.speechSynthesis ??= { speak() {}, cancel() {}, getVoices: () => [] };
globalThis.SpeechSynthesisUtterance ??= function Utterance() {};

const { createPostCard } = await import("../public/js/render.js");
const { organizePostActions } = await import("../public/js/post-more.js");
const { PROFILE_ACCENT_PRESETS } = await import("../public/js/profile-editor.js");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const CSS = read("public/styles.css");
const doc = makeFakeDocument();
const AA_TEXT = 4.5;

// A rule's declaration block for an exact selector list (first match).
function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const match = css.match(new RegExp("(?:^|\\})\\s*" + escaped + "\\s*\\{([^}]*)\\}", "m"));
  return match ? match[1] : null;
}

const channel = (value) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// Every value a token takes, in source order: light first, then dark.
const tokenValues = (name) => [...CSS.matchAll(new RegExp("--" + name + ":\\s*(#[0-9a-fA-F]{6})", "g"))].map((m) => m[1]);

function rootPost(overrides = {}) {
  return {
    id: 12, body: "thread root", parent: null, visibility: "public", board: "general",
    createdAt: "2026-11-22T10:00:00.000Z", author: { id: 9, username: "alice", role: null, avatarUrl: null, flair: "builder" },
    likeCount: 1, dislikeCount: 0, viewerReaction: null, viewCount: 4, replyCount: 2, subReplyCount: 0,
    pinnedAt: null, staffPick: false, locked: false, subscribed: false, viewerMuted: false,
    viewerBookmarked: true, ...overrides,
  };
}

// --- A1 author-name contrast ------------------------------------------------

test("A1: author names and flairs never take the profile accent as text colour", () => {
  for (const css of [CSS, read("public/responsive.css")]) {
    assert.doesNotMatch(css, /(?:^|[;{\s])color:\s*var\(--profile-accent/m, "accent must not colour text");
  }
  assert.match(ruleBody(CSS, ".post-card .author-name") ?? "", /color:\s*var\(--ink\)/);
  assert.match(ruleBody(CSS, ".post-card .author-name") ?? "", /text-decoration-color:\s*var\(--profile-accent\)/);
  assert.match(CSS, /\.profile-section \.author-name,\s*\.profile-section \.profile-name\s*\{[^}]*color:\s*var\(--ink\)/);
});

test("A1: ink on paper clears 4.5:1 in both themes, so every preset accent reads", () => {
  const inks = tokenValues("ink");
  const papers = tokenValues("paper");
  assert.ok(inks.length >= 2 && papers.length >= 2, "light and dark tokens");
  for (const [index, ink] of inks.slice(0, 2).entries()) {
    assert.ok(contrast(ink, papers[index]) >= AA_TEXT, `theme ${index}: ${ink} on ${papers[index]}`);
  }
  // The name colour no longer depends on the accent at all: every preset
  // still exists (the picker stays), it just stops painting text.
  assert.ok(PROFILE_ACCENT_PRESETS.filter((preset) => preset.hex).length >= 7);
  const card = createPostCard(rootPost(), doc);
  assert.equal(card.querySelector(".author-name").getAttribute("style"), null, "no inline colour on the name");
});

// --- A2 collapsed attachment button -----------------------------------------

test("A2: the attachment button has a minimum box and a placeholder until the image loads", () => {
  const body = ruleBody(CSS, ".attachment-expand") ?? "";
  assert.match(body, /min-width:\s*3rem/);
  assert.match(body, /min-height:\s*3rem/);
  const placeholder = CSS.match(/\.attachment-expand\.attachment-loading\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(placeholder, /background/);
  assert.doesNotMatch(placeholder, /(?:^|[\s;])(?:border(?!-radius)|padding|margin)(?:-[a-z]+)?\s*:/, "no box change, so no layout shift on load");
});

test("A2: a dimensionless image loads eagerly (a 0x0 lazy image never intersects) and drops the placeholder on load", () => {
  const card = createPostCard(rootPost({ attachments: [{ id: 5, mime: "image/png" }] }), doc);
  const expand = card.querySelector("button.attachment-expand");
  const img = expand.querySelector("img");
  assert.equal(img.loading, "eager");
  assert.ok(expand.classList.contains("attachment-loading"));
  img.dispatch("load", {});
  assert.ok(!expand.classList.contains("attachment-loading"));
  const sized = createPostCard(rootPost({ attachments: [{ id: 6, mime: "image/png", width: 640, height: 480 }] }), doc);
  assert.equal(sized.querySelector("button.attachment-expand").querySelector("img").loading, "lazy");
});

// --- A3 edit history target size --------------------------------------------

test("A3: the edit history toggle is at least 24px tall", () => {
  assert.match(ruleBody(CSS, ".post-edited-history") ?? "", /min-height:\s*24px/);
});

// --- A4 Who's Online heading ------------------------------------------------

test("A4: the Who's Online heading names its count instead of reading 'Who's Online0'", () => {
  const source = read("public/js/who-online.js");
  assert.match(source, /t\("online\.headingWithCount",\s*\{\s*count/);
  assert.match(source, /countEl\.setAttribute\("aria-hidden",\s*"true"\)/);
  const en = JSON.parse(read("public/locales/en.json"));
  assert.match(en["online.headingWithCount"], /\{count\}/);
});

// --- A5 focus not obscured --------------------------------------------------

test("A5: scroll padding keeps a focused control clear of the fixed chat launcher", () => {
  const html = ruleBody(CSS, "html") ?? "";
  assert.match(html, /scroll-padding-bottom:\s*calc\(52px \+ 1\.5rem \+ env\(safe-area-inset-bottom/);
});

// --- A6 menu ARIA -----------------------------------------------------------

test("A6: toggles in the More menu are menuitemcheckbox + aria-checked, never aria-pressed", () => {
  for (const viewer of [null, { id: 9, username: "alice" }, { id: 1, username: "boss", role: "owner" }]) {
    const card = createPostCard(rootPost(), doc, viewer);
    organizePostActions(doc, card);
    const menu = card.querySelector(".post-more-menu");
    assert.equal(menu.querySelectorAll("[aria-pressed]").length, 0, "no aria-pressed inside role=menu");
    const bookmark = menu.querySelector(".bookmark-toggle");
    if (bookmark) {
      assert.equal(bookmark.getAttribute("role"), "menuitemcheckbox");
      assert.equal(bookmark.getAttribute("aria-checked"), "true");
      assert.equal(bookmark.dataset.bookmarked, "1");
    }
    const readAloud = menu.querySelector(".read-aloud-button");
    assert.ok(readAloud, "read aloud sits in the menu");
    assert.equal(readAloud.getAttribute("role"), "menuitemcheckbox");
    assert.equal(readAloud.getAttribute("aria-checked"), "false");
  }
});

test("A6: the bookmark action and read aloud no longer read aria-pressed for their state", () => {
  assert.match(read("public/js/routes/feed.js"), /const bookmarked = button\.dataset\.bookmarked === "1";/);
  const source = read("public/js/read-aloud.js");
  assert.match(source, /menuitemcheckbox/);
  assert.match(source, /isPressed\(button\)/);
});
