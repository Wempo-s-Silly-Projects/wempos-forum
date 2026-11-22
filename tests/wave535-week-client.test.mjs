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

// v5.35 client: the /week route and page builders, the "New 👋" chip, the
// staff-pick control on showcase roots, the pick pinned atop the showcase
// gallery, the home "Newest members" list + This-week link, the desk's
// staff-pick log, and every new string in all 65 locales.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { routeForPath } from "../public/js/router.js";
import { createPostCard } from "../public/js/render.js";
import { createShowcaseGallery } from "../public/js/traditions.js";
import { createNewestMembers, createWeekLink, createWeekPage } from "../public/js/week.js";
import { createStaffPickLog } from "../public/js/desk/staff-picks.js";
import { countByClass, findByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";

const source = (path) => readFileSync(new URL("../public/js/" + path, import.meta.url), "utf8");
const textOf = (node) => (node.textContent ?? "") + (node.children ? [...node.childNodes].map(textOf).join("") : "");
const links = (node, out = []) => {
  if (node.tagName === "A") out.push(node.href);
  for (const child of node.childNodes || []) links(child, out);
  return out;
};

const NEW_KEYS = [
  "app.pageWeek", "week.title", "week.lede", "week.threadsTitle", "week.showcaseTitle", "week.threadsEmpty",
  "newestMembers.title", "staffPick.label", "staffPick.pick", "staffPick.unpick", "staffPick.picked",
  "staffPick.unpicked", "admin.section.staffPicks", "admin.lede.staffPicks", "admin.noStaffPicks",
  "admin.staffPickLogPick", "admin.staffPickLogUnpick",
];

test("/week routes to the week page (so the worker answers 200, not 404)", () => {
  assert.deepEqual(routeForPath("/week"), { name: "week" });
  assert.deepEqual(routeForPath("/week/extra"), { name: "not-found" });
});

test("New chip: a new author's card carries it, an older author's does not", () => {
  const card = (isNew) => createPostCard({
    id: 5, body: "hi", createdAt: "2026-11-21T00:00:00Z", visibility: "public",
    author: { id: 2, username: "ann", role: null, isNew },
  }, makeFakeDocument(), null);
  assert.equal(countByClass(card(true), "role-badge-new"), 1);
  assert.equal(countByClass(card(false), "role-badge-new"), 0);
  assert.equal(countByClass(card(undefined), "role-badge-new"), 0);
});

test("staff-pick control: staff on a public showcase root only, label follows staffPick", () => {
  const post = (extra) => ({ id: 9, body: "b", createdAt: "2026-11-21T00:00:00Z", visibility: "public",
    board: "showcase", parent: null, author: { id: 2, username: "ann", role: null }, ...extra });
  const actionsOf = (node, out = []) => {
    if (node.dataset?.action) out.push(node.dataset.action);
    for (const child of node.childNodes || []) actionsOf(child, out);
    return out;
  };
  const staff = { id: 1, username: "boss", role: "owner" };
  assert.ok(actionsOf(createPostCard(post({}), makeFakeDocument(), staff)).includes("staff-pick"));
  assert.ok(actionsOf(createPostCard(post({ staffPick: true }), makeFakeDocument(), staff)).includes("staff-unpick"));
  assert.ok(!actionsOf(createPostCard(post({}), makeFakeDocument(), { id: 3, username: "m", role: null })).some((a) => a.startsWith("staff-")));
  assert.ok(!actionsOf(createPostCard(post({ board: "general" }), makeFakeDocument(), staff)).some((a) => a.startsWith("staff-")));
  assert.ok(!actionsOf(createPostCard(post({ visibility: "hidden" }), makeFakeDocument(), staff)).some((a) => a.startsWith("staff-")));
});

test("the showcase gallery pins the staff pick on top with its label, and never twice", () => {
  const items = [{ id: 2, body: "two", authorName: "b", image: { id: "i2", version: "v1" } },
    { id: 1, body: "one", authorName: "a", image: { id: "i1", version: "v1" } }];
  const grid = createShowcaseGallery(makeFakeDocument(), items, { id: 1, excerpt: "one", authorName: "a", image: { id: "i1", version: "v1" } });
  assert.equal(countByClass(grid, "staff-pick-label"), 1);
  assert.equal(countByClass(grid, "gallery-tile"), 2, "the pick is not repeated below");
  assert.ok(grid.children[0].classList.contains("staff-pick-tile"));
  assert.equal(countByClass(createShowcaseGallery(makeFakeDocument(), items), "staff-pick-label"), 0);
  // A pick without an image still shows (as a text tile).
  const textOnly = createShowcaseGallery(makeFakeDocument(), [], { id: 7, excerpt: "words", authorName: "a", image: null });
  assert.equal(countByClass(textOnly, "staff-pick-tile"), 1);
});

test("week page: pick on top, threads link to /posts/<id>, showcase tiles, masked excerpts, empty states", () => {
  const doc = makeFakeDocument();
  const page = createWeekPage(doc, {
    staffPick: { id: 4, excerpt: "pick", authorName: "ann", image: null },
    threads: [{ id: 10, excerpt: "busy ||SECRET||", board: "general", authorName: "bob", replyCount: 3,
      createdAt: "2026-11-20T00:00:00Z", lastActivityAt: "2026-11-21T00:00:00Z" }],
    showcase: [{ id: 11, body: "build", authorName: "cat", image: { id: "i", version: "v1" } }],
  });
  const first = findByClass(page, "week-staff-pick");
  assert.ok(first, "the pick card renders");
  assert.equal(countByClass(page, "staff-pick-label"), 1);
  const hrefs = links(page);
  assert.ok(hrefs.includes("/posts/4") && hrefs.includes("/posts/10") && hrefs.includes("/posts/11"), hrefs.join());
  assert.ok(!textOf(page).includes("SECRET"), "thread previews mask spoilers");
  const empty = createWeekPage(makeFakeDocument(), { staffPick: null, threads: [], showcase: [] });
  assert.equal(countByClass(empty, "week-staff-pick"), 0);
  assert.equal(countByClass(empty, "empty-state"), 2);
});

test("newest members: profile links, nothing for an empty list; the This-week link points at /week", () => {
  const list = createNewestMembers(makeFakeDocument(), [{ username: "ann", avatarUrl: null }, { username: "b c", avatarUrl: null }]);
  assert.deepEqual(links(list), ["/users/ann", "/users/b%20c"]);
  assert.equal(createNewestMembers(makeFakeDocument(), []), null);
  assert.deepEqual(links(createWeekLink(makeFakeDocument())), ["/week"]);
});

test("desk staff-pick log: one row per entry, empty state otherwise", () => {
  const log = createStaffPickLog([
    { id: 2, action: "unpick", postId: 9, actor: "boss", createdAt: "2026-11-21T00:00:00Z" },
    { id: 1, action: "pick", postId: 9, actor: null, createdAt: "2026-11-20T00:00:00Z" },
  ], makeFakeDocument());
  assert.equal(countByClass(log, "staff-pick-entry"), 2);
  assert.deepEqual(links(log), ["/posts/9", "/posts/9"]);
  assert.equal(countByClass(createStaffPickLog([], makeFakeDocument()), "empty-state"), 1);
});

test("wiring: app renders /week, home fetches newest members and links /week, desk acts on staff picks", () => {
  const app = source("app.js");
  assert.match(app, /week: \(\) => renderWeekRoute\(/);
  assert.match(app, /week: t\("app\.pageWeek"\)/);
  const pages = source("routes/pages.js");
  assert.match(pages, /api\("\/api\/week"\)/);
  const feed = source("routes/feed.js");
  assert.match(feed, /api\("\/api\/members\/newest"\)/);
  assert.match(feed, /createWeekLink\(/);
  const admin = source("routes/admin.js");
  assert.match(admin, /"staff-pick": async/);
  assert.match(admin, /"staff-unpick": async/);
  assert.match(admin, /staff-pick", \{ method: "POST" \}/);
  assert.match(admin, /staff-pick", \{ method: "DELETE" \}/);
  assert.match(admin, /slug: "staff-picks"/);
  // Page-view-only builders: no storage, no network.
  assert.doesNotMatch(source("week.js"), /localStorage|sessionStorage|api\(/);
});

test("every v5.35 string exists in all 65 locales, translated", () => {
  const dir = new URL("../public/locales/", import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 65);
  const en = JSON.parse(readFileSync(new URL("en.json", dir), "utf8"));
  for (const key of NEW_KEYS) assert.ok(en[key], "en " + key);
  for (const file of files.filter((name) => name !== "en.json")) {
    const table = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
    let same = 0;
    for (const key of NEW_KEYS) {
      assert.ok(typeof table[key] === "string" && table[key].trim(), file + " " + key);
      if (table[key] === en[key]) same += 1;
    }
    assert.ok(same <= 2, file + ": " + same + " v5.35 strings left in English");
  }
});
