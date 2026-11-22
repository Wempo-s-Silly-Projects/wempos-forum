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

// v5.39.0 client: folder chips + per-card folder controls on /bookmarks, the
// Follow button on profiles, the Following list in settings and the bell copy
// for a followed member's new thread. DOM-pure builders over fake-dom; user
// text lands through textContent only, hrefs come from the URL API, and
// nothing touches device storage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeFakeDocument, findByClass, countByClass } from "./helpers/fake-dom.mjs";
import { bestOf } from "./helpers/timing.mjs";
import {
  createFolderFilter,
  createFolderManage,
  decorateSavedCards,
  folderItemsPath,
  normalizeFolderName,
} from "../public/js/bookmark-folders.js";
import { createFollowButton, createFollowingList, followPath, setFollowState } from "../public/js/follows.js";
import { notificationItemView } from "../public/js/notifications.js";
import { routeForPath } from "../public/js/router.js";
import { t } from "../public/js/i18n.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const doc = makeFakeDocument();
const FOLDERS = [{ id: 3, name: "<b>Recipes</b>" }, { id: 9, name: "Later" }];

test("router: /bookmarks?folder=<id> opens a folder; junk degrades to the whole list", () => {
  assert.deepEqual(routeForPath("/bookmarks", "?folder=9"), { name: "bookmarks", folder: 9 });
  for (const junk of ["?folder=abc", "?folder=0", "?folder=-1", "?folder=1234567890123456", "?folder=__proto__"]) {
    assert.deepEqual(routeForPath("/bookmarks", junk), { name: "bookmarks" }, junk);
  }
  assert.deepEqual(routeForPath("/bookmarks", "?board=help"), { name: "bookmarks", board: "help" });
});

test("folder paths and the advisory name check mirror the server", () => {
  assert.equal(folderItemsPath(3), "/api/me/bookmark-folders/3/items");
  assert.equal(folderItemsPath(3, "17_4"), "/api/me/bookmark-folders/3/items?before=17_4");
  assert.equal(normalizeFolderName("  Trips "), "Trips");
  for (const bad of ["", "   ", "x".repeat(41), "a\tb", null, 5]) assert.equal(normalizeFolderName(bad), null, JSON.stringify(bad));
  assert.equal(normalizeFolderName("é".repeat(40)), "é".repeat(40));
});

test("folder chips: All saved + one chip per folder (textContent), URL-built hrefs, aria-current, New folder", () => {
  const nav = createFolderFilter(doc, FOLDERS, 9);
  assert.equal(nav.getAttribute("aria-label"), t("folders.filterLabel"));
  const chips = [...nav.querySelectorAll("a")];
  assert.deepEqual(chips.map((chip) => chip.href), ["/bookmarks", "/bookmarks?folder=3", "/bookmarks?folder=9"]);
  assert.equal(chips[0].textContent, t("folders.allSaved"));
  assert.equal(chips[1].textContent, "<b>Recipes</b>");
  assert.equal(chips[2].getAttribute("aria-current"), "page");
  assert.equal(chips[0].getAttribute("aria-current"), null);
  const create = findByClass(nav, "folder-create");
  assert.equal(create.dataset.action, "folder-create");
  assert.equal(create.textContent, t("folders.new"));
  const none = createFolderFilter(doc, [], null);
  assert.equal([...none.querySelectorAll("a")][0].getAttribute("aria-current"), "page");
});

test("folder manage: rename + delete carry the folder id", () => {
  const box = createFolderManage(doc, FOLDERS[0]);
  const rename = findByClass(box, "folder-rename");
  const remove = findByClass(box, "folder-delete");
  assert.equal(rename.dataset.action, "folder-rename");
  assert.equal(rename.dataset.folderId, "3");
  assert.equal(remove.dataset.action, "folder-delete");
  assert.equal(remove.dataset.folderName, "<b>Recipes</b>");
});

function savedList() {
  const list = doc.createElement("div");
  for (const id of [11, 12]) {
    const card = doc.createElement("article");
    card.className = "post-card";
    card.dataset.postId = String(id);
    list.append(card);
  }
  return list;
}

