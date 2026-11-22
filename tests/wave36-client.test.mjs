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

// Wave 2026-11-21-36 client pins: F1 saved-posts board chips + remove-all
// helper, F2 poll dialog duplicate warning + live preview, F3 Who's Online
// grouped by role. Plus the routing, locale parity and no-storage pins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { makeFakeDocument, findByClass, countByClass } from "./helpers/fake-dom.mjs";
import { createTranslator, t, tn as activeTn } from "../public/js/i18n.js";
import { routeForPath } from "../public/js/router.js";
import { BOARDS } from "../public/js/boards.js";
import {
  createRemoveSavedBoard, createSavedBoardFilter, removeSavedBoard, removedSavedMessage,
  savedEmptyText, savedListPath,
} from "../public/js/saved-boards.js";
import {
  attachPollHelpers, createPollPreview, duplicatePollSlots, refreshPollHelpers,
} from "../public/js/poll-preview.js";
import { groupRoster, paintRosterGroups } from "../public/js/who-online-groups.js";
import { makeEnv } from "./helpers/d1.mjs";
import { call, now, seedUser } from "./helpers/seed.mjs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const NEW_KEYS = [
  "saved.filterLabel", "saved.allBoards", "saved.boardEmpty", "saved.removeBoard", "saved.removeBoardConfirm",
  "saved.removedBoard.one", "saved.removedBoard.other", "composer.pollDuplicate", "composer.pollPreview",
  "composer.pollPreviewEmpty", "online.staff", "online.members",
];

// ---- F1 ---------------------------------------------------------------

test("saved boards: /bookmarks?board= routes valid slugs only", () => {
  assert.deepEqual(routeForPath("/bookmarks", "?board=help"), { name: "bookmarks", board: "help" });
  assert.deepEqual(routeForPath("/bookmarks", "?board=nope"), { name: "bookmarks" });
  assert.deepEqual(routeForPath("/bookmarks", "?board=__proto__"), { name: "bookmarks" });
  assert.deepEqual(routeForPath("/bookmarks", ""), { name: "bookmarks" });
});

test("saved boards: list paths carry a valid board and an encoded cursor", () => {
  assert.equal(savedListPath(), "/api/me/bookmarks");
  assert.equal(savedListPath("help"), "/api/me/bookmarks?board=help");
  assert.equal(savedListPath("help", "10_5"), "/api/me/bookmarks?board=help&before=10_5");
  assert.equal(savedListPath("bogus", "10_5"), "/api/me/bookmarks?before=10_5");
  assert.equal(savedListPath("constructor"), "/api/me/bookmarks");
});

test("saved boards: chips link every board with the active one marked", () => {
  const document = makeFakeDocument();
  const nav = createSavedBoardFilter(document, "help");
  assert.equal(nav.getAttribute("aria-label"), t("saved.filterLabel"));
  const chips = [...nav.children];
  assert.equal(chips.length, BOARDS.length + 1);
  assert.equal(chips[0].textContent, t("saved.allBoards"));
  assert.equal(chips[0].href, "/bookmarks");
  const current = chips.filter((chip) => chip.getAttribute("aria-current") === "page");
  assert.equal(current.length, 1);
  assert.equal(current[0].href, "/bookmarks?board=help");
  assert.ok(chips.every((chip) => chip.getAttribute("data-app-link") === ""));
  const all = createSavedBoardFilter(document, undefined);
  assert.equal(all.children[0].getAttribute("aria-current"), "page");
});

test("saved boards: remove button + empty text name the board", () => {
  const document = makeFakeDocument();
  const button = createRemoveSavedBoard(document, "help");
  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.type, "button");
  assert.equal(button.dataset.action, "remove-saved-board");
  assert.equal(button.dataset.board, "help");
  assert.equal(button.textContent, t("saved.removeBoard", { board: t("boards.helpLabel") }));
  assert.equal(savedEmptyText(undefined), t("feed.bookmarksEmpty"));
  assert.equal(savedEmptyText("showcase"), t("saved.boardEmpty", { board: t("boards.showcaseLabel") }));
});

test("saved boards: removal asks first; no / bad board sends nothing", async () => {
  const calls = [];
  const api = async (path, init) => { calls.push([path, init]); return { ok: true, removed: 3 }; };
  assert.equal(await removeSavedBoard({ api, confirm: () => false, board: "help" }), null);
  assert.equal(await removeSavedBoard({ api, confirm: () => true, board: "nope" }), null);
  assert.equal(calls.length, 0);
  let asked = "";
  const removed = await removeSavedBoard({ api, confirm: (text) => { asked = text; return true; }, board: "help" });
  assert.equal(removed, 3);
  assert.equal(asked, t("saved.removeBoardConfirm", { board: t("boards.helpLabel") }));
  assert.deepEqual(calls, [["/api/me/bookmarks?board=help", { method: "DELETE" }]]);
  assert.equal(removedSavedMessage(3), activeTn("saved.removedBoard", 3));
  const en = JSON.parse(read("public/locales/en.json"));
  const { tn } = createTranslator("en", en, en);
  assert.equal(tn("saved.removedBoard", 1), "Removed 1 saved post.");
  assert.equal(tn("saved.removedBoard", 3), "Removed 3 saved posts.");
});

