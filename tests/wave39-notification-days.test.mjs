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

// Wave 2026-11-21-39 F2 — Day dividers on the Notifications page. Rows (newest
// first) sit under "Today", "Yesterday" and "Earlier" headings, decided on the
// member's own calendar day from each row's createdAt (a grouped row uses its
// newest reply). Rows with no parseable time join whatever section they fall
// in (no heading of their own). "Unread only" hides a heading whose rows are
// all hidden. Page-view only: nothing stored, nothing requested.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { FakeNode, makeFakeDocument, findByClass } from "./helpers/fake-dom.mjs";
import { t } from "../public/js/i18n.js";
import { notificationDayKey } from "../public/js/notification-days.js";
import { renderNotificationsPage } from "../public/js/notifications.js";
import { applyUnreadOnly } from "../public/js/notification-filter.js";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const NEW_KEYS = ["bell.dayToday", "bell.dayYesterday", "bell.dayEarlier"];

// Local wall-clock instants: day boundaries are the member's own midnight.
const local = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const NOW = new Date(2026, 10, 21, 0, 30).getTime(); // 00:30 local, just past midnight

test("notificationDayKey: today / yesterday / earlier on the local calendar", () => {
  assert.equal(notificationDayKey(local(2026, 11, 21, 0, 5), NOW), "today");
  assert.equal(notificationDayKey(local(2026, 11, 20, 23, 59), NOW), "yesterday");
  assert.equal(notificationDayKey(local(2026, 11, 20, 0, 0), NOW), "yesterday");
  assert.equal(notificationDayKey(local(2026, 11, 19, 23, 59), NOW), "earlier");
  assert.equal(notificationDayKey(local(2025, 1, 1, 12), NOW), "earlier");
});

test("notificationDayKey: a slightly-future stamp (clock skew) reads as today; junk reads as none", () => {
  assert.equal(notificationDayKey(local(2026, 11, 21, 3), NOW), "today");
  assert.equal(notificationDayKey(local(2026, 11, 23, 3), NOW), "today");
  for (const bad of [null, undefined, "", "not a date", 42, {}]) {
    assert.equal(notificationDayKey(bad, NOW), null, String(bad));
  }
});

const render = (items) => {
  const main = new FakeNode("main");
  main.ownerDocument = makeFakeDocument();
  return renderNotificationsPage(main, items);
};
const ago = (hours) => new Date(Date.now() - hours * 3600 * 1000).toISOString();
const dayHeadings = (section) => [...section.children]
  .filter((node) => String(node.className).split(" ").includes("notification-day"));
const order = (section) => [...section.children]
  .map((node) => {
    const classes = String(node.className).split(" ");
    if (classes.includes("notification-day")) return "H:" + node.dataset.day;
    if (classes.includes("notification-item")) return "R";
    return null;
  })
  .filter(Boolean);

test("render: a heading opens each day bucket once, in row order, translated", () => {
  const items = [
    { id: 5, label: "a", createdAt: ago(0.01), read: false },
    { id: 4, label: "b", createdAt: ago(0.02), read: true },
    { id: 3, label: "c", createdAt: ago(24 * 3), read: true },
    { id: 2, label: "d", createdAt: ago(24 * 9), read: false },
  ];
  const section = render(items);
  const keys = items.map((item) => notificationDayKey(item.createdAt, Date.now()));
  const expected = [];
  keys.forEach((key, index) => {
    if (index === 0 || key !== keys[index - 1]) expected.push("H:" + key);
    expected.push("R");
  });
  assert.deepEqual(order(section), expected);
  const first = dayHeadings(section)[0];
  assert.equal(first.tagName, "H2");
  assert.equal(first.textContent, t("bell.dayToday"));
  assert.ok(dayHeadings(section).every((h) => h.textContent === t(NEW_KEY_FOR[h.dataset.day])));
});
const NEW_KEY_FOR = { today: "bell.dayToday", yesterday: "bell.dayYesterday", earlier: "bell.dayEarlier" };

test("render: rows without a time add no heading; a grouped row uses its newest reply", () => {
  const none = render([{ id: 1, label: "Appeal approved", read: true }, { id: 2, label: "x", createdAt: "nope", read: true }]);
  assert.equal(dayHeadings(none).length, 0);
  const grouped = render([
    { id: 9, targetPostId: 4, createdAt: ago(0.01), read: false },
    { id: 8, targetPostId: 4, createdAt: ago(24 * 30), read: false },
  ]);
  assert.deepEqual(order(grouped), ["H:today", "R"]);
});

test("unread only: a heading with no unread rows hides, and comes back when switched off", () => {
  const section = render([
    { id: 3, label: "new", createdAt: ago(0.01), read: false },
    { id: 2, label: "old", createdAt: ago(24 * 9), read: true },
    { id: 1, label: "old2", createdAt: ago(24 * 10), read: true },
  ]);
  const status = findByClass(section, "notifications-unread-empty");
  const [today, earlier] = dayHeadings(section);
  applyUnreadOnly(section, status, true);
  assert.equal(today.hidden, false);
  assert.equal(earlier.hidden, true);
  applyUnreadOnly(section, status, false);
  assert.equal(earlier.hidden, false);
});

test("day dividers are page-view only, built with createElement, and styled", () => {
  const source = read("public/js/notification-days.js");
  assert.doesNotMatch(source, /localStorage|sessionStorage|api\(|fetch\(|innerHTML/);
  assert.match(read("public/styles.css"), /\.notification-day\s*\{/);
});

test("wave 39: every new key is in en.json and translated in all 20 locales", () => {
  const dir = new URL("../public/locales/", import.meta.url);
  const en = JSON.parse(readFileSync(new URL("en.json", dir), "utf8"));
  const others = readdirSync(dir).filter((name) => name.endsWith(".json") && name !== "en.json");
  assert.equal(others.length, 56);
  for (const key of NEW_KEYS) {
    assert.equal(typeof en[key], "string", key);
    for (const name of others) {
      const messages = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
      assert.equal(typeof messages[key], "string", name + " " + key);
      assert.notEqual(messages[key], en[key], name + " " + key + " is untranslated");
    }
  }
});
