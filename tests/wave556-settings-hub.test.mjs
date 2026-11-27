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

// Wave 5.56 (ORGANIZE #2, feature freeze): the account settings hub. Settings
// used to be a collapsed <details> under the home feed with no nav entry; it
// is now its own view at /?settings (the home page that already hosted it),
// reached from the account menu, with its 14 panels split into 4 groups.
// Nothing new is stored and no panel's controls change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const accountActions = new FakeNode("div");
globalThis.document = {
  ...makeFakeDocument(),
  querySelector: (selector) => (selector === "#account-actions" ? accountActions : new FakeNode("div")),
  querySelectorAll: () => [],
};
globalThis.location = { origin: "https://wempos-forum.com", pathname: "/", search: "" };
globalThis.window = { location: globalThis.location };

const { routeForPath } = await import("../public/js/router.js");
const {
  SETTINGS_PATH, SETTINGS_GROUPS, settingsGroupFor, buildSettingsHub, syncSettingsGroups,
  createSettingsSignIn, createSettingsLinkPanel, groupedSettingsPanels,
} = await import("../public/js/settings-groups.js");
const { addSectionAnchors } = await import("../public/js/settings-tools.js");
const { renderAccountNavigation } = await import("../public/js/routes/account-nav.js");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const doc = makeFakeDocument();

// The 14 panels in the order renderAccountSettings builds them (backup codes
// only render while two-factor is on). Without a loaded locale t() returns the
// key, so each heading reads as its title key.
const PANEL_TITLES = [
  "feed.appearanceTitle", "quietHours.title", "notifPrefs.title",
  "newcomer.onboardSettingTitle", "feed.changePasswordTitle", "twofa.title", "twofa.backupTitle", "account.sessionsTitle",
  "blocks.title", "follow.title", "feed.presenceTitle", "settings.dataTitle",
  "invite.title", "feed.deleteAccountTitle",
];

const EXPECTED_GROUPS = {
  "settingsGroups.appearance": ["feed.appearanceTitle"],
  "settingsGroups.notifications": ["quietHours.title", "notifPrefs.title", "newcomer.onboardSettingTitle"],
  "settingsGroups.people": ["blocks.title", "follow.title", "feed.presenceTitle"],
  "settingsGroups.account": [
    "feed.changePasswordTitle", "twofa.title", "twofa.backupTitle", "account.sessionsTitle",
    "settings.dataTitle", "invite.title", "feed.deleteAccountTitle",
  ],
};

const makePanel = (title) => {
  const panel = new FakeNode("section");
  panel.className = "panel";
  const heading = new FakeNode("h2");
  heading.textContent = title;
  panel.append(heading);
  return panel;
};

const hubFixture = (titles = PANEL_TITLES) => {
  const root = new FakeNode("div");
  const panels = titles.map(makePanel);
  root.append(...panels);
  const groups = buildSettingsHub(doc, root, panels);
  return { root, panels, groups };
};

const groupHeadingText = (group) => group.querySelector("h2.settings-group-title").textContent;
const panelTitlesIn = (group) =>
  Array.from(group.querySelectorAll("section.panel")).map((panel) => panel.querySelector("h2").textContent);

test("/?settings is the settings view on the home page; a search or plain / keeps its route", () => {
  assert.equal(SETTINGS_PATH, "/?settings");
  const url = new URL(SETTINGS_PATH, "https://x.test");
  assert.deepEqual(routeForPath(url.pathname, url.search), { name: "settings" });
  assert.equal(routeForPath("/", "?q=cats&settings").name, "search");
  assert.deepEqual(routeForPath("/", ""), { name: "home" });
});

test("the 14 settings panels land in 4 labelled groups, in a fixed order", () => {
  const { root, groups } = hubFixture();
  assert.equal(groups.length, 4);
  assert.deepEqual(SETTINGS_GROUPS.map((group) => group.titleKey), Object.keys(EXPECTED_GROUPS));
  assert.deepEqual(Array.from(root.children), groups, "the groups replace the flat panel stack");
  for (const group of groups) {
    assert.equal(group.tagName, "SECTION");
    assert.match(group.className, /\bsettings-group\b/);
    const heading = group.querySelector("h2.settings-group-title");
    assert.ok(heading.id, "the group heading carries an id");
    assert.equal(group.getAttribute("aria-labelledby"), heading.id, "the group is a region named by its heading");
    assert.deepEqual(panelTitlesIn(group), EXPECTED_GROUPS[groupHeadingText(group)]);
  }
  const placed = groups.flatMap(panelTitlesIn);
  assert.equal(placed.length, 14);
  assert.deepEqual([...placed].sort(), [...PANEL_TITLES].sort(), "every panel placed exactly once");
});