test("saved boards: feed.js wires chips, the remove action and board-aware paging", () => {
  const feed = read("public/js/routes/feed.js");
  assert.match(feed, /createSavedBoardFilter\(document, board\)/);
  assert.match(feed, /"remove-saved-board": async/);
  assert.match(feed, /savedListPath\(board, button\.dataset\.before\)/);
  assert.match(read("public/js/app.js"), /renderBookmarksRoute\(route, context, version\)/);
});

// ---- F2 ---------------------------------------------------------------

test("poll helpers: duplicates match the server rule (trim + lowercase), blanks ignored", () => {
  assert.deepEqual([...duplicatePollSlots(["Yes", "No", "", ""])], []);
  assert.deepEqual([...duplicatePollSlots(["Yes", " yes ", "No", "YES"])].sort(), [0, 1, 3]);
  assert.deepEqual([...duplicatePollSlots(["", "", "a", "b"])], []);
  assert.deepEqual([...duplicatePollSlots(["a", "b", "B", "A"])].sort(), [0, 1, 2, 3]);
});

test("poll helpers: the preview shows question + non-blank options, or a hint when empty", () => {
  const document = makeFakeDocument();
  const empty = createPollPreview(document, "", ["", "", "", ""]);
  assert.equal(findByClass(empty, "poll-preview-title").textContent, t("composer.pollPreview"));
  assert.equal(findByClass(empty, "poll-preview-empty").textContent, t("composer.pollPreviewEmpty"));
  const full = createPollPreview(document, "Pizza?", ["Yes", "", "No", ""]);
  assert.equal(findByClass(full, "poll-preview-question").textContent, "Pizza?");
  assert.deepEqual([...full.querySelectorAll(".poll-preview-option")].map((n) => n.textContent), ["Yes", "No"]);
});

function fakePollDialog(document) {
  const dialog = document.createElement("dialog");
  const form = document.createElement("form");
  const question = document.createElement("input");
  question.id = "poll-question";
  form.append(question);
  for (const slot of [1, 2, 3, 4]) {
    const input = document.createElement("input");
    input.id = "poll-option-" + slot;
    form.append(input);
  }
  const note = document.createElement("p");
  note.id = "poll-options-note";
  const actions = document.createElement("div");
  actions.className = "form-actions";
  form.append(note, actions);
  dialog.append(form);
  return dialog;
}

test("poll helpers: attach adds one warning + preview after the note and repaints on input", () => {
  const document = makeFakeDocument();
  const dialog = fakePollDialog(document);
  const option = (slot) => dialog.querySelector("[id=poll-option-" + slot + "]");
  assert.equal(attachPollHelpers(dialog, document), false);
  attachPollHelpers(dialog, document);
  assert.equal(countByClass(dialog, "poll-duplicate"), 1);
  assert.equal(countByClass(dialog, "poll-preview-slot"), 1);
  const form = dialog.children[0];
  const order = [...form.children].map((n) => n.id || n.className);
  assert.deepEqual(order.slice(-4), ["poll-options-note", "poll-duplicate", "poll-preview-slot", "form-actions"]);
  const warning = findByClass(dialog, "poll-duplicate");
  assert.equal(warning.hidden, true);
  assert.equal(warning.getAttribute("role"), "alert");
  dialog.querySelector("[id=poll-question]").value = "Best snack?";
  option(1).value = "Chips";
  option(2).value = "chips ";
  dialog.dispatch("input", {});
  assert.equal(warning.hidden, false);
  assert.equal(option(1).getAttribute("aria-invalid"), "true");
  assert.equal(option(2).getAttribute("aria-invalid"), "true");
  assert.equal(option(3).getAttribute("aria-invalid"), null);
  assert.equal(findByClass(dialog, "poll-preview-question").textContent, "Best snack?");
  option(2).value = "Pretzels";
  assert.equal(refreshPollHelpers(dialog, document), false);
  assert.equal(warning.hidden, true);
  assert.equal(option(1).getAttribute("aria-invalid"), null);
});

