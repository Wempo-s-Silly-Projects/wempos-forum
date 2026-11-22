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

// v5.60 (POLISH, feature freeze): an a11y + performance pass over the pages
// v5.55-v5.58 reorganized (thread More/Staff, settings hub, header Browse and
// Account menus, the phone bar). Each fix is pinned here, RED first:
//   1. phones reach the SAME language picker the header has (More menu);
//   2. a menu entry for the page you are on reads aria-current="page";
//   3. an open nav menu closes when keyboard focus leaves it, so its
//      overlay never hides the focused control (WCAG 2.4.11);
//   4. menu panel edges and small targets: border >= 3:1 in every theme,
//      the shortcut-sheet summary and language select get real targets;
//   5. the guest settings prompt starts the page outline at h1;
//   6. perf: a re-render with unchanged inputs (every action on a thread
//      re-renders the route) reuses the nav instead of rebuilding it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";
import { bestOf } from "./helpers/timing.mjs";

const accountActions = new FakeNode("nav");
const mobileBar = new FakeNode("nav");
const counts = { nodes: 0, listeners: 0 };
const baseDocument = makeFakeDocument();
const originalAdd = FakeNode.prototype.addEventListener;
FakeNode.prototype.addEventListener = function countedAdd(...args) {
  counts.listeners += 1;
  return originalAdd.apply(this, args);
};
globalThis.document = {
  ...baseDocument,
  createElement: (tag) => { counts.nodes += 1; return baseDocument.createElement(tag); },
  createElementNS: (ns, tag) => { counts.nodes += 1; return baseDocument.createElementNS(ns, tag); },
  querySelector: (selector) => {
    if (selector === "#account-actions") return accountActions;
    if (selector === ".mobile-bar") return mobileBar;
    return new FakeNode("div");
  },
  querySelectorAll: () => [],
};
globalThis.location = { origin: "https://wempos-forum.com", pathname: "/", search: "" };
globalThis.window = { location: globalThis.location };

const { renderAccountNavigation } = await import("../public/js/routes/account-nav.js");
const { LOCALES } = await import("../public/js/i18n.js");
const { createSettingsSignIn } = await import("../public/js/settings-groups.js");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const GUEST = null;
const MEMBER = { id: 3, username: "alice", role: "member" };
const STAFF = { id: 1, username: "boss", role: "admin" };
const ROLES = [["guest", GUEST], ["member", MEMBER], ["staff", STAFF]];
let unreadSeed = 100;
// A distinct unread count forces a fresh build (the perf memo keys on it).
const freshRender = (user) => renderAccountNavigation(user, (unreadSeed += 1));
const moreOf = () => mobileBar.children[mobileBar.children.length - 1];
const panelOf = (wrap) => wrap.querySelector(".nav-menu-panel");
const toggleOf = (wrap) => wrap.querySelector(".nav-menu-toggle");
const hrefOf = (node) => node.getAttribute?.("href") ?? node.href;
const optionValues = (root) => Array.from(root.querySelectorAll("option")).map((option) => option.value);

// ------------------------------------------------ 1. phone language picker

test("phone bar: More holds the same language picker the header has, for every role", () => {
  for (const [label, user] of ROLES) {
    freshRender(user);
    const headerPicker = accountActions.querySelector("label.language-picker");
    const phonePicker = panelOf(moreOf()).querySelector("label.language-picker");
    assert.ok(headerPicker, `${label}: header picker`);
    assert.ok(phonePicker, `${label}: phone picker in More`);
    const select = phonePicker.querySelector("select");
    assert.equal(select.name, "language");
    assert.equal(select.title, "language.label", "the existing label, no new string");
    assert.deepEqual(optionValues(select), LOCALES.map((locale) => locale.code));
    assert.deepEqual(optionValues(select), optionValues(headerPicker));
    assert.equal((select.listeners.change ?? []).length, 1, "wired by createLanguagePicker itself");
    // It sits last, in its own labelled group, after Browse (and Account).
    const groups = Array.from(panelOf(moreOf()).children);
    const last = groups[groups.length - 1];
    assert.equal(last.getAttribute("role"), "group");
    assert.ok(last.contains(phonePicker));
    const heading = last.querySelector("span.nav-group-label");
    assert.equal(last.getAttribute("aria-labelledby"), heading.id);
    assert.equal(heading.textContent, "language.label");
  }
});

test("account-nav reuses createLanguagePicker for the phone bar (no second picker)", () => {
  const nav = read("public/js/routes/account-nav.js");
  assert.equal((nav.match(/createLanguagePicker\(document\)/g) ?? []).length, 2);
  assert.doesNotMatch(nav, /createElement\("select"\)/);
});

// --------------------------------------------- 2. aria-current inside menus

test("a menu entry for the current page reads aria-current=page, in Browse and the phone More", () => {
  globalThis.location.pathname = "/archive";
  try {
    freshRender(MEMBER);
    for (const panel of [panelOf(accountActions.querySelector(".nav-browse")), panelOf(moreOf())]) {
      const current = Array.from(panel.querySelectorAll("a"))
        .filter((link) => link.getAttribute("aria-current") === "page");
      assert.deepEqual(current.map(hrefOf), ["/archive"]);
    }
  } finally {
    globalThis.location.pathname = "/";
  }
  freshRender(MEMBER);
  assert.equal(accountActions.querySelectorAll("a[aria-current]").length, 0, "home: no menu entry is current");
});

// ------------------------------------------ 3. focus leaving closes a menu

