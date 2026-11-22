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

// Wave 5.25 F2: quiet hours (opt-in, device-local, default off). Inside the
// chosen local-time window, notification alerts (the unread count in the tab
// title, and any pop-up or sound) are held back; the in-page bell keeps
// updating. The setting is wiped on sign-out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  QUIET_HOURS_DEFAULT, QUIET_HOURS_STORAGE_KEY,
  clearAllQuietHours, createQuietHoursControls, isQuietHour, isQuietNow,
  notificationAlertsAllowed, readQuietHours, writeQuietHours,
} from "../public/js/quiet-hours.js";
import { TAB_UNREAD_STORAGE_KEY, applyTabUnread } from "../public/js/tab-unread.js";
import { makeFakeDocument, findByClass } from "./helpers/fake-dom.mjs";
import { bestOf } from "./helpers/timing.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fakeDocument = makeFakeDocument({ documentElement: { dataset: {} } });
const memoryStorage = (seed = {}) => {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    data,
  };
};
const throwingStorage = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
  removeItem() { throw new Error("blocked"); },
};
const at = (hour, minute = 0) => new Date(2026, 10, 21, hour, minute);
const stored = (settings) => memoryStorage({ [QUIET_HOURS_STORAGE_KEY]: JSON.stringify(settings) });

test("default is off: nothing stored means alerts always allowed", () => {
  assert.deepEqual(QUIET_HOURS_DEFAULT, { enabled: false, start: 22, end: 7 });
  const storage = memoryStorage();
  assert.deepEqual(readQuietHours(storage), QUIET_HOURS_DEFAULT);
  for (let hour = 0; hour < 24; hour += 1) assert.equal(notificationAlertsAllowed(storage, at(hour)), true);
  assert.equal(notificationAlertsAllowed(throwingStorage, at(23)), true, "blocked storage reads as off");
  assert.equal(notificationAlertsAllowed(null, at(23)), true);
});

test("a same-day window covers start up to (not including) end", () => {
  assert.equal(isQuietHour(9, 9, 17), true);
  assert.equal(isQuietHour(16, 9, 17), true);
  assert.equal(isQuietHour(17, 9, 17), false);
  assert.equal(isQuietHour(8, 9, 17), false);
});

test("a window that crosses midnight (22 -> 7) works on both sides", () => {
  for (const hour of [22, 23, 0, 3, 6]) assert.equal(isQuietHour(hour, 22, 7), true, String(hour));
  for (const hour of [7, 8, 12, 21]) assert.equal(isQuietHour(hour, 22, 7), false, String(hour));
  assert.equal(isQuietNow({ enabled: true, start: 22, end: 7 }, at(23, 59)), true);
  assert.equal(isQuietNow({ enabled: true, start: 22, end: 7 }, at(7, 0)), false);
});

test("start equal to end is an empty window, and a switched-off window is never quiet", () => {
  for (let hour = 0; hour < 24; hour += 1) assert.equal(isQuietHour(hour, 5, 5), false);
  assert.equal(isQuietNow({ enabled: false, start: 0, end: 23 }, at(12)), false);
});

test("alerts are held back only inside the window (local device time)", () => {
  const storage = stored({ enabled: true, start: 22, end: 7 });
  assert.equal(notificationAlertsAllowed(storage, at(23)), false);
  assert.equal(notificationAlertsAllowed(storage, at(2)), false);
  assert.equal(notificationAlertsAllowed(storage, at(7)), true);
  assert.equal(notificationAlertsAllowed(storage, at(15)), true);
});

test("persistence: write then read round-trips; junk and out-of-range values fold to defaults", () => {
  const storage = memoryStorage();
  writeQuietHours(storage, { enabled: true, start: 23, end: 6 });
  assert.deepEqual(readQuietHours(storage), { enabled: true, start: 23, end: 6 });
  assert.deepEqual(JSON.parse(storage.data.get(QUIET_HOURS_STORAGE_KEY)), { enabled: true, start: 23, end: 6 });
  for (const raw of ["{", "null", "[]", "\"on\"", JSON.stringify({ enabled: "yes", start: 24, end: -1 }),
    JSON.stringify({ enabled: true, start: 1.5, end: "7" })]) {
    const value = readQuietHours(memoryStorage({ [QUIET_HOURS_STORAGE_KEY]: raw }));
    assert.equal(typeof value.enabled, "boolean", raw);
    assert.ok(Number.isInteger(value.start) && value.start >= 0 && value.start <= 23, raw);
    assert.ok(Number.isInteger(value.end) && value.end >= 0 && value.end <= 23, raw);
  }
  assert.doesNotThrow(() => writeQuietHours(throwingStorage, { enabled: true, start: 1, end: 2 }));
});

