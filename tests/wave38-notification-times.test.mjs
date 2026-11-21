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

// Wave 2026-11-21-38 F2: each row on the Notifications page says when it
// arrived ("5 min. ago") in a <time datetime> stamp, localized by
// Intl.RelativeTimeFormat (no new strings). A grouped row shows its newest
// reply's time; a row without a parseable time shows none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeNode, makeFakeDocument, findByClass, countByClass } from "./helpers/fake-dom.mjs";
import { currentLocale, t } from "../public/js/i18n.js";
import { formatRelative } from "../public/js/reltime.js";
import { notificationItemView, renderNotificationsPage } from "../public/js/notifications.js";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
// Mid-minute offsets, so the minute rounding cannot flip between the render
// and the expectation computed a few ms later.
const agoIso = (minutes) => new Date(Date.now() - (minutes * 60 + 10) * 1000).toISOString();

const render = (items) => {
  const main = new FakeNode("main");
  main.ownerDocument = makeFakeDocument();
  return renderNotificationsPage(main, items);
};

test("notificationItemView carries createdAt through", () => {
  const iso = agoIso(5);
  assert.equal(notificationItemView({ id: 1, createdAt: iso, read: false }).createdAt, iso);
  assert.equal(notificationItemView({ id: 2, read: true }).createdAt, null);
});

test("a single row ends with a localized <time> stamp", () => {
  const iso = agoIso(5);
  const section = render([{ id: 1, targetPostId: 9, label: "You were mentioned by ana", createdAt: iso, read: false }]);
  const stamp = findByClass(section, "notification-time");
  assert.ok(stamp, "row has a time stamp");
  assert.equal(stamp.tagName, "TIME");
  assert.equal(stamp.getAttribute("datetime"), iso);
  assert.equal(stamp.textContent, formatRelative(iso, { locale: currentLocale() }));
  const row = findByClass(section, "notification-item");
  assert.equal(row.lastChild, stamp, "the stamp sits at the end of the row");
  assert.ok(row.textContent.startsWith(t("bell.unreadTag") + " You were mentioned by ana "), row.textContent);
});

test("a grouped thread row shows its newest reply's time", () => {
  const newest = agoIso(3);
  const section = render([
    { id: 7, targetPostId: 4, createdAt: newest, read: false },
    { id: 6, targetPostId: 4, createdAt: agoIso(50), read: false },
  ]);
  assert.equal(countByClass(section, "notification-group"), 1);
  assert.equal(countByClass(section, "notification-time"), 1);
  assert.equal(findByClass(section, "notification-time").getAttribute("datetime"), newest);
});

test("rows without a parseable time get no stamp", () => {
  const section = render([
    { id: 1, label: "Appeal approved", read: true },
    { id: 2, label: "Ping", createdAt: "not a date", read: true },
  ]);
  assert.equal(countByClass(section, "notification-item"), 2);
  assert.equal(countByClass(section, "notification-time"), 0);
});

test("the stamp is styled and built without innerHTML", () => {
  assert.match(read("public/styles.css"), /\.notification-time\s*\{/);
  assert.doesNotMatch(read("public/js/notifications.js"), /innerHTML|insertAdjacentHTML/);
});
