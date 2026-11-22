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


// v4.0 plan 4 Task 9: the header chrome — renderAccountNavigation plus the
// logout action its button dispatches. v5.58 (ORGANIZE #3): both the header
// and the phone bar are drawn here from the one list in nav-items.js — the
// header as Browse menu + direct links + Account menu, the phone bar as its
// slots + a More menu holding the same Browse grouping.
import { clearAllShare } from "../share.js";
import { clearAllInvite } from "../invite.js";
import { api, setCsrfToken } from "../api.js";
import { accountActions } from "../dom.js";
import { createIcon, iconButton } from "../icons.js";
import { createLanguagePicker, t } from "../i18n.js";
import { clearAllDrafts } from "../drafts.js";
import { clearAllCatchUp } from "../catch-up.js";
import { clearAllNewcomer } from "../newcomer.js";
import { clearAllPins } from "../chat-pins.js";
import { clearAllMutes } from "../chat-mutes.js";
import { clearAllRecents } from "../gallery-picks.js";
import { clearAllRecentSearches } from "../recent-searches.js";
import { clearAllQuietHours } from "../quiet-hours.js";
import { clearAllThreadOutline } from "../thread-outline.js";
import { createNotificationBell } from "../notifications.js";
import { createShortcutSheet } from "../shortcut-sheet.js";
import { createDisclosure } from "../thread-actions.js";
import { navItemsFor, navRoleOf } from "../nav-items.js";
// The §4b door-swap: every auth link (header Sign in, mobile guest rung)
// targets Wempo Accounts with an origin-only return; logout hands the browser
// to the Accounts sign-out land so the Accounts session clears too.
import {
  wempoAccountsSignInUrl,
  wempoAccountsSignOutUrl,
} from "../sso.js";

const MENU_GROUP_LABEL_KEYS = Object.freeze({
  browse: "nav.browse", account: "nav.account", language: "language.label",
});

function isValidUser(user) {
  return Boolean(
    user &&
    typeof user === "object" &&
    typeof user.username === "string" &&
    user.username.length > 0 &&
    typeof user.role === "string",
  );
}

function normaliseUnreadCount(value) {
  const count = Number(value);

  return Number.isSafeInteger(count) && count >= 0
    ? count
    : 0;
}

// The two session-dependent hrefs; every other item carries its own.
function hrefOf(entry, user) {
  if (entry.id === "signin") return wempoAccountsSignInUrl(location.origin);
  if (entry.id === "profile") return "/users/" + encodeURIComponent(user.username);
  return entry.href;
}

const labelOf = (entry, user) => t(entry.labelKey, { name: user?.username ?? "" });
// The Wempo Accounts handoff is a full page load, every other link is in-app.
const isAppLink = (entry) => entry.id !== "signin";

// The phone bar's active destination (v4.0): the current route's slot reads
// aria-current="page" and responsive.css paints it with the green accent bar.
function isCurrentPage(entry, user) {
  const path = location.pathname;
  if (entry.id === "home") return path === "/" && !new URLSearchParams(location.search).has("settings");
  if (entry.id === "profile") return path === hrefOf(entry, user);
  return entry.id !== "signin" && path === entry.href;
}

// A labelled entry inside a menu panel: icon + visible text.
function createMenuEntry(entry, user) {
  if (entry.kind === "sheet") return createShortcutSheet(document);
  const node = document.createElement(entry.kind === "action" ? "button" : "a");
  node.className = "button button-quiet nav-menu-item";
  if (entry.kind === "action") {
    node.type = "button";
    node.dataset.action = entry.action;
  } else {
    node.href = hrefOf(entry, user);
    if (isAppLink(entry)) node.setAttribute("data-app-link", "");
    // v5.60: the entry for the page you are on says so, like the bar slots.
    if (isCurrentPage(entry, user)) node.setAttribute("aria-current", "page");
  }
  const text = document.createElement("span");
  text.textContent = labelOf(entry, user);
  if (entry.icon) node.append(createIcon(document, entry.icon));
  node.append(text);
  return node;
}

// A disclosure menu (thread-actions.js's: a real button with aria-expanded +
// aria-controls; Escape closes it and returns focus), restyled for the nav.
function createNavMenu({ kind, label, toggleClass, content, toggleContent = null, ariaLabel = null }) {
  const menu = createDisclosure(document, { kind, id: `nav-${kind}-panel`, label, content });
  menu.className = `nav-menu nav-${kind}`;
  const [toggle, panel] = Array.from(menu.children);
  toggle.className = `${toggleClass} nav-menu-toggle`;
  panel.className = "nav-menu-panel";
  if (toggleContent) toggle.replaceChildren(...toggleContent);
  if (ariaLabel) {
    toggle.setAttribute("aria-label", ariaLabel);
    toggle.title = ariaLabel;
  }
  // v5.60 (WCAG 2.4.11): the panel overlays the page, so when keyboard focus
  // moves to something outside the menu it closes instead of covering it. A
  // focusout with no new target (a click on nothing focusable) is left to
  // the outside-click handler below.
  menu.addEventListener("focusout", (event) => {
    const next = event.relatedTarget;
    if (!next || menu.contains(next) || toggle.getAttribute("aria-expanded") !== "true") return;
    toggle.setAttribute("aria-expanded", "false");
    panel.hidden = true;
  });
  return menu;
}

