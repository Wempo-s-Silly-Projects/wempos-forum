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

// The account settings hub (v5.56, ORGANIZE #2). Settings used to be one
// collapsed <details> under the home feed stacking 14 panels; it is now its
// own view of the home page (/?settings), linked from the account menu, with
// the panels moved (never rebuilt) into four labelled groups. Page-view only:
// nothing here stores or fetches anything. Text via textContent only.
import { t } from "./i18n.js";

export const SETTINGS_PATH = "/?settings";

// Each panel is matched to its group by its heading's title key. A panel the
// map does not know (a future addition) lands in the last group, so the
// regroup can never drop a control.
export const SETTINGS_GROUPS = Object.freeze([
  Object.freeze({
    key: "appearance",
    titleKey: "settingsGroups.appearance",
    panelTitleKeys: Object.freeze(["feed.appearanceTitle", "readingComfort.title", "fun.title"]),
  }),
  Object.freeze({
    key: "notifications",
    titleKey: "settingsGroups.notifications",
    panelTitleKeys: Object.freeze(["quietHours.title", "notifPrefs.title"]),
  }),
  Object.freeze({
    key: "people",
    titleKey: "settingsGroups.people",
    panelTitleKeys: Object.freeze(["blocks.title", "follow.title", "feed.presenceTitle"]),
  }),
  Object.freeze({
    key: "account",
    titleKey: "settingsGroups.account",
    panelTitleKeys: Object.freeze([
      "feed.changePasswordTitle", "twofa.title", "twofa.backupTitle", "account.sessionsTitle",
      "settings.dataTitle", "invite.title", "feed.deleteAccountTitle",
    ]),
  }),
]);

const panelTitle = (panel) => panel.querySelector("h2")?.textContent ?? "";

export function settingsGroupFor(panel) {
  const title = panelTitle(panel);
  const group = SETTINGS_GROUPS.find((candidate) =>
    candidate.panelTitleKeys.some((key) => t(key) === title));
  return (group ?? SETTINGS_GROUPS.at(-1)).key;
}

function createGroup(doc, group) {
  const section = doc.createElement("section");
  section.className = "settings-group";
  section.dataset.settingsGroup = group.key;
  const heading = doc.createElement("h2");
  heading.className = "settings-group-title";
  heading.id = "settings-group-" + group.key;
  heading.textContent = t(group.titleKey);
  section.setAttribute("aria-labelledby", heading.id);
  section.append(heading);
  return section;
}

// Moves every panel (in its current order) into its group and puts the four
// groups where the flat stack was. The panels keep their nodes, listeners and
// ids, so the jump list, the filter and each panel's own async fill still
// find them under `root`.
export function buildSettingsHub(doc, root, panels) {
  const groups = SETTINGS_GROUPS.map((group) => createGroup(doc, group));
  const byKey = new Map(SETTINGS_GROUPS.map((group, index) => [group.key, groups[index]]));
  for (const panel of panels) {
    byKey.get(settingsGroupFor(panel)).append(panel);
    // L4 (v5.57 review): a panel's title reads one level below its group's
    // h2. It stays an H2 element (twofa.js, account-security.js and
    // panelTitle above look for "h2"); aria-level carries the outline.
    panel.querySelector("h2")?.setAttribute("aria-level", "3");
  }
  root.append(...groups);
  return groups;
}

// The panels in on-screen order (group by group), for the jump list and the
// filter.
export const groupedSettingsPanels = (groups) =>
  groups.flatMap((group) => Array.from(group.children).filter((node) => node.matches("section.panel")));

// The settings filter hides panels; a group with nothing left showing hides
// too, so no bare group heading is left over a blank space.
export function syncSettingsGroups(groups) {
  for (const group of groups) {
    const panels = Array.from(group.querySelectorAll("section.panel"));
    group.hidden = panels.length > 0 && panels.every((panel) => panel.hidden);
  }
}

// A guest who opens /?settings: a sign-in prompt, like /mine and /bookmarks.
// v5.60: its title is the page's h1 (the route clears the shell's h1, and a
// signed-in member's hub opens at h1 too), so the outline does not start at h2.
export function createSettingsSignIn(doc, signInHref) {
  const wrapper = doc.createElement("div");
  wrapper.className = "settings-sign-in";
  const heading = doc.createElement("h1");
  heading.textContent = t("settings.title");
  const note = doc.createElement("p");
  note.className = "muted";
  note.textContent = t("settings.signIn");
  const link = doc.createElement("a");
  link.className = "button button-secondary";
  link.href = signInHref;
  link.textContent = t("common.signIn");
  wrapper.append(heading, note, link);
  return wrapper;
}

// The old entry point: where the collapsed settings used to sit under the
// home feed, one in-app link into the hub.
export function createSettingsLinkPanel(doc) {
  const panel = doc.createElement("p");
  panel.className = "settings-home-link";
  const link = doc.createElement("a");
  link.setAttribute("href", SETTINGS_PATH);
  link.setAttribute("data-app-link", "");
  link.textContent = t("settings.title");
  panel.append(link);
  return panel;
}
