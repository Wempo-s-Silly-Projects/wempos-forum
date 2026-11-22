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

// v5.38.0 client: the status line, the pinned-thread panel, the status form,
// pin buttons on your own recent threads, and the poll's "Closes in …" line
// plus the closing-time control. All DOM-pure builders over fake-dom; user
// text lands through textContent only, links are built with the URL API, and
// excerpts mask spoilers before cutting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeFakeDocument, findByClass, countByClass } from "./helpers/fake-dom.mjs";
import { bestOf } from "./helpers/timing.mjs";
import {
  createPinnedThread,
  createRecentThreads,
  createStatusForm,
  createStatusLine,
} from "../public/js/profile-extras.js";
import { formatClosesIn, renderPollBlock } from "../public/js/polls.js";
import { t } from "../public/js/i18n.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const doc = makeFakeDocument();
const THREAD = { id: 7, body: "Hello ||secret|| world", board: "general", createdAt: "2026-11-20T10:00:00.000Z" };

test("status line: nothing for null/empty; emoji + text via textContent", () => {
  assert.equal(createStatusLine(doc, null), null);
  assert.equal(createStatusLine(doc, { text: "", emoji: "" }), null);
  const line = createStatusLine(doc, { text: "<b>busy</b>", emoji: "🎮", expiresAt: null });
  assert.equal(line.className, "profile-status");
  assert.equal(findByClass(line, "profile-status-emoji").textContent, "🎮");
  assert.equal(findByClass(line, "profile-status-text").textContent, "<b>busy</b>");
  const textOnly = createStatusLine(doc, { text: "hi", emoji: "" });
  assert.equal(countByClass(textOnly, "profile-status-emoji"), 0);
});

test("pinned thread: a Pinned panel item linking /posts/:id, spoilers masked; unpin only on your own", () => {
  assert.equal(createPinnedThread(doc, null), null);
  const pinned = createPinnedThread(doc, THREAD, "en", { own: false });
  const link = findByClass(pinned, "pinned-thread-link");
  assert.equal(link.href, "/posts/7");
  assert.ok(!link.textContent.includes("secret"));
  assert.equal(countByClass(pinned, "pinned-thread-unpin"), 0);
  const own = createPinnedThread(doc, THREAD, "en", { own: true });
  const unpin = findByClass(own, "pinned-thread-unpin");
  assert.equal(unpin.dataset.action, "profile-unpin");
  assert.equal(unpin.textContent, t("profile.unpinThread"));
  assert.equal(findByClass(own, "pinned-thread-label").textContent, t("profile.pinnedTitle"));
});

test("recent threads: Pin buttons only on your own profile, carrying the thread id", () => {
  const theirs = createRecentThreads(doc, [THREAD], "en");
  assert.equal(countByClass(theirs, "recent-thread-pin"), 0);
  const mine = createRecentThreads(doc, [THREAD], "en", { own: true, pinnedId: null });
  const button = findByClass(mine, "recent-thread-pin");
  assert.equal(button.dataset.action, "profile-pin");
  assert.equal(button.dataset.postId, "7");
  const already = createRecentThreads(doc, [THREAD], "en", { own: true, pinnedId: 7 });
  assert.equal(countByClass(already, "recent-thread-pin"), 0, "the pinned thread gets no second Pin button");
});

test("status form: text (60), emoji, expiry select with the five allowlisted values, save + clear", () => {
  const form = createStatusForm(doc, { text: "hi", emoji: "🎮" });
  assert.equal(form.dataset.form, "profile-status");
  const inputs = form.querySelectorAll("input");
  const byName = {};
  inputs.forEach((input) => { byName[input.name] = input; });
  assert.equal(byName.statusText.maxLength, 60);
  assert.equal(byName.statusText.value, "hi");
  assert.equal(byName.statusEmoji.value, "🎮");
  const select = form.querySelectorAll("select")[0];
  assert.equal(select.name, "statusExpiry");
  const values = [];
  select.querySelectorAll("option").forEach((option) => values.push(option.value));
  assert.deepEqual(values, ["never", "1h", "4h", "today", "week"]);
  assert.equal(countByClass(form, "status-clear"), 1);
  assert.equal(findByClass(form, "status-clear").dataset.action, "profile-status-clear");
});