// `nodes` are ready-built (the language picker); entries are drawn here.
function createMenuGroup(name, scope, entries, user, nodes = []) {
  const group = document.createElement("div");
  group.className = `nav-group nav-group-${name}`;
  group.setAttribute("role", "group");
  const heading = document.createElement("span");
  heading.className = "nav-group-label";
  heading.id = `nav-${scope}-group-${name}`;
  heading.textContent = t(MENU_GROUP_LABEL_KEYS[name]);
  group.setAttribute("aria-labelledby", heading.id);
  group.append(heading, ...entries.map((entry) => createMenuEntry(entry, user)), ...nodes);
  return group;
}

function createSectionLink(icon, href, label) {
  const link = iconButton(document, icon, {
    tagName: "a",
    className: "button button-secondary icon-button",
    ariaLabel: label,
    dataset: { href },
  });

  link.setAttribute("data-app-link", "");

  return link;
}

function createHeaderItem(entry, user, unreadNotifications) {
  if (entry.id === "notifications") return createNotificationBell(unreadNotifications, document);
  if (entry.id === "signin") {
    const signIn = document.createElement("a");
    signIn.className = "button button-secondary";
    signIn.textContent = labelOf(entry, user);
    signIn.href = hrefOf(entry, user);
    return signIn;
  }
  return createSectionLink(entry.icon, hrefOf(entry, user), labelOf(entry, user));
}

// Desktop header: Browse, the direct links, the Account menu, the language
// picker (members: 7 items, HEADER_ITEM_LIMIT).
function renderHeader(role, user, unreadNotifications) {
  const items = navItemsFor(role, "header");
  const browse = createNavMenu({
    kind: "browse",
    label: t("nav.browse"),
    toggleClass: "button button-secondary",
    content: items.filter((entry) => entry.header === "browse").map((entry) => createMenuEntry(entry, user)),
  });
  const direct = items
    .filter((entry) => entry.header === "direct")
    .map((entry) => createHeaderItem(entry, user, unreadNotifications));
  const accountItems = items.filter((entry) => entry.header === "account");
  const account = accountItems.length
    ? [createNavMenu({
      kind: "account",
      label: t("nav.account"),
      ariaLabel: t("nav.account"),
      toggleClass: "button button-secondary icon-button",
      toggleContent: [createIcon(document, "person")],
      content: accountItems.map((entry) => createMenuEntry(entry, user)),
    })]
    : [];
  accountActions.replaceChildren(browse, ...direct, ...account, createLanguagePicker(document));
}

function createBarItem(entry, user) {
  const link = document.createElement("a");
  link.className = "mobile-bar-item";
  link.href = hrefOf(entry, user);
  if (isAppLink(entry)) link.setAttribute("data-app-link", "");
  if (entry.id === "signin") link.id = "mobile-signin";
  if (entry.id === "profile") link.id = "mobile-profile";
  const label = t(entry.mobileLabelKey);
  link.setAttribute("aria-label", label);
  link.title = label;
  if (isCurrentPage(entry, user)) link.setAttribute("aria-current", "page");
  const text = document.createElement("span");
  text.textContent = t(entry.shortKey);
  link.append(createIcon(document, entry.icon), text);
  return link;
}

// Phone bar: its slots, then More (the Browse group, then the Account group,
// then — v5.60 parity — the header's own language picker, reused as is).
function renderMobileBar(role, user) {
  const bar = document.querySelector(".mobile-bar");
  if (!bar) return;
  const items = navItemsFor(role, "mobile");
  const slots = items.filter((entry) => entry.mobile === "bar").map((entry) => createBarItem(entry, user));
  const inMore = items.filter((entry) => entry.mobile === "more");
  const groups = [
    ["browse", inMore.filter((entry) => entry.header === "browse")],
    ["account", inMore.filter((entry) => entry.header !== "browse")],
  ].filter(([, entries]) => entries.length)
    .map(([name, entries]) => createMenuGroup(name, "mobile", entries, user));
  groups.push(createMenuGroup("language", "mobile", [], user, [createLanguagePicker(document)]));
  const label = document.createElement("span");
  label.textContent = t("nav.more");
  const more = createNavMenu({
    kind: "mobile-more",
    label: t("nav.more"),
    toggleClass: "mobile-bar-item",
    toggleContent: [createIcon(document, "dots"), label],
    content: groups,
  });
  bar.replaceChildren(...slots, more);
}

