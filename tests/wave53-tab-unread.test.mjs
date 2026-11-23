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

// Wave 5.3 F2: opt-in unread count in the browser tab title. A device pref
// (stored only in this browser), off by default, no network call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  TAB_UNREAD_CAP, TAB_UNREAD_STORAGE_KEY, applyTabUnread, createTabUnreadToggle, normaliseTabCount,
  readTabUnread, stripUnreadPrefix, titleWithUnread,
} from "../public/js/tab-unread.js";
import { t } from "../public/js/i18n.js";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const SITE = "Wempo's Forum";
const memoryStorage = (seed = {}) => {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    data,
  };
};
const throwingStorage = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
};
const docWithTitle = (title) => ({ ...makeFakeDocument(), title });

test("titleWithUnread prefixes the count, caps at 99+, and never stacks prefixes", () => {
  assert.equal(titleWithUnread(SITE, 3), "(3) " + SITE);
  assert.equal(titleWithUnread(SITE, TAB_UNREAD_CAP), "(99) " + SITE);
  assert.equal(titleWithUnread(SITE, TAB_UNREAD_CAP + 1), "(99+) " + SITE);
  assert.equal(titleWithUnread("(3) " + SITE, 5), "(5) " + SITE);
  assert.equal(titleWithUnread("(99+) " + SITE, 0), SITE);
  assert.equal(titleWithUnread(titleWithUnread(SITE, 2), 2), "(2) " + SITE);
});

test("bad counts read as zero; a title that merely starts with a bracket is kept", () => {
  for (const bad of [0, -1, 1.5, NaN, "x", null, undefined, Number.MAX_SAFE_INTEGER + 2]) {
    assert.equal(normaliseTabCount(bad), 0, String(bad));
    assert.equal(titleWithUnread(SITE, bad), SITE, String(bad));
  }
  assert.equal(normaliseTabCount("4"), 4);
  assert.equal(stripUnreadPrefix("(beta) notes"), "(beta) notes");
  assert.equal(stripUnreadPrefix(undefined), "");
});

test("off by default: only an explicit 'on' enables it, and blocked storage reads off", () => {
  assert.equal(readTabUnread(memoryStorage()), false);
  assert.equal(readTabUnread(memoryStorage({ [TAB_UNREAD_STORAGE_KEY]: "off" })), false);
  assert.equal(readTabUnread(memoryStorage({ [TAB_UNREAD_STORAGE_KEY]: "on" })), true);
  assert.equal(readTabUnread(throwingStorage), false);
  assert.equal(readTabUnread(null), false);
});

test("applyTabUnread: prefixes only when enabled, and clears an old prefix when off", () => {
  const on = docWithTitle(SITE);
  applyTabUnread(on, 7, memoryStorage({ [TAB_UNREAD_STORAGE_KEY]: "on" }));
  assert.equal(on.title, "(7) " + SITE);
  applyTabUnread(on, 0, memoryStorage({ [TAB_UNREAD_STORAGE_KEY]: "on" }));
  assert.equal(on.title, SITE);
  const off = docWithTitle("(4) " + SITE);
  applyTabUnread(off, 4, memoryStorage());
  assert.equal(off.title, SITE);
  assert.doesNotThrow(() => applyTabUnread(docWithTitle(SITE), 2, throwingStorage));
});

test("toggle: a labelled checkbox, unchecked by default, that saves and retitles at once", async () => {
  const storage = memoryStorage();
  const doc = docWithTitle(SITE);
  const toggle = createTabUnreadToggle(doc, storage, () => 12);
  assert.ok(toggle instanceof FakeNode);
  assert.equal(toggle.tagName, "LABEL");
  assert.equal(toggle.className, "tab-unread-pref");
  const box = toggle.children[0];
  assert.equal(box.tagName, "INPUT");
  assert.equal(box.type, "checkbox");
  assert.equal(box.checked, false);
  assert.equal(toggle.textContent, " " + t("feed.tabUnread"));
  box.checked = true;
  await box.fire("change");
  assert.equal(storage.data.get(TAB_UNREAD_STORAGE_KEY), "on");
  assert.equal(doc.title, "(12) " + SITE);
  box.checked = false;
  await box.fire("change");
  assert.equal(storage.data.get(TAB_UNREAD_STORAGE_KEY), "off");
  assert.equal(doc.title, SITE);
  const saved = createTabUnreadToggle(docWithTitle(SITE), memoryStorage({ [TAB_UNREAD_STORAGE_KEY]: "on" }), () => 0);
  assert.equal(saved.children[0].checked, true);
});

test("toggle survives blocked storage: the choice still applies to this page view", async () => {
  const doc = docWithTitle(SITE);
  const toggle = createTabUnreadToggle(doc, throwingStorage, () => 2);
  const box = toggle.children[0];
  box.checked = true;
  await box.fire("change");
  assert.equal(doc.title, "(2) " + SITE);
});

test("wiring: session count into state, applied after the route title, on bell updates, in Appearance", () => {
  const app = read("public/js/app.js");
  assert.match(app, /state\.unreadNotifications = session\.user \? normaliseTabCount\(session\.unreadNotifications\) : 0;/);
  assert.match(app, /setRouteTitle\(route\);\n\s*applyTabUnread\(document, state\.unreadNotifications, pageStorage\(\)\);/);
  assert.match(read("public/js/state.js"), /unreadNotifications: 0,/);
  assert.match(read("public/js/notifications.js"), /applyTabUnread\(document, count, pageStorage\(\)\)/);
  assert.match(read("public/js/routes/feed.js"),
    /createTabUnreadToggle\(document, storage, \(\) => state\.unreadNotifications\)/);
  assert.match(read("public/styles.css"), /\.tab-unread-pref,/);
  assert.match(read("public/index.html"), /<link rel="modulepreload" href="\/js\/tab-unread\.js">/);
});

test("page-local only: no network, no innerHTML, no account-scoped key", () => {
  const source = read("public/js/tab-unread.js");
  assert.doesNotMatch(source, /\bapi\(|fetch\(|XMLHttpRequest|innerHTML|sessionStorage|:u\$?\{?/);
});

test("wave 5.3: the new key is in en.json and translated in all 65 other locales", () => {
  const dir = new URL("../public/locales/", import.meta.url);
  const en = JSON.parse(readFileSync(new URL("en.json", dir), "utf8"));
  const others = readdirSync(dir).filter((name) => name.endsWith(".json") && name !== "en.json");
  assert.equal(others.length, 65);
  assert.equal(typeof en["feed.tabUnread"], "string");
  for (const name of others) {
    const messages = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
    assert.equal(typeof messages["feed.tabUnread"], "string", name);
    assert.notEqual(messages["feed.tabUnread"], en["feed.tabUnread"], name + " is untranslated");
  }
});