test("clearAllQuietHours removes the key and tolerates blocked storage", () => {
  const storage = stored({ enabled: true, start: 22, end: 7 });
  clearAllQuietHours(storage);
  assert.equal(storage.data.has(QUIET_HOURS_STORAGE_KEY), false);
  assert.doesNotThrow(() => clearAllQuietHours(throwingStorage));
  assert.doesNotThrow(() => clearAllQuietHours(null));
});

test("sign-out wipe includes the quiet-hours key", () => {
  const nav = read("public/js/routes/account-nav.js");
  assert.match(nav, /import \{ clearAllQuietHours \} from "\.\.\/quiet-hours\.js";/);
  const wipe = nav.match(/function wipeAccountLocalData\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(wipe, /\bclearAllQuietHours\(\)/);
});

test("the tab-title unread count is held back inside quiet hours and shown outside", () => {
  const storage = stored({ enabled: true, start: 22, end: 7 });
  storage.setItem(TAB_UNREAD_STORAGE_KEY, "on");
  const doc = { title: "Wempo's Forum" };
  applyTabUnread(doc, 3, storage, at(23));
  assert.equal(doc.title, "Wempo's Forum");
  applyTabUnread(doc, 3, storage, at(12));
  assert.equal(doc.title, "(3) Wempo's Forum");
  applyTabUnread(doc, 4, storage, at(1));
  assert.equal(doc.title, "Wempo's Forum", "entering quiet hours strips a shown count");
});

test("in-page badge updates are untouched: updateBell still sets the badge before the title gate", () => {
  const source = read("public/js/notifications.js");
  const body = source.match(/export function updateBell\(unreadCount\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(body, /badge\.hidden = count === 0;/);
  assert.doesNotMatch(body, /notificationAlertsAllowed/);
});

test("settings controls: off by default, switch and hour selects persist the choice", () => {
  const storage = memoryStorage();
  let changes = 0;
  const controls = createQuietHoursControls(fakeDocument, storage, { onChange: () => { changes += 1; } });
  const box = findByClass(controls, "quiet-hours-switch");
  const start = findByClass(controls, "quiet-hours-start");
  const end = findByClass(controls, "quiet-hours-end");
  assert.equal(box.type, "checkbox");
  assert.equal(box.checked, false);
  assert.equal(start.children.length, 24);
  assert.equal(end.children.length, 24);
  assert.equal(start.value, "22");
  assert.equal(end.value, "7");
  assert.equal(storage.data.size, 0, "rendering stores nothing");
  box.checked = true;
  box.dispatch("change");
  start.value = "21";
  start.dispatch("change");
  end.value = "6";
  end.dispatch("change");
  assert.deepEqual(readQuietHours(storage), { enabled: true, start: 21, end: 6 });
  assert.equal(changes, 3);
  const again = createQuietHoursControls(fakeDocument, storage);
  assert.equal(findByClass(again, "quiet-hours-switch").checked, true);
  assert.equal(findByClass(again, "quiet-hours-start").value, "21");
});

test("settings mounts the quiet-hours panel with its title and help", () => {
  const feed = read("public/js/routes/feed.js");
  assert.match(feed, /createPanel\(t\("quietHours\.title"\), t\("quietHours\.help"\)\)/);
  assert.match(feed, /createQuietHoursControls\(document, storage,/);
});

test("the quiet-hours check stays cheap (it runs on every title update)", () => {
  const storage = stored({ enabled: true, start: 22, end: 7 });
  const ms = bestOf(() => { for (let index = 0; index < 1000; index += 1) notificationAlertsAllowed(storage, at(index % 24)); });
  assert.ok(ms < 50, "1000 checks took " + ms + " ms");
});