// A click outside an open nav menu closes it (Escape is the keyboard path).
let outsideClickWired = false;
function closeMenusOnOutsideClick() {
  if (outsideClickWired || typeof document.addEventListener !== "function") return;
  outsideClickWired = true;
  document.addEventListener("click", (event) => {
    for (const menu of document.querySelectorAll(".nav-menu")) {
      if (menu.contains(event.target)) continue;
      const toggle = menu.querySelector(".nav-menu-toggle");
      if (toggle?.getAttribute("aria-expanded") !== "true") continue;
      toggle.setAttribute("aria-expanded", "false");
      menu.querySelector(".nav-menu-panel").hidden = true;
    }
  });
}

// v5.60 perf: every route render (each action on a thread re-renders the
// route) used to rebuild the header and the phone bar from scratch (member:
// ~230 nodes + 7 listeners). When nothing the nav shows has changed — same
// member, unread count and page — and both are still the nodes built last
// time with every menu closed, the render reuses them. Any difference, or an
// open menu (which a rebuild closes, as before), rebuilds.
let lastBuild = null;

const navKeyOf = (role, user, unread) =>
  JSON.stringify([role, user?.username ?? "", user?.role ?? "", unread, location.pathname, location.search]);

const firstChildOf = (node) => node?.children?.[0] ?? null;

// v5.61 (L7): "Mark all read" edits the built bell in place (updateBell), so
// the unread count in the key can stop describing it; the reuse also needs
// the bell to still read what it was built to read.
const bellOf = () => Array.from(accountActions?.children ?? []).find((node) => node.id === "notification-bell") ?? null;
const bellLabelOf = (bell) => bell?.getAttribute("aria-label") ?? null;

function canReuseNav(key, bar) {
  if (!lastBuild || lastBuild.key !== key) return false;
  if (firstChildOf(accountActions) !== lastBuild.header || firstChildOf(bar) !== lastBuild.bar) return false;
  if (bellLabelOf(lastBuild.bell) !== lastBuild.bellLabel) return false;
  return !lastBuild.toggles.some((toggle) => toggle.getAttribute("aria-expanded") === "true");
}

function renderAccountNavigation(user, unreadNotifications = 0) {
  const currentUser = isValidUser(user) ? user : null;
  const role = navRoleOf(currentUser);
  const unread = normaliseUnreadCount(unreadNotifications);
  const key = navKeyOf(role, currentUser, unread);
  const bar = document.querySelector(".mobile-bar");

  if (!canReuseNav(key, bar)) {
    renderHeader(role, currentUser, unread);
    renderMobileBar(role, currentUser);
    const toggles = [accountActions, bar].flatMap((root) => Array.from(root?.querySelectorAll?.(".nav-menu-toggle") ?? []));
    const bell = bellOf();
    lastBuild = { key, header: firstChildOf(accountActions), bar: firstChildOf(bar), toggles, bell, bellLabel: bellLabelOf(bell) };
  }
  closeMenusOnOutsideClick();
}

// Shared-browser privacy: unsent drafts, read marks, chat pins, gallery
// recents, newcomer-card dismissals, quiet hours (wave 5.25) and recent
// searches (wave 5.36) leave with the member. Device preferences (theme, text size, locale, DM effects) stay.
// Batch K: drafts live in IndexedDB, whose clear is async — the returned
// promise is kept so sign-out can wait for it before the page navigates away.
let lastDraftWipe = Promise.resolve();
function wipeAccountLocalData() {
  clearAllShare();
  clearAllInvite();
  lastDraftWipe = clearAllDrafts();
  clearAllCatchUp();
  clearAllNewcomer();
  clearAllPins();
  clearAllMutes();
  clearAllRecents();
  clearAllQuietHours();
  clearAllRecentSearches();
  clearAllThreadOutline();
}

export const ACTIONS = {
  // The §4b sign-out handoff: the forum's own
  // session clears first (logout POST + CSRF reset), THEN the browser rides
  // to the Accounts sign-out land (?signout=1, no return parameter — with
  // one, the Accounts arrival auto-issues a fresh ticket and bounces the
  // member straight back signed in).
  logout: async () => {
    // Wave 24: the local wipe rides a finally, so a network error or 5xx on
    // the POST still cleans a shared browser; the error then propagates to
    // handleClick's status line and the browser stays put (no fake success).
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      wipeAccountLocalData();
    }
    await lastDraftWipe;

    setCsrfToken("");
    window.location.assign(wempoAccountsSignOutUrl());
  },
};

export { renderAccountNavigation };
