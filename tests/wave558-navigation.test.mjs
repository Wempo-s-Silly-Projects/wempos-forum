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

// v5.58 (ORGANIZE #3, feature freeze): the header's section links fold into
// one Browse menu, the account links into one Account menu, and the phone
// bar is drawn from the SAME list (nav-items.js) so the two never drift.
// Nothing is removed: every destination the header or the phone bar had is
// still reachable by the same accessible name, for guests, members and staff.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const accountActions = new FakeNode("nav");
const mobileBar = new FakeNode("nav");
globalThis.document = {
  ...makeFakeDocument(),
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
const { NAV_ITEMS, HEADER_ITEM_LIMIT, MOBILE_BAR_LIMIT, navItemsFor } = await import("../public/js/nav-items.js");
const { wempoAccountsSignInUrl } = await import("../public/js/sso.js");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const en = JSON.parse(read("public/locales/en.json"));

const GUEST = null;
const MEMBER = { id: 3, username: "alice", role: "member" };
const STAFF = { id: 1, username: "boss", role: "admin" };
const ROLES = [["guest", GUEST], ["member", MEMBER], ["staff", STAFF]];

// Without a loaded locale t() returns the key; English names come from en.json.
const english = (name) => en[name] ?? name;
const accessibleName = (node) => {
  if (node.tagName === "DETAILS") return node.querySelector("summary")?.textContent.trim() ?? "";
  return String(node.getAttribute("aria-label") || node.textContent).trim();
};
const hrefOf = (node) => node.getAttribute?.("href") ?? node.href;
const controlsOf = (root) => Array.from(root.querySelectorAll("a, button, details, select"));
const namesOf = (root) => controlsOf(root).map(accessibleName).map(english);

// A destination: a link's href, an action button's action, or a sheet.
function destinations(root) {
  const set = new Set();
  for (const node of controlsOf(root)) {
    if (node.tagName === "A") set.add(hrefOf(node));
    else if (node.tagName === "BUTTON" && node.dataset.action) set.add("action:" + node.dataset.action);
    else if (node.tagName === "DETAILS") set.add("sheet:" + node.className);
  }
  return set;
}

const render = (user) => renderAccountNavigation(user, 0);
const headerDestinations = () => new Set(["/", ...destinations(accountActions)]); // "/" is the brand link
const browseWrap = (root) => root.querySelector(".nav-browse");
const toggleOf = (wrap) => wrap.querySelector(".nav-menu-toggle");
const panelOf = (wrap) => wrap.querySelector(".nav-menu-panel");
const BROWSE_HREFS = ["/suggestions", "/archive", "/leaderboard", "/rules", "/week"];

// ----------------------------------------------------------- the header

test("header: at most seven top-level items for guests, members and staff", () => {
  assert.equal(HEADER_ITEM_LIMIT, 7);
  for (const [label, user] of ROLES) {
    render(user);
    assert.ok(accountActions.children.length <= HEADER_ITEM_LIMIT, `${label}: ${accountActions.children.length}`);
  }
  render(MEMBER);
  assert.deepEqual(Array.from(accountActions.children).map((node) =>
    node.getAttribute("aria-label") || node.className),
  ["nav-menu nav-browse", "nav.savedPosts", "feed.myPosts", "settings.title", "bell.label",
    "nav-menu nav-account", "language-picker"]);
  render(GUEST);
  assert.deepEqual(Array.from(accountActions.children).map((node) => node.className.split(" ").at(-1)),
    ["nav-browse", "button-secondary", "language-picker"]);
});

test("Browse groups Suggestions, Archive, Leaderboard, Rules and This week behind one menu button", () => {
  for (const [label, user] of ROLES) {
    render(user);
    const wrap = browseWrap(accountActions);
    assert.ok(wrap, label);
    const toggle = toggleOf(wrap);
    const panel = panelOf(wrap);
    assert.equal(toggle.tagName, "BUTTON");
    assert.equal(toggle.type, "button");
    assert.equal(english(accessibleName(toggle)), "Browse");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.ok(panel.id);
    assert.equal(toggle.getAttribute("aria-controls"), panel.id);
    assert.equal(panel.hidden, true, "closed by default");
    assert.deepEqual(Array.from(panel.querySelectorAll("a")).map(hrefOf), BROWSE_HREFS);
    for (const link of panel.querySelectorAll("a")) assert.ok(link.hasAttribute("data-app-link"), "in-app link");
    // No section link is left loose in the header.
    for (const node of accountActions.children) {
      if (node === wrap) continue;
      assert.ok(!BROWSE_HREFS.includes(hrefOf(node)), "loose " + hrefOf(node));
    }
  }
});

test("menus open on click, and Escape closes them and returns focus to the button", () => {
  render(STAFF);
  for (const wrap of [browseWrap(accountActions), accountActions.querySelector(".nav-account")]) {
    const toggle = toggleOf(wrap);
    const panel = panelOf(wrap);
    toggle.dispatch("click");
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(panel.hidden, false);
    let stopped = false;
    wrap.dispatch("keydown", { key: "Escape", preventDefault() {}, stopPropagation() { stopped = true; } });
    assert.equal(panel.hidden, true);
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(toggle.ownerFocused, true, "focus back on the menu button");
    assert.equal(stopped, true);
  }
});

test("Account menu: profile, keyboard shortcuts and sign out (plus the desk for staff)", () => {
  render(MEMBER);
  const account = accountActions.querySelector(".nav-account");
  assert.equal(english(accessibleName(toggleOf(account))), "Account");
  const panel = panelOf(account);
  assert.deepEqual([...destinations(panel)],
    ["/users/alice", "sheet:shortcut-sheet", "action:logout"]);
  assert.equal(english(accessibleName(panel.querySelector("details"))), "Keyboard shortcuts");
  render(STAFF);
  assert.deepEqual([...destinations(panelOf(accountActions.querySelector(".nav-account")))],
    ["/users/boss", "/admin", "sheet:shortcut-sheet", "action:logout"]);
  render(GUEST);
  assert.equal(accountActions.querySelector(".nav-account"), null, "guests have no account menu");
});

// ----------------------------------------------------------- the phone bar

test("phone bar: at most five items, the last a More menu holding the same Browse grouping", () => {
  assert.equal(MOBILE_BAR_LIMIT, 5);
  for (const [label, user] of ROLES) {
    render(user);
    assert.ok(mobileBar.children.length <= MOBILE_BAR_LIMIT, `${label}: ${mobileBar.children.length}`);
    const more = mobileBar.children[mobileBar.children.length - 1];
    assert.match(more.className, /nav-mobile-more/, label);
    const toggle = toggleOf(more);
    assert.equal(english(accessibleName(toggle)), "More");
    assert.equal(toggle.getAttribute("aria-controls"), panelOf(more).id);
    assert.equal(panelOf(more).hidden, true);
    const browse = panelOf(more).querySelector(".nav-group-browse");
    assert.deepEqual(Array.from(browse.querySelectorAll("a")).map(hrefOf), BROWSE_HREFS);
    // Same labels as the header's Browse menu.
    const headerBrowse = panelOf(browseWrap(accountActions));
    assert.deepEqual(namesOf(browse), namesOf(headerBrowse));
  }
  render(MEMBER);
  assert.deepEqual(Array.from(mobileBar.children).slice(0, 4).map(hrefOf),
    ["/", "/mine", "/notifications", "/users/alice"]);
  render(GUEST);
  assert.deepEqual(Array.from(mobileBar.children).slice(0, 4).map(hrefOf),
    ["/", "/mine", "/notifications", wempoAccountsSignInUrl(globalThis.location.origin)]);
});

test("parity: the phone bar and the header reach the same destinations", () => {
  for (const [label, user] of [["member", MEMBER], ["staff", STAFF]]) {
    render(user);
    assert.deepEqual([...destinations(mobileBar)].sort(), [...headerDestinations()].sort(), label);
  }
  // Guests: the bar keeps My posts and Alerts (each a sign-in prompt for a
  // guest) as it always has; everything in the header is on the bar too.
  render(GUEST);
  const header = headerDestinations();
  const bar = destinations(mobileBar);
  for (const href of header) assert.ok(bar.has(href), "guest bar lacks " + href);
  assert.deepEqual([...bar].filter((href) => !header.has(href)).sort(), ["/mine", "/notifications"]);
});

test("both renderers draw from the one list in nav-items.js", () => {
  assert.ok(NAV_ITEMS.length > 0 && Object.isFrozen(NAV_ITEMS));
  for (const item of NAV_ITEMS) {
    assert.ok(["brand", "direct", "browse", "account"].includes(item.header), item.id);
    assert.ok(["bar", "more"].includes(item.mobile), item.id);
  }
  assert.deepEqual(navItemsFor("guest", "header").filter((item) => item.header === "browse").map((item) => item.href),
    BROWSE_HREFS);
  assert.deepEqual(navItemsFor("member", "mobile").filter((item) => item.mobile === "bar").map((item) => item.id),
    ["home", "mine", "notifications", "profile"]);
  const nav = read("public/js/routes/account-nav.js");
  assert.match(nav, /navItemsFor\(role, "header"\)/);
  assert.match(nav, /navItemsFor\(role, "mobile"\)/);
  // No hand-written section link is left in the renderer.
  for (const href of BROWSE_HREFS) assert.doesNotMatch(nav, new RegExp(`"${href}"`), href);
  const html = read("public/index.html");
  // v5.63 (L9): the only hand-written bar markup is the guest-safe Home + Sign in
  // fallback (pinned in wave563-mobile-bar-fallback); every other item is drawn
  // from the list.
  const bar = html.match(/<nav class="mobile-bar"[^>]*>([\s\S]*?)<\/nav>/)[1].replace(/<!--[\s\S]*?-->/g, "");
  assert.deepEqual([...bar.matchAll(/data-nav-fallback="([^"]+)"/g)].map((m) => m[1]), ["home", "signin"],
    "the bar is drawn from the list, not hand-written, apart from the guest fallback");
  assert.equal((bar.match(/<a\b/g) || []).length, 2);
  assert.match(html, /<link rel="modulepreload" href="\/js\/nav-items\.js">/);
  const module = read("public/js/nav-items.js");
  assert.doesNotMatch(module, /localStorage|sessionStorage|indexedDB|\bapi\(|fetch\(/);
  for (const path of ["public/js/nav-items.js", "public/js/routes/account-nav.js"]) {
    assert.doesNotMatch(read(path), /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|DOMParser/, path);
  }
});

test("the phone bar marks the current page and swaps Sign in for Profile", () => {
  globalThis.location.pathname = "/mine";
  render(MEMBER);
  const current = Array.from(mobileBar.children).filter((node) => node.getAttribute("aria-current") === "page");
  assert.deepEqual(current.map(hrefOf), ["/mine"]);
  globalThis.location.pathname = "/users/alice";
  render(MEMBER);
  const profile = Array.from(mobileBar.children).find((node) => node.id === "mobile-profile");
  assert.equal(profile.getAttribute("aria-current"), "page");
  render(GUEST);
  assert.ok(Array.from(mobileBar.children).some((node) => node.id === "mobile-signin"));
  globalThis.location.pathname = "/";
});

// ------------------------------------------- nothing removed (by accessible name)

const FORMER_HEADER = {
  guest: ["nav.suggestions", "nav.archive", "nav.leaderboard", "nav.rules", "common.signIn"],
  member: ["nav.suggestions", "nav.archive", "nav.leaderboard", "nav.rules", "nav.profileOf", "nav.savedPosts",
    "feed.myPosts", "settings.title", "bell.label", "common.signOut"],
  staff: ["nav.suggestions", "nav.archive", "nav.leaderboard", "nav.rules", "nav.profileOf", "nav.savedPosts",
    "feed.myPosts", "settings.title", "bell.label", "nav.moderationDesk", "common.signOut"],
};
const FORMER_MOBILE = {
  guest: ["shell.home", "shell.myPosts", "shell.suggestions", "shell.notifications", "shell.signIn"],
  member: ["shell.home", "shell.myPosts", "shell.suggestions", "shell.notifications", "common.profile"],
  staff: ["shell.home", "shell.myPosts", "shell.suggestions", "shell.notifications", "common.profile"],
};

test("every former header destination is still in the header, by accessible name", () => {
  for (const [label, user] of ROLES) {
    render(user);
    const names = namesOf(accountActions);
    for (const key of FORMER_HEADER[label]) assert.ok(names.includes(en[key]), `${label}: ${en[key]}`);
    assert.ok(accountActions.querySelector("select"), `${label}: language picker`);
  }
});

test("every former phone-bar destination is still on the phone bar, by accessible name", () => {
  for (const [label, user] of ROLES) {
    render(user);
    const names = namesOf(mobileBar);
    for (const key of FORMER_MOBILE[label]) assert.ok(names.includes(en[key]), `${label}: ${en[key]}`);
  }
});

// ----------------------------------------------------------- strings

test("new menu strings exist in en and all 41 locales, translated", () => {
  const files = readdirSync(new URL("../public/locales/", import.meta.url)).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 41);
  for (const file of files) {
    const table = JSON.parse(read("public/locales/" + file));
    for (const key of ["nav.browse", "nav.account", "nav.more"]) {
      assert.equal(typeof table[key], "string", file + " " + key);
      assert.ok(table[key].trim(), file + " " + key);
      if (file !== "en.json") assert.notEqual(table[key], en[key], file + " " + key + " is translated");
    }
  }
});