test("an open nav menu closes when focus moves outside it, and stays open while focus is inside", () => {
  freshRender(STAFF);
  const menus = [accountActions.querySelector(".nav-browse"), accountActions.querySelector(".nav-account"), moreOf()];
  const outside = new FakeNode("a");
  for (const menu of menus) {
    const toggle = toggleOf(menu);
    const panel = panelOf(menu);
    toggle.dispatch("click");
    assert.equal(panel.hidden, false);
    menu.dispatch("focusout", { relatedTarget: panel.querySelector("a") ?? toggle });
    assert.equal(panel.hidden, false, "focus still inside: stays open");
    menu.dispatch("focusout", { relatedTarget: null });
    assert.equal(panel.hidden, false, "no new focus target (a click elsewhere handles itself)");
    menu.dispatch("focusout", { relatedTarget: outside });
    assert.equal(panel.hidden, true, "focus left: closed");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
  }
});

// ------------------------------------------- 4. contrast and target sizes

const channel = (hex, at) => parseInt(hex.slice(at, at + 2), 16) / 255;
const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((at) => linear(channel(hex, at)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("nav menu panels: the edge reads >= 3:1 against the panel in light, dark and high contrast", () => {
  const css = read("public/styles.css");
  const rule = /\.nav-menu-panel \{([^}]*)\}/.exec(css)[1];
  const token = /border:\s*2px solid var\(--([\w-]+)\)/.exec(rule)[1];
  const blocks = [
    /:root \{([^}]*)\}/, /:root\[data-theme="dark"\] \{([^}]*)\}/,
    /:root\.high-contrast \{([^}]*)\}/, /:root\.high-contrast\[data-theme="dark"\] \{([^}]*)\}/,
  ].map((pattern) => pattern.exec(css)[1]);
  for (const block of blocks) {
    const value = (name) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)[1];
    const ratio = contrast(value(token), value("paper"));
    assert.ok(ratio >= 3, `--${token} on --paper: ${ratio.toFixed(2)}`);
  }
});

test("nav menu targets: shortcut-sheet summary >= 24px everywhere and 44px on phones; picker fills the panel", () => {
  const css = read("public/styles.css");
  const phone = read("public/responsive.css");
  assert.match(css, /\.nav-menu-panel \.shortcut-sheet > summary \{[^}]*min-height: 1\.5rem/);
  assert.match(phone, /\.mobile-bar \.nav-menu-panel \.shortcut-sheet > summary \{[^}]*min-height: 2\.75rem/);
  assert.match(css, /\.nav-menu-panel \.language-picker select \{[^}]*width: 100%/);
  assert.match(css, /\.nav-menu-item\[aria-current="page"\] \{[^}]*font-weight: 700[^}]*text-decoration: underline/,
    "current entry marked by weight + underline, not colour alone");
});

test("styles added since v5.55 add no motion (reduced motion stays respected)", () => {
  const css = read("public/styles.css");
  const at = css.indexOf("Thread page declutter (v5.55");
  assert.ok(at > 0);
  assert.doesNotMatch(css.slice(at), /transition|animation|@keyframes/);
});

// ------------------------------------------------ 5. settings guest prompt

test("guest settings prompt: the page outline starts at h1", () => {
  const prompt = createSettingsSignIn(makeFakeDocument(), "https://accounts.example/sign-in");
  assert.equal(prompt.querySelector("h1")?.textContent, "settings.title");
  assert.equal(prompt.querySelector("h2"), null);
});

// ---------------------------------------------------------------- 6. perf

test("perf: re-rendering the nav with unchanged inputs creates no nodes and no listeners", () => {
  for (const [label, user] of ROLES) {
    renderAccountNavigation(user, 7);
    const firstHeader = accountActions.children[0];
    const firstBar = mobileBar.children[0];
    counts.nodes = 0;
    counts.listeners = 0;
    renderAccountNavigation(user, 7);
    assert.equal(counts.nodes, 0, `${label}: nodes on an unchanged re-render`);
    assert.equal(counts.listeners, 0, `${label}: listeners on an unchanged re-render`);
    assert.equal(accountActions.children[0], firstHeader);
    assert.equal(mobileBar.children[0], firstBar);
  }
});

test("perf: any input change (user, unread, page, open menu, replaced header) still rebuilds", () => {
  renderAccountNavigation(MEMBER, 7);
  const built = () => accountActions.children[0];
  let before = built();
  renderAccountNavigation(MEMBER, 8);
  assert.notEqual(built(), before, "unread changed");
  before = built();
  renderAccountNavigation(STAFF, 8);
  assert.notEqual(built(), before, "user changed");
  before = built();
  globalThis.location.search = "?settings";
  try {
    renderAccountNavigation(STAFF, 8);
    assert.notEqual(built(), before, "page changed");
  } finally {
    globalThis.location.search = "";
  }
  renderAccountNavigation(STAFF, 8);
  before = built();
  toggleOf(before).dispatch("click");
  renderAccountNavigation(STAFF, 8);
  assert.notEqual(built(), before, "an open menu: rebuilt closed, as before");
  assert.equal(panelOf(built()).hidden, true);
  accountActions.replaceChildren();
  renderAccountNavigation(STAFF, 8);
  assert.ok(accountActions.children.length > 0, "a replaced header is rebuilt");
});

test("perf timing: an unchanged re-render costs well under a full build (best of N)", () => {
  const REPEAT = 200;
  const rerender = bestOf(() => {
    for (let i = 0; i < REPEAT; i += 1) renderAccountNavigation(STAFF, 9);
  });
  const rebuild = bestOf(() => {
    for (let i = 0; i < REPEAT; i += 1) renderAccountNavigation(STAFF, 10 + (i % 2));
  });
  assert.ok(rerender * 3 < rebuild, `re-render ${rerender.toFixed(2)}ms vs rebuild ${rebuild.toFixed(2)}ms per ${REPEAT}`);
});
