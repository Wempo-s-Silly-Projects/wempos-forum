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

// v5.96.0 Part C (brand review 2026-11-24): the help board's label is
// "Help & Bugs" (slug and URLs unchanged), and post, reply-preview and edit
// history times read relative ("2 hours ago"), with the full date in title.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { makeFakeDocument } from "./helpers/fake-dom.mjs";

globalThis.speechSynthesis ??= { speak() {}, cancel() {}, getVoices: () => [] };
globalThis.SpeechSynthesisUtterance ??= function Utterance() {};

const { formatPostTime, formatFullTime } = await import("../public/js/reltime.js");
const { createPostCard } = await import("../public/js/render.js");
const { BOARDS } = await import("../public/js/boards.js");
const { BOARD_HEADS } = await import("../api/boards.mjs");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const OLD_LABEL = "Bugs & Troubleshooting & Help";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-11-24T12:00:00.000Z");

test("C1: the help board label is 'Help & Bugs' everywhere; the slug stays help", () => {
  const en = JSON.parse(read("public/locales/en.json"));
  assert.equal(en["boards.helpLabel"], "Help & Bugs");
  assert.equal(BOARD_HEADS.help.label, "Help & Bugs");
  assert.ok(BOARDS.some((board) => board.slug === "help"));
  for (const file of readdirSync(new URL("../public/locales/", import.meta.url))) {
    const label = JSON.parse(read("public/locales/" + file))["boards.helpLabel"];
    assert.ok(label && !label.includes("Troubleshooting"), file + ": " + label);
  }
  for (const doc of ["README.md", "docs/using-the-forum.md", "docs/admin-guide.md"]) {
    assert.ok(!read(doc).includes(OLD_LABEL), doc + " still names the old label");
  }
});

test("C2: formatPostTime is relative for a week, then a short date; never seconds; future clamps to now", () => {
  assert.equal(formatPostTime(new Date(NOW - 2 * HOUR).toISOString(), { now: NOW, locale: "en" }), "2 hours ago");
  assert.equal(formatPostTime(new Date(NOW - 5 * 60 * 1000).toISOString(), { now: NOW, locale: "en" }), "5 minutes ago");
  assert.equal(formatPostTime(new Date(NOW - 3 * DAY).toISOString(), { now: NOW, locale: "en" }), "3 days ago");
  assert.equal(formatPostTime(new Date(NOW + HOUR).toISOString(), { now: NOW, locale: "en" }), "now");
  const old = formatPostTime("2026-11-10T09:30:45.000Z", { now: NOW, locale: "en" });
  assert.doesNotMatch(old, /ago|:/, old);
  assert.match(old, /Nov/);
  assert.equal(formatPostTime("not a date", { now: NOW, locale: "en" }), "");
  assert.match(formatPostTime(new Date(NOW - 2 * HOUR).toISOString(), { now: NOW, locale: "fr" }), /il y a 2 heures/);
  const full = formatFullTime("2026-11-10T09:30:45.000Z", "en");
  assert.match(full, /2026/);
  assert.doesNotMatch(full, /:45/, "no seconds");
});

test("C2: cards show the relative time, keep the machine time in datetime and the full date in title", () => {
  const doc = makeFakeDocument();
  const created = new Date(Date.now() - 2 * HOUR).toISOString();
  const activity = new Date(Date.now() - HOUR).toISOString();
  const card = createPostCard({
    id: 3, body: "hi", parent: null, visibility: "public", board: "general", createdAt: created, lastActivityAt: activity,
    author: { id: 2, username: "amy", role: null }, likeCount: 0, dislikeCount: 0, replyCount: 0, viewCount: 0,
  }, doc);
  const time = card.querySelector("time.post-time");
  assert.equal(time.textContent, formatPostTime(created));
  assert.equal(time.dateTime, activity, "datetime keeps the bump time");
  assert.equal(time.getAttribute("title"), formatFullTime(created));
  assert.doesNotMatch(read("public/js/render.js"), /toLocaleString\(/);
});