test("poll helpers: composer confirm refuses duplicates before stashing the poll", () => {
  const composer = read("public/js/routes/composer.js");
  const confirm = composer.slice(composer.indexOf("function confirmPollDialog"));
  const dupAt = confirm.indexOf("duplicatePollSlots(options).size");
  assert.ok(dupAt > 0);
  assert.ok(dupAt < confirm.indexOf("form.composerPoll ="));
  assert.match(composer, /attachPollHelpers\(dialog, document\);\n {2}dialog\.showModal\(\)/);
});

// ---- F3 ---------------------------------------------------------------

test("who's online: staff (owner/admin) first, members after, each with a count", () => {
  const groups = groupRoster([
    { id: 1, username: "m1", role: "member" },
    { id: 2, username: "own", role: "owner" },
    { id: 3, username: "adm", role: "admin" },
    { id: 4, username: "", role: "admin" },
    { id: 5, username: "m2", role: "member" },
  ]);
  assert.deepEqual(groups.map((g) => g.key), ["staff", "members"]);
  assert.deepEqual(groups[0].members.map((m) => m.username), ["own", "adm"]);
  assert.equal(groups[0].label, t("online.staff", { count: 2 }));
  assert.equal(groups[1].label, t("online.members", { count: 2 }));
  assert.deepEqual(groupRoster([{ username: "x", role: "member" }]).map((g) => g.key), ["members"]);
  assert.deepEqual(groupRoster(null), []);
});

test("who's online: the name cap spans the card, staff first, one +N more line", () => {
  const document = makeFakeDocument();
  const list = document.createElement("div");
  const online = [
    ...Array.from({ length: 4 }, (_, i) => ({ username: "m" + i, role: "member" })),
    { username: "boss", role: "owner" },
  ];
  paintRosterGroups(document, list, online, 3, (name) => "/users/" + name);
  const names = [...list.querySelectorAll(".who-online-name")].map((n) => n.textContent);
  assert.deepEqual(names, ["boss", "m0", "m1"]);
  assert.equal(findByClass(list, "who-online-more").textContent, t("online.more", { count: 2 }));
  const headings = [...list.querySelectorAll(".who-online-group-heading")].map((n) => n.textContent);
  assert.deepEqual(headings, [t("online.staff", { count: 1 }), t("online.members", { count: 4 })]);
  assert.equal(list.querySelector(".who-online-name").href, "/users/boss");
});

test("who's online: grouping happens on the server's roster only (no fetch, no storage)", () => {
  const groups = read("public/js/who-online-groups.js");
  assert.doesNotMatch(groups, /localStorage|sessionStorage|api\(|fetch\(|invisible\s*[:=]/);
  assert.match(read("public/js/who-online.js"), /paintRosterGroups\(document, listEl, online, ROSTER_NAME_MAX, profileHref\)/);
});

test("who's online: an invisible owner never reaches the roster, so Staff can't reveal them", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  const ghost = await seedUser(db, { username: "ghostowner", role: "admin" });
  const shown = await seedUser(db, { username: "shownadmin", role: "moderator" });
  const member = await seedUser(db, { username: "plainmember" });
  const presence = db.prepare("INSERT INTO presence (user_id, last_seen, invisible) VALUES (?, ?, ?)");
  presence.run(ghost, now(), 1);
  presence.run(shown, now(), 0);
  presence.run(member, now(), 0);
  const roster = (await (await call(env, "/api/presence")).json()).online;
  const groups = groupRoster(roster);
  assert.deepEqual(groups.map((g) => [g.key, g.members.map((m) => m.username)]), [
    ["staff", ["shownadmin"]], ["members", ["plainmember"]],
  ]);
  assert.equal(groups[0].label, t("online.staff", { count: 1 }));
});

// ---- shared pins --------------------------------------------------------

test("wave 36: the new client modules store nothing on the device", () => {
  for (const path of ["public/js/saved-boards.js", "public/js/poll-preview.js", "public/js/who-online-groups.js"]) {
    assert.doesNotMatch(read(path), /localStorage|sessionStorage|indexedDB|document\.cookie/, path);
  }
  assert.doesNotMatch(read("public/js/poll-preview.js"), /api\(|fetch\(/);
});

test("wave 36: every new key is in en.json and translated in all 20 locales", () => {
  const dir = new URL("../public/locales/", import.meta.url);
  const en = JSON.parse(readFileSync(new URL("en.json", dir), "utf8"));
  const others = readdirSync(dir).filter((name) => name.endsWith(".json") && name !== "en.json");
  assert.equal(others.length, 44);
  for (const key of NEW_KEYS) {
    assert.equal(typeof en[key], "string", key);
    for (const name of others) {
      const messages = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
      assert.equal(typeof messages[key], "string", name + " " + key);
      assert.notEqual(messages[key], en[key], name + " " + key + " is untranslated");
      for (const slot of en[key].match(/\{\w+\}/g) || []) assert.ok(messages[key].includes(slot), name + " " + key + " " + slot);
    }
  }
});
