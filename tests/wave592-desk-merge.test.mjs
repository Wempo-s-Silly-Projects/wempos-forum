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

// v5.92 desk consolidation (owner plan items 7-10): fewer desk tabs, same
// /api routes. Visits lives inside Site health; Chat log + DM log are one
// "Chat & DM log" tab with a Lobby / DMs switch; post, profile and DM reports
// are one "Reports" tab with a type filter; images, avatars and GIFs are one
// "Media" tab. Old desk URLs redirect client-side. DOM-pure over fake-dom.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { countByClass, findByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";
import { GROWTH_FACTOR, LINEAR_GROWTH_CEILING, growthRatio } from "./helpers/timing.mjs";
import {
  CHAT_VIEWS,
  LEGACY_DESK_PATHS,
  REPORT_VIEWS,
  buildChatLog,
  buildMedia,
  buildReports,
  buildSiteHealth,
  deskRedirectPath,
  loadChatLog,
  loadMedia,
  loadReports,
  loadSiteHealth,
} from "../public/js/desk/merged-sections.js";
import { createProfileReportQueue } from "../public/js/desk/reports.js";
import { routeForPath } from "../public/js/router.js";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const LOCALE_DIR = new URL("../public/locales/", import.meta.url);
const locales = () => readdirSync(LOCALE_DIR).filter((name) => name.endsWith(".json"));
const readLocale = (name) => JSON.parse(readFileSync(new URL(name, LOCALE_DIR), "utf8"));

// A fake api(): records every URL and answers with the payload shape the real
// route returns (shapes unchanged by this wave).
const PAYLOADS = {
  "/api/admin/reports": { reports: [] },
  "/api/admin/profile-reports": { profileReports: [{ id: 4, profileUserId: 9, profileUsername: "pat", reporter: "rae", reason: "<i>rude</i>" }] },
  "/api/admin/dm-reports": { dmReports: [{ id: 5, reporter: "a", other: "b", reason: "spam" }] },
  "/api/admin/chat": { messages: [{ id: 1, author: { username: "lou", role: "member" }, body: "hi", createdAt: "2026-11-23T00:00:00Z" }] },
  "/api/admin/dms": { messages: [{ id: 2, between: ["a", "b"], author: { username: "a" }, body: "secret", createdAt: "2026-11-23T00:00:00Z" }] },
  "/api/admin/attachments": { attachments: [] },
  "/api/admin/avatars": { avatars: [] },
  "/api/admin/gifs": { gifs: [] },
  "/api/admin/site-health": { rows: [], retentionDays: 90 },
  "/api/admin/analytics?days=7": { enabled: true, days: 7, totals: [], routes: [], referrers: [], retentionDays: 90 },
};
const fakeApi = () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (!Object.hasOwn(PAYLOADS, url)) throw new Error("unexpected url " + url);
    return structuredClone(PAYLOADS[url]);
  };
  return { calls, fetcher };
};

