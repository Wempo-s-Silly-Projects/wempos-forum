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

// Wave 5.7 F3: "Reset appearance" in the account settings' Appearance panel.
// Writes this browser's appearance device prefs back to their defaults (never
// a removal: the wave 5.6 sweep pins device prefs out of every removal); no
// network, no account data, no new storage key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  APPEARANCE_DEFAULTS, APPEARANCE_KEYS, createAppearanceReset, resetAppearance,
} from "../public/js/appearance-reset.js";
import { TEXT_SIZE_STORAGE_KEY } from "../public/js/text-size.js";
import { TAB_UNREAD_STORAGE_KEY } from "../public/js/tab-unread.js";
import { THEME_STORAGE_KEY } from "../public/js/theme.js";
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
const fakeDoc = (title = SITE) => makeFakeDocument({
  title,
  documentElement: { dataset: { corners: "square", textSize: "larger" } },
});
const seeded = () => memoryStorage({
  "forum-corners": "square",
  [TEXT_SIZE_STORAGE_KEY]: "larger",
  [TAB_UNREAD_STORAGE_KEY]: "on",
  [THEME_STORAGE_KEY]: "dark",
  "forum-drafts:u7": "{}",
});

test("the three appearance keys, frozen; the theme is not one of them", () => {
  assert.deepEqual([...APPEARANCE_KEYS], ["forum-corners", TEXT_SIZE_STORAGE_KEY, TAB_UNREAD_STORAGE_KEY]);
  assert.ok(Object.isFrozen(APPEARANCE_KEYS));
  assert.ok(!APPEARANCE_KEYS.includes(THEME_STORAGE_KEY));
  assert.deepEqual({ ...APPEARANCE_DEFAULTS },
    { "forum-corners": "round", [TEXT_SIZE_STORAGE_KEY]: "default", [TAB_UNREAD_STORAGE_KEY]: "off" });
});

test("resetAppearance writes exactly those keys' defaults and restores the page", () => {
  const storage = seeded();
  const doc = fakeDoc("(5) " + SITE);
  resetAppearance(doc, storage);
  assert.deepEqual(Object.fromEntries(storage.data), {
    "forum-corners": "round",
    [TEXT_SIZE_STORAGE_KEY]: "default",
    [TAB_UNREAD_STORAGE_KEY]: "off",
    [THEME_STORAGE_KEY]: "dark",
    "forum-drafts:u7": "{}",
  });
  assert.equal(doc.documentElement.dataset.corners, "round");
  assert.equal(doc.documentElement.dataset.textSize, "default");
  assert.equal(doc.title, SITE);
});

test("resetAppearance survives blocked or missing storage and still resets the page", () => {
  for (const storage of [throwingStorage, null]) {
    const doc = fakeDoc("(2) " + SITE);
    assert.doesNotThrow(() => resetAppearance(doc, storage));
    assert.equal(doc.documentElement.dataset.corners, "round");
    assert.equal(doc.documentElement.dataset.textSize, "default");
    assert.equal(doc.title, SITE);
  }
});

test("button + status: clicking resets storage, unticks boxes, resets selects, says so", async () => {
  const doc = fakeDoc("(3) " + SITE);
  const storage = seeded();
  const panel = new FakeNode("section");
  const corners = new FakeNode("input");
  corners.type = "checkbox";
  corners.checked = true;
  const size = new FakeNode("select");
  size.value = "larger";
  const unread = new FakeNode("input");
  unread.type = "checkbox";
  unread.checked = true;
  panel.append(corners, size, unread);
  const reset = createAppearanceReset(doc, storage, panel);
  assert.equal(reset.tagName, "DIV");
  assert.equal(reset.className, "appearance-reset");
  const [button, status] = reset.children;
  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.type, "button");
  assert.equal(button.className, "button button-secondary");
  assert.equal(button.textContent, t("feed.resetAppearance"));
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.textContent, "");
  panel.append(reset);
  await button.fire("click");
  assert.equal(corners.checked, false);
  assert.equal(unread.checked, false);
  assert.equal(size.value, "default");
  assert.equal(storage.data.get("forum-corners"), "round");
  assert.equal(storage.data.get(THEME_STORAGE_KEY), "dark");
  assert.equal(doc.title, SITE);
  assert.equal(status.textContent, t("feed.appearanceResetDone"));
});

test("wiring: the Appearance panel carries the reset after its controls", () => {
  const feed = read("public/js/routes/feed.js");
  assert.match(feed, /import \{ createAppearanceReset \} from "\.\.\/appearance-reset\.js";/);
  assert.match(feed, /createTabUnreadToggle\(document, storage, \(\) => state\.unreadNotifications\)\);\n\s*appearance\.append\(createAppearanceReset\(document, storage, appearance\)\);/);
  assert.match(read("public/styles.css"), /\.appearance-reset \{/);
  assert.match(read("public/index.html"), /<link rel="modulepreload" href="\/js\/appearance-reset\.js">/);
});

test("device prefs only: no network, no innerHTML, no removal, no account-scoped key", () => {
  assert.doesNotMatch(read("public/js/appearance-reset.js"),
    /\bapi\(|fetch\(|innerHTML|sessionStorage|removeItem|\.clear\(|:u\$?\{?/);
});

test("wave 5.7 F3: both keys are in en.json and translated in all 73 other locales", () => {
  const dir = new URL("../public/locales/", import.meta.url);
  const en = JSON.parse(readFileSync(new URL("en.json", dir), "utf8"));
  const others = readdirSync(dir).filter((name) => name.endsWith(".json") && name !== "en.json");
  assert.equal(others.length, 73);
  for (const key of ["feed.resetAppearance", "feed.appearanceResetDone"]) {
    assert.equal(typeof en[key], "string", key);
    for (const name of others) {
      const messages = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
      assert.equal(typeof messages[key], "string", name + " " + key);
      assert.notEqual(messages[key], en[key], name + " " + key + " is untranslated");
    }
  }
});