test("saved cards: All view gets an Add-to-folder select per card; a folder view gets Remove from folder", () => {
  const added = [];
  const all = savedList();
  decorateSavedCards(all, doc, { folders: FOLDERS, activeFolderId: null, onAdd: (postId, folderId) => added.push([postId, folderId]) });
  assert.equal(countByClass(all, "folder-add"), 2);
  const select = findByClass(all, "folder-add");
  assert.equal(select.getAttribute("aria-label"), t("folders.addTo"));
  const options = [...select.querySelectorAll("option")];
  assert.deepEqual(options.map((option) => option.textContent), [t("folders.addTo"), "<b>Recipes</b>", "Later"]);
  select.value = "9";
  for (const listener of select.listeners.change || []) listener({ target: select });
  assert.deepEqual(added, [[11, 9]]);
  const empty = savedList();
  decorateSavedCards(empty, doc, { folders: [], activeFolderId: null, onAdd() {} });
  assert.equal(countByClass(empty, "folder-add"), 0, "no folders, no select");
  const inside = savedList();
  decorateSavedCards(inside, doc, { folders: FOLDERS, activeFolderId: 3, onAdd() {} });
  assert.equal(countByClass(inside, "folder-remove"), 2);
  const remove = findByClass(inside, "folder-remove");
  assert.equal(remove.dataset.action, "folder-remove-item");
  assert.equal(remove.dataset.folderId, "3");
  assert.equal(remove.dataset.postId, "11");
  assert.equal(remove.textContent, t("folders.removeFrom"));
});

test("follow button: Follow / Following with aria-pressed; setFollowState flips it", () => {
  assert.equal(followPath("bob"), "/api/users/bob/follow");
  const button = createFollowButton(doc, { username: "bob", following: false });
  assert.equal(button.dataset.action, "toggle-follow");
  assert.equal(button.dataset.username, "bob");
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.equal(button.textContent, t("follow.follow"));
  setFollowState(button, true);
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(button.textContent, t("follow.following"));
});

test("Following list: names via textContent, profile links from the URL API, Unfollow per row, empty state", () => {
  const list = createFollowingList(doc, [{ id: 2, username: "bob", followedAt: "2026-11-20T00:00:00.000Z" }]);
  const link = findByClass(list, "following-name");
  assert.equal(link.href, "/users/bob");
  assert.equal(link.textContent, "@bob");
  const unfollow = findByClass(list, "following-unfollow");
  assert.equal(unfollow.dataset.action, "unfollow-user");
  assert.equal(unfollow.dataset.username, "bob");
  assert.equal(unfollow.textContent, t("follow.unfollow"));
  const empty = createFollowingList(doc, []);
  assert.equal(findByClass(empty, "empty-state").textContent, t("follow.empty"));
});

test("bell: a followed member's new-thread row reads in the viewer's language", () => {
  const view = notificationItemView({ id: 1, targetPostId: 5, replyId: 5, read: false, label: "New thread from bob" });
  assert.equal(view.label, t("bell.followThread", { username: "bob" }));
  assert.equal(view.href, "/posts/5");
  const mention = notificationItemView({ id: 2, targetPostId: 5, replyId: 5, read: false, label: "You were mentioned by bob" });
  assert.equal(mention.label, "You were mentioned by bob");
});

test("wiring: profile, settings and app use the new modules; no innerHTML or storage in them", () => {
  for (const file of ["public/js/bookmark-folders.js", "public/js/follows.js"]) {
    const source = read(file);
    assert.match(source, /SPDX-License-Identifier: AGPL-3\.0-or-later/);
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, file);
    assert.doesNotMatch(source, /localStorage|sessionStorage/, file);
  }
  assert.match(read("public/js/routes/profile.js"), /createFollowButton/);
  assert.match(read("public/js/routes/feed.js"), /renderFollowingSettings/);
  assert.match(read("public/js/routes/feed.js"), /decorateSavedCards/);
  const app = read("public/js/app.js");
  assert.match(app, /from "\.\/follows\.js"/);
  assert.match(app, /from "\.\/bookmark-folders\.js"/);
});

test("speed: 20 folder chips + 20 decorated cards build in well under a frame", () => {
  const folders = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: "folder " + i }));
  const ms = bestOf(() => {
    createFolderFilter(doc, folders, 4);
    const list = doc.createElement("div");
    for (let i = 0; i < 20; i++) {
      const card = doc.createElement("article");
      card.className = "post-card";
      card.dataset.postId = String(i + 1);
      list.append(card);
    }
    decorateSavedCards(list, doc, { folders, activeFolderId: null, onAdd() {} });
  });
  assert.ok(ms < 16, "took " + ms + " ms");
});