test("a panel the map does not know still lands in the last group (nothing is lost)", () => {
  const { groups } = hubFixture([...PANEL_TITLES, "some.newPanel"]);
  assert.equal(panelTitlesIn(groups.at(-1)).at(-1), "some.newPanel");
  assert.equal(settingsGroupFor(makePanel("some.newPanel")), SETTINGS_GROUPS.at(-1).key);
  assert.equal(settingsGroupFor(makePanel("blocks.title")), "people");
});

test("a group whose panels are all filtered out hides with them", () => {
  const { groups } = hubFixture();
  for (const panel of groups[0].querySelectorAll("section.panel")) panel.hidden = true;
  syncSettingsGroups(groups);
  assert.deepEqual(groups.map((group) => group.hidden), [true, false, false, false]);
  for (const panel of groups[0].querySelectorAll("section.panel")) panel.hidden = false;
  syncSettingsGroups(groups);
  assert.deepEqual(groups.map((group) => group.hidden), [false, false, false, false]);
});

test("member: every settings panel is reachable by its accessible name from the hub's jump list", () => {
  const { root, panels, groups } = hubFixture();
  const nav = addSectionAnchors(doc, groupedSettingsPanels(groups));
  const names = Array.from(nav.querySelectorAll("button")).map((button) => button.textContent);
  assert.deepEqual(names, Object.values(EXPECTED_GROUPS).flat(), "jump list follows the on-screen group order");
  for (const title of PANEL_TITLES) {
    const panel = panels.find((candidate) => candidate.querySelector("h2").textContent === title);
    assert.ok(root.contains(panel), `${title} stays in the hub`);
    assert.ok(panel.closest("section.settings-group"), `${title} sits inside a group`);
  }
});

test("guest: the settings view is a sign-in prompt with no groups and no panels", () => {
  const prompt = createSettingsSignIn(doc, "https://accounts.example/sign-in");
  assert.equal(prompt.querySelector("section.settings-group"), null);
  assert.equal(prompt.querySelector("section.panel"), null);
  // v5.60: the prompt's title is the page h1 (was h2; heading-order fix).
  assert.equal(prompt.querySelector("h1").textContent, "settings.title");
  assert.equal(prompt.querySelector("p").textContent, "settings.signIn");
  const link = prompt.querySelector("a");
  assert.equal(link.textContent, "common.signIn");
  assert.equal(link.href, "https://accounts.example/sign-in");
});

test("old entry point: the home page's settings spot now links into the hub", () => {
  const panel = createSettingsLinkPanel(doc);
  const link = panel.querySelector("a");
  assert.equal(link.getAttribute("href"), SETTINGS_PATH);
  assert.ok(link.hasAttribute("data-app-link"), "an in-app link (no full reload)");
  assert.equal(link.textContent, "settings.title");
  const url = new URL(link.getAttribute("href"), "https://x.test");
  assert.notEqual(routeForPath(url.pathname, url.search).name, "not-found");
});

const navLinks = () => Array.from(accountActions.querySelectorAll("a"))
  .map((link) => [link.getAttribute("aria-label"), link.href]);

test("account menu: members get Settings and My posts links; guests get neither", () => {
  renderAccountNavigation({ username: "alice", role: "member" }, 0);
  const member = navLinks();
  assert.ok(member.some(([label, href]) => label === "settings.title" && href === SETTINGS_PATH), "Settings link");
  assert.ok(member.some(([label, href]) => label === "feed.myPosts" && href === "/mine"), "My posts link");
  const labels = member.map(([label]) => label);
  assert.ok(labels.indexOf("nav.savedPosts") < labels.indexOf("feed.myPosts"), "after Saved posts");
  assert.ok(labels.indexOf("feed.myPosts") < labels.indexOf("settings.title"), "My posts, then Settings");
  renderAccountNavigation(null, 0);
  const guest = navLinks().map(([label]) => label);
  assert.ok(!guest.includes("settings.title"));
  assert.ok(!guest.includes("feed.myPosts"));
});

test("the hub is wired: route renderer, page title, home link, grouped settings", () => {
  const app = read("public/js/app.js");
  assert.match(app, /settings: \(\) => renderSettingsRoute\(context, version\)/);
  assert.match(app, /settings: t\("settings\.title"\)/);
  const feed = read("public/js/routes/feed.js");
  assert.match(feed, /async function renderSettingsRoute\(context, version\)/);
  assert.match(feed, /createSettingsSignIn\(document, wempoAccountsSignInUrl\(location\.origin\)\)/);
  assert.match(feed, /buildSettingsHub\(document, account, panels\)/);
  assert.match(feed, /if \(session\.user\) main\.append\(createSettingsLinkPanel\(document\)\)/);
  assert.doesNotMatch(feed, /if \(session\.user\) renderAccountSettings\(session\)/,
    "home no longer stacks the settings under the feed");
});

test("the grouping is page-view only: no storage, no api()", () => {
  assert.doesNotMatch(read("public/js/settings-groups.js"), /localStorage|sessionStorage|api\(/);
});
