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

// Wave 2026-11-21-37 F3: "Unread only" on the Notifications page. A checkbox
// hides read rows in place; nothing stored, nothing sent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { FakeNode, makeFakeDocument, findByClass } from "./helpers/fake-dom.mjs";
import { t } from "../public/js/i18n.js";
import { applyUnreadOnly, createUnreadOnlyToggle } from "../public/js/notification-filter.js";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const NEW_KEYS = ["bell.unreadOnly", "bell.noUnread"];

const row = (unread) => {
  const node = new FakeNode("button");
  node.className = "notification-item" + (unread ? " notification-unread" : "");
  return node;
};

const pageWith = (...flags) => {
  const section = new FakeNode("section");
  const rows = flags.map(row);
  section.append(...rows);
  return { section, rows };
};

test("applyUnreadOnly hides read rows and restores them when turned off", () => {
  const { section, rows } = pageWith(false, true, false);
  const status = new FakeNode("p");
  applyUnreadOnly(section, status, true);
  assert.deepEqual(rows.map((node) => node.hidden), [true, false, true]);
  assert.equal(status.hidden, true);
  applyUnreadOnly(section, status, false);
  assert.deepEqual(rows.map((node) => node.hidden), [false, false, false]);
  assert.equal(status.hidden, true);
});

test("applyUnreadOnly shows the empty line when every row is read", () => {
  const { section } = pageWith(false, false);
  const status = new FakeNode("p");
  applyUnreadOnly(section, status, true);
  assert.equal(status.hidden, false);
  assert.equal(status.textContent, t("bell.noUnread"));
  applyUnreadOnly(section, status, false);
  assert.equal(status.hidden, true);
});

test("createUnreadOnlyToggle builds a labelled checkbox that filters on change", () => {
  const document = makeFakeDocument();
  const { section, rows } = pageWith(false, true);
  const toggle = createUnreadOnlyToggle(document, section);
  section.prepend(toggle);
  assert.equal(toggle.tagName, "DIV");
  const label = findByClass(toggle, "notifications-unread-only");
  assert.equal(label.tagName, "LABEL");
  const box = label.querySelector("input");
  assert.equal(box.type, "checkbox");
  assert.equal(box.checked, false);
  assert.match(label.textContent, new RegExp(t("bell.unreadOnly")));
  const status = findByClass(toggle, "notifications-unread-empty");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.hidden, true);
  box.checked = true;
  box.dispatch("change");
  assert.deepEqual(rows.map((node) => node.hidden), [true, false]);
  box.checked = false;
  box.dispatch("change");
  assert.deepEqual(rows.map((node) => node.hidden), [false, false]);
});

test("renderNotificationsPage wires the toggle only when there are rows", () => {
  const source = read("public/js/notifications.js");
  assert.match(source, /from "\.\/notification-filter\.js"/);
  assert.match(source, /createUnreadOnlyToggle\(document, section\)/);
  const emptyReturn = source.indexOf('t("bell.empty")');
  const wiring = source.indexOf("createUnreadOnlyToggle(document, section)");
  assert.ok(emptyReturn > 0 && wiring > emptyReturn, "toggle is added after the empty-state return");
  assert.match(read("public/styles.css"), /\.notifications-unread-only\s*\{/);
});

test("the filter module is page-view only: no storage, no requests, no innerHTML", () => {
  const source = read("public/js/notification-filter.js");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  assert.doesNotMatch(source, /api\(|fetch\(|XMLHttpRequest|sendBeacon/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML/);
});

test("wave 37: every new key is in en.json and translated in all 20 locales", () => {
  const dir = new URL("../public/locales/", import.meta.url);
  const en = JSON.parse(readFileSync(new URL("en.json", dir), "utf8"));
  const others = readdirSync(dir).filter((name) => name.endsWith(".json") && name !== "en.json");
  assert.equal(others.length, 64);
  for (const key of NEW_KEYS) {
    assert.equal(typeof en[key], "string", key);
    for (const name of others) {
      const messages = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
      assert.equal(typeof messages[key], "string", name + " " + key);
      assert.notEqual(messages[key], en[key], name + " " + key + " is untranslated");
    }
  }
});