const deskSlugs = () => [...read("public/js/routes/admin.js")
  .match(/const DESK_SECTIONS = \[([\s\S]*?)\n\];/)[1]
  .matchAll(/\{ slug: "([\w-]+)"/g)].map((match) => match[1]);

const switchLinks = (nodes) => {
  const nav = nodes.find((node) => node && String(node.className).includes("desk-switch"));
  assert.ok(nav, "the view switch renders");
  return [...nav.querySelectorAll("a")];
};

// ------------------------------------------------------------------ the nav

test("desk nav shows the merged tabs and none of the old ones", () => {
  assert.deepEqual(deskSlugs(), [
    "dashboard", "reports", "appeals", "media", "css", "hidden", "bans", "chat-log",
    "automod", "staff-picks", "tags", "rules", "filter", "branding", "site-health", "modules",
  ]);
  const admin = read("public/js/routes/admin.js");
  assert.match(admin, /\{ slug: "reports", labelKey: "admin\.section\.allReports" \}/);
  assert.match(admin, /\{ slug: "media", labelKey: "admin\.section\.media" \}/);
  assert.match(admin, /\{ slug: "chat-log", labelKey: "admin\.section\.chatDmLog" \}/);
  assert.match(admin, /\{ slug: "site-health", labelKey: "admin\.section\.siteHealth" \}/);
  assert.match(admin, /\{ slug: "modules", labelKey: "admin\.section\.modules", ownerOnly: true \}/);
  for (const gone of ["visits", "dm-log", "profile-reports", "dm-reports", "images", "avatars", "gifs"]) {
    assert.doesNotMatch(admin, new RegExp(`slug: "${gone}"`), gone);
    assert.doesNotMatch(admin, new RegExp(`^  "${gone}": \\{`, "m"), gone + " builder removed");
  }
});

test("the overview tiles count the merged queues together", () => {
  const admin = read("public/js/routes/admin.js");
  assert.match(admin, /"reports": reports\.reports\.length \+ profileReports\.profileReports\.length \+ dmReports\.dmReports\.length/);
  assert.match(admin, /"media": attachments\.attachments\.length \+ avatars\.avatars\.length \+ gifs\.gifs\.length/);
  assert.match(admin, /api\("\/api\/admin\/dm-reports"\)/);
});

// ------------------------------------------------------------- redirects

test("old desk paths redirect to their merged home", () => {
  assert.deepEqual({ ...LEGACY_DESK_PATHS }, {
    "visits": "/admin/site-health",
    "dm-log": "/admin/chat-log?view=dms",
    "profile-reports": "/admin/reports?view=profiles",
    "dm-reports": "/admin/reports?view=dms",
    "images": "/admin/media",
    "avatars": "/admin/media",
    "gifs": "/admin/media",
  });
  assert.equal(deskRedirectPath("visits"), "/admin/site-health");
  assert.equal(deskRedirectPath("reports"), null);
  assert.equal(deskRedirectPath("dashboard"), null);
  assert.equal(deskRedirectPath("constructor"), null, "own keys only");
  assert.equal(deskRedirectPath("__proto__"), null, "own keys only");
  assert.ok(Object.isFrozen(LEGACY_DESK_PATHS));
  const admin = read("public/js/routes/admin.js");
  assert.match(admin, /const redirect = deskRedirectPath\(route\.section\);\n\s+if \(redirect\) \{\n\s+state\.router\.navigate\(redirect, \{ replace: true \}\);\n\s+return;/);
});

test("router: /admin/<slug>?view=<v> carries a bounded view, junk is dropped", () => {
  assert.deepEqual(routeForPath("/admin/chat-log", "?view=dms"), { name: "admin", section: "chat-log", view: "dms" });
  assert.deepEqual(routeForPath("/admin/reports", "?view=profiles"), { name: "admin", section: "reports", view: "profiles" });
  assert.deepEqual(routeForPath("/admin/reports"), { name: "admin", section: "reports" });
  assert.deepEqual(routeForPath("/admin", "?view=x"), { name: "admin", section: "dashboard", view: "x" });
  assert.deepEqual(routeForPath("/admin/reports", "?view=" + "a".repeat(40)), { name: "admin", section: "reports" });
  assert.deepEqual(routeForPath("/admin/reports", "?view=%3Cb%3E"), { name: "admin", section: "reports" });
});

// ------------------------------------------------------- Reports (merged)

test("Reports: All loads post, profile and DM reports; a type loads only its own", async () => {
  const all = fakeApi();
  const data = await loadReports(undefined, all.fetcher);
  assert.deepEqual(all.calls, ["/api/admin/reports", "/api/admin/profile-reports", "/api/admin/dm-reports"]);
  assert.equal(data.view, "all");
  for (const [view, url] of [["posts", "/api/admin/reports"], ["profiles", "/api/admin/profile-reports"], ["dms", "/api/admin/dm-reports"]]) {
    const one = fakeApi();
    assert.equal((await loadReports(view, one.fetcher)).view, view);
    assert.deepEqual(one.calls, [url], view);
  }
  const junk = fakeApi();
  assert.equal((await loadReports("nope", junk.fetcher)).view, "all");
  assert.equal(junk.calls.length, 3);
  assert.deepEqual(REPORT_VIEWS.map((v) => v.view), ["all", "posts", "profiles", "dms"]);
});

test("Reports: the type filter is links (aria-current on the active one) above one part per type", async () => {
  const doc = makeFakeDocument();
  const { fetcher } = fakeApi();
  const nodes = buildReports(await loadReports("all", fetcher), doc, { id: 1, role: "owner" });
  const links = switchLinks(nodes);
  assert.deepEqual(links.map((a) => a.href), ["/admin/reports", "/admin/reports?view=posts", "/admin/reports?view=profiles", "/admin/reports?view=dms"]);
  assert.deepEqual(links.map((a) => a.getAttribute("aria-current")), ["page", null, null, null]);
  assert.ok(links.every((a) => a.hasAttribute("data-app-link")));
  const nav = nodes.find((node) => String(node?.className).includes("desk-switch"));
  assert.equal(nav.tagName, "NAV");
  assert.ok(nav.getAttribute("aria-label"));
  const parts = nodes.filter((node) => String(node?.className).includes("desk-part"));
  assert.equal(parts.length, 3);
  assert.ok(parts.every((part) => part.querySelector("h2")));
  const host = doc.createElement("div");
  host.append(...nodes);
  assert.equal(countByClass(host, "report-queue-item"), 2, "profile + DM report");
  assert.equal(findByClass(host, "profile-report-queue").querySelector("p.report-queue-reason").textContent, "<i>rude</i>");
  const dmsOnly = buildReports(await loadReports("dms", fakeApi().fetcher), doc, null);
  assert.equal(dmsOnly.filter((node) => String(node?.className).includes("desk-part")).length, 1);
  assert.equal(switchLinks(dmsOnly)[3].getAttribute("aria-current"), "page");
});

test("profile report queue moved to desk/reports.js unchanged: resolve, visit, ban form; textContent only", () => {
  const doc = makeFakeDocument();
  const empty = createProfileReportQueue([], doc);
  assert.equal(findByClass(empty, "empty-state").className, "empty-state");
  const queue = createProfileReportQueue(PAYLOADS["/api/admin/profile-reports"].profileReports, doc);
  const resolve = queue.querySelector("button");
  assert.equal(resolve.dataset.action, "resolve-profile-report");
  assert.equal(resolve.dataset.reportId, "4");
  assert.equal(queue.querySelector("a").href, "/users/pat");
  assert.ok(queue.querySelector("form"), "ban form");
  assert.doesNotMatch(read("public/js/desk/reports.js"), /innerHTML/);
  assert.doesNotMatch(read("public/js/routes/admin.js"), /function createProfileReportQueue/);
});

// ------------------------------------------------ Chat & DM log (merged)

test("Chat & DM log: Lobby by default fetches only the lobby; DMs only on the DMs view", async () => {
  const lobby = fakeApi();
  const data = await loadChatLog(undefined, lobby.fetcher);
  assert.deepEqual(lobby.calls, ["/api/admin/chat"], "no DM content fetched for the lobby view");
  assert.equal(data.view, "lobby");
  const dms = fakeApi();
  assert.equal((await loadChatLog("dms", dms.fetcher)).view, "dms");
  assert.deepEqual(dms.calls, ["/api/admin/dms"]);
  const junk = fakeApi();
  await loadChatLog("all", junk.fetcher);
  assert.deepEqual(junk.calls, ["/api/admin/chat"]);
  assert.deepEqual(CHAT_VIEWS.map((v) => v.view), ["lobby", "dms"]);
});

test("Chat & DM log: the switch links Lobby / DMs and paints the chosen log", async () => {
  const doc = makeFakeDocument();
  const lobbyNodes = buildChatLog(await loadChatLog(undefined, fakeApi().fetcher), doc);
  const links = switchLinks(lobbyNodes);
  assert.deepEqual(links.map((a) => a.href), ["/admin/chat-log", "/admin/chat-log?view=dms"]);
  assert.deepEqual(links.map((a) => a.getAttribute("aria-current")), ["page", null]);
  const host = doc.createElement("div");
  host.append(...lobbyNodes);
  assert.equal(host.querySelector("button").dataset.action, "chat-delete");
  assert.ok(!host.textContent.includes("secret"));
  const dmNodes = buildChatLog(await loadChatLog("dms", fakeApi().fetcher), doc);
  assert.equal(switchLinks(dmNodes)[1].getAttribute("aria-current"), "page");
  const dmHost = doc.createElement("div");
  dmHost.append(...dmNodes);
  assert.equal(dmHost.querySelector("button").dataset.action, "dm-delete");
  assert.ok(dmHost.textContent.includes("secret"));
});

// ---------------------------------------------------------- Media (merged)

test("Media: loads attachments, avatars and GIFs, one part each", async () => {
  const api = fakeApi();
  const data = await loadMedia(api.fetcher);
  assert.deepEqual(api.calls, ["/api/admin/attachments", "/api/admin/avatars", "/api/admin/gifs"]);
  const doc = makeFakeDocument();
  const nodes = buildMedia(data, doc);
  assert.equal(nodes.length, 3);
  assert.ok(nodes.every((node) => String(node.className).includes("desk-part") && node.querySelector("h2")));
  const host = doc.createElement("div");
  host.append(...nodes);
  assert.equal(countByClass(host, "empty-state"), 3);
});

// ------------------------------------------- Site health with its Visits part

test("Site health: loads web vitals and the 7-day visits, Visits is a part of the page", async () => {
  const api = fakeApi();
  const data = await loadSiteHealth(api.fetcher);
  assert.deepEqual(api.calls, ["/api/admin/site-health", "/api/admin/analytics?days=7"]);
  const doc = makeFakeDocument();
  const nodes = buildSiteHealth(data, doc);
  const host = doc.createElement("div");
  host.append(...nodes);
  assert.ok(findByClass(host, "health-panel"));
  const visits = findByClass(host, "desk-part");
  assert.ok(visits);
  assert.ok(findByClass(visits, "visits-window"), "the 7 / 30 day switch still works there");
});

test("merged views build in linear time: 4x the reports stays under the growth ceiling", () => {
  const doc = makeFakeDocument();
  const reports = (n) => ({
    view: "all",
    parts: [{ view: "profiles", labelKey: "admin.section.profileReports", ledeKey: "admin.lede.profileReports",
      items: Array.from({ length: n }, (_, i) => ({ id: i, profileUserId: i, profileUsername: "u" + i, reporter: "r", reason: "x" })) }],
  });
  const { ratio } = growthRatio((data) => buildReports(data, doc, null), reports(25), reports(25 * GROWTH_FACTOR));
  assert.ok(ratio < LINEAR_GROWTH_CEILING, `growth ${ratio}`);
});

// ------------------------------------------------------------- strings

const NEW_KEYS = ["admin.section.allReports", "admin.lede.allReports", "admin.section.chatDmLog", "admin.lede.chatDmLog",
  "admin.section.media", "admin.lede.media", "desk.reports.all", "desk.switch.label"];
const REMOVED_KEYS = ["admin.section.chatLog", "admin.section.dmLog"];

test("strings: new desk labels in every locale, translated; retired labels gone everywhere", () => {
  const en = readLocale("en.json");
  for (const key of NEW_KEYS) assert.ok(en[key], key);
  let sameAsEnglish = 0;
  for (const name of locales()) {
    const table = readLocale(name);
    for (const key of NEW_KEYS) {
      assert.equal(typeof table[key], "string", `${name} ${key}`);
      assert.ok(table[key].trim(), `${name} ${key}`);
      if (name !== "en.json" && table[key] === en[key]) sameAsEnglish += 1;
    }
    for (const key of REMOVED_KEYS) assert.ok(!(key in table), `${name} still has ${key}`);
  }
  assert.ok(sameAsEnglish <= locales().length, `too many untranslated copies: ${sameAsEnglish}`);
  const merged = read("public/js/desk/merged-sections.js");
  assert.match(merged, /"chat\.tabLobby"/);
  assert.match(merged, /"chat\.tabDms"/);
  assert.doesNotMatch(merged, /innerHTML|localStorage|sessionStorage/);
});