test("poll: 'Closes …' while open, 'Voting is closed.' after; deadline control for managers only", () => {
  const base = { question: "Q", options: [{ id: 1, label: "A", count: 0 }], totalVotes: 0, viewerOption: null };
  const future = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
  const open = renderPollBlock({ ...base, closed: false, canManage: false, closesAt: future }, doc, { id: 1 });
  // The test translator has no tables loaded, so t() echoes keys; the wording
  // itself is pinned through formatClosesIn below.
  assert.equal(findByClass(open, "poll-closes").textContent, t("polls.closesIn", { time: formatClosesIn(future, Date.now(), "en") }));
  assert.match(formatClosesIn(future, Date.now(), "en"), /in 3 hours/);
  assert.equal(countByClass(open, "poll-deadline-select"), 0);
  const closed = renderPollBlock({ ...base, closed: true, canManage: false, closesAt: new Date(Date.now() - 1000).toISOString() }, doc, { id: 1 });
  assert.equal(countByClass(closed, "poll-closes"), 0);
  assert.equal(findByClass(closed, "poll-closed").textContent, t("polls.closed"));
  const managed = renderPollBlock({ ...base, closed: false, canManage: true, closesAt: null }, doc, { id: 1 });
  const select = findByClass(managed, "poll-deadline-select");
  const values = [];
  select.querySelectorAll("option").forEach((option) => values.push(option.value));
  assert.deepEqual(values, ["", "3600", "86400", "604800", "2592000"]);
  assert.equal(findByClass(managed, "poll-deadline-save").dataset.action, "poll-deadline");
  const closedManaged = renderPollBlock({ ...base, closed: true, canManage: true, closesAt: null }, doc, { id: 1 });
  assert.equal(countByClass(closedManaged, "poll-deadline-select"), 0, "no deadline control once closed");
});

test("formatClosesIn: relative wording in the reader's locale; empty for missing/past", () => {
  const nowMs = Date.parse("2026-11-22T12:00:00Z");
  assert.equal(formatClosesIn(null, nowMs, "en"), "");
  assert.equal(formatClosesIn("2026-11-22T11:00:00Z", nowMs, "en"), "");
  assert.equal(formatClosesIn("nope", nowMs, "en"), "");
  assert.match(formatClosesIn("2026-11-22T12:30:00Z", nowMs, "en"), /30 minutes/);
  assert.match(formatClosesIn("2026-11-24T12:00:00Z", nowMs, "en"), /2 days/);
  assert.match(formatClosesIn("2026-11-24T12:00:00Z", nowMs, "de"), /2 Tagen/);
  const ms = bestOf(() => { for (let i = 0; i < 200; i++) formatClosesIn("2026-11-24T12:00:00Z", nowMs, "en"); });
  assert.ok(ms < 200, "formatClosesIn stays cheap: " + ms);
});

test("source pins: no innerHTML-family sinks; composer and post route send closesIn; profile wires the routes", () => {
  for (const file of ["public/js/profile-extras.js", "public/js/polls.js", "public/js/routes/profile.js"]) {
    assert.doesNotMatch(read(file), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, file);
  }
  const composer = read("public/js/routes/composer.js");
  assert.match(composer, /closesIn/);
  const post = read("public/js/routes/post.js");
  assert.match(post, /"poll-deadline"/);
  const profile = read("public/js/routes/profile.js");
  for (const needle of ["/api/me/profile-pin", "/api/me/status", "\"profile-status\"", "\"profile-pin\"", "\"profile-unpin\"", "\"profile-status-clear\""]) {
    assert.ok(profile.includes(needle), needle);
  }
  assert.match(read("public/index.html"), /id="poll-closes"/);
});
