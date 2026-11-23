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

// v5.92 desk consolidation (owner plan items 7-10): the merged desk tabs.
// Reports = post + profile + DM reports behind a type filter; Chat & DM log =
// the lobby log and the DM log behind a Lobby / DMs switch; Media = images,
// avatars and GIFs as parts of one page; Site health carries Visits as a
// part. Same /api routes and shapes as before — each view only regroups what
// the old tabs fetched. The switches change the URL (?view=), so they are
// links with aria-current, not an ARIA tablist (that pattern is not for page
// navigation). The DM log is still fetched only on its own view.
import { addText } from "../forms.js";
import { t } from "../i18n.js";
import { createDmReportQueue } from "./automod.js";
import { createChatLog, createDmLog } from "./chat-log.js";
import { createAttachmentQueue, createAvatarQueue, createGifQueue } from "./media.js";
import { createProfileReportQueue, createReportQueue } from "./reports.js";
import { createSiteHealthPanel } from "./site-health.js";
import { createVisitsPanel, visitsUrl } from "./visits.js";

// Old desk slugs → their merged home (client-side redirect, history replaced).
export const LEGACY_DESK_PATHS = Object.freeze({
  "visits": "/admin/site-health",
  "dm-log": "/admin/chat-log?view=dms",
  "profile-reports": "/admin/reports?view=profiles",
  "dm-reports": "/admin/reports?view=dms",
  "images": "/admin/media",
  "avatars": "/admin/media",
  "gifs": "/admin/media",
});

export const deskRedirectPath = (section) =>
  (Object.hasOwn(LEGACY_DESK_PATHS, section) ? LEGACY_DESK_PATHS[section] : null);

export const REPORT_VIEWS = Object.freeze([
  { view: "all", labelKey: "desk.reports.all" },
  { view: "posts", labelKey: "admin.section.reports" },
  { view: "profiles", labelKey: "admin.section.profileReports" },
  { view: "dms", labelKey: "admin.section.dmReports" },
]);

export const CHAT_VIEWS = Object.freeze([
  { view: "lobby", labelKey: "chat.tabLobby" },
  { view: "dms", labelKey: "chat.tabDms" },
]);

const REPORT_PARTS = Object.freeze([
  { view: "posts", url: "/api/admin/reports", field: "reports", labelKey: "admin.section.reports", ledeKey: "admin.lede.reports" },
  { view: "profiles", url: "/api/admin/profile-reports", field: "profileReports", labelKey: "admin.section.profileReports", ledeKey: "admin.lede.profileReports" },
  { view: "dms", url: "/api/admin/dm-reports", field: "dmReports", labelKey: "admin.section.dmReports", ledeKey: "admin.lede.dmReports" },
]);

const REPORT_BUILDERS = Object.freeze({
  posts: (items, document, user) => createReportQueue(items, document, user),
  profiles: (items, document) => createProfileReportQueue(items, document),
  dms: (items, document) => createDmReportQueue(items, document),
});

const CHAT_PARTS = Object.freeze({
  lobby: { url: "/api/admin/chat", ledeKey: "admin.lede.chatLog", build: createChatLog },
  dms: { url: "/api/admin/dms", ledeKey: "admin.lede.dmLog", build: createDmLog },
});

const MEDIA_PARTS = Object.freeze([
  { url: "/api/admin/attachments", field: "attachments", labelKey: "admin.section.images", ledeKey: "admin.lede.images", build: createAttachmentQueue },
  { url: "/api/admin/avatars", field: "avatars", labelKey: "admin.section.avatars", ledeKey: "admin.lede.avatars", build: createAvatarQueue },
  { url: "/api/admin/gifs", field: "gifs", labelKey: "admin.section.gifs", ledeKey: "admin.lede.gifs", build: createGifQueue },
]);

// An unknown or missing ?view= opens the first (default) view.
const pickView = (views, requested) => (views.some((v) => v.view === requested) ? requested : views[0].view);

// The view switch: one link per view; the first view's link is the bare path.
function createViewSwitch(document, basePath, views, active) {
  const nav = document.createElement("nav");
  nav.className = "desk-switch visits-window";
  nav.setAttribute("aria-label", t("desk.switch.label"));
  views.forEach(({ view, labelKey }, index) => {
    const link = document.createElement("a");
    const current = view === active;
    link.className = current ? "button" : "button button-quiet";
    link.href = index === 0 ? basePath : basePath + "?view=" + view;
    link.setAttribute("data-app-link", "");
    if (current) link.setAttribute("aria-current", "page");
    link.textContent = t(labelKey);
    nav.append(link);
  });
  return nav;
}

// One part of a merged page: its own heading, a one-line lede, then the body.
function createDeskPart(document, labelKey, ledeKey, body) {
  const part = document.createElement("section");
  part.className = "desk-part";
  addText(document, part, "h2", t(labelKey));
  addText(document, part, "p", t(ledeKey), "muted");
  part.append(body);
  return part;
}

export async function loadReports(view, fetcher) {
  const active = pickView(REPORT_VIEWS, view);
  const parts = REPORT_PARTS.filter((part) => active === "all" || part.view === active);
  const payloads = await Promise.all(parts.map((part) => fetcher(part.url)));
  return { view: active, parts: parts.map((part, index) => ({ ...part, items: payloads[index][part.field] })) };
}

export function buildReports(data, document, user) {
  return [
    createViewSwitch(document, "/admin/reports", REPORT_VIEWS, data.view),
    ...data.parts.map((part) =>
      createDeskPart(document, part.labelKey, part.ledeKey, REPORT_BUILDERS[part.view](part.items, document, user))),
  ];
}

export async function loadChatLog(view, fetcher) {
  const active = pickView(CHAT_VIEWS, view);
  const data = await fetcher(CHAT_PARTS[active].url);
  return { view: active, messages: data.messages };
}

export function buildChatLog(data, document) {
  const part = CHAT_PARTS[data.view];
  const lede = document.createElement("p");
  lede.className = "muted";
  lede.textContent = t(part.ledeKey);
  return [createViewSwitch(document, "/admin/chat-log", CHAT_VIEWS, data.view), lede, part.build(data.messages, document)];
}

export async function loadMedia(fetcher) {
  const payloads = await Promise.all(MEDIA_PARTS.map((part) => fetcher(part.url)));
  return MEDIA_PARTS.map((part, index) => ({ ...part, items: payloads[index][part.field] }));
}

export function buildMedia(parts, document) {
  return parts.map((part) => createDeskPart(document, part.labelKey, part.ledeKey, part.build(part.items, document)));
}

export async function loadSiteHealth(fetcher) {
  const [health, visits] = await Promise.all([fetcher("/api/admin/site-health"), fetcher(visitsUrl(7))]);
  return { health, visits };
}

export function buildSiteHealth(data, document) {
  return [
    createSiteHealthPanel(data.health, document),
    createDeskPart(document, "admin.section.visits", "admin.lede.visits", createVisitsPanel(data.visits, document)),
  ];
}
