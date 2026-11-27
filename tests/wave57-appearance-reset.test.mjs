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
// Writes this browser's display device prefs back to their defaults (never a
// removal: the wave 5.6 sweep pins device prefs out of every removal); no
// network, no account data, no new storage key. Trim list #10 widened it to
// every display choice (line spacing, underlined links, easy reading,
// contrast) and dropped the tab-title count, which moved to Notifications.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  APPEARANCE_DEFAULTS, APPEARANCE_KEYS, createAppearanceReset, resetAppearance,
} from "../public/js/appearance-reset.js";
import { TEXT_SIZE_STORAGE_KEY } from "../public/js/text-size.js";
import {
  EASY_READING_CLASS, EASY_READING_STORAGE_KEY, LINE_SPACING_STORAGE_KEY, LINK_UNDERLINE_STORAGE_KEY,
} from "../public/js/reading-comfort.js";
import { CONTRAST_STORAGE_KEY, HIGH_CONTRAST_CLASS } from "../public/js/high-contrast.js";
import { TAB_UNREAD_STORAGE_KEY } from "../public/js/tab-unread.js";
import { STRONG_LANGUAGE_STORAGE_KEY } from "../public/js/strong-language.js";
import { THEME_STORAGE_KEY } from "../public/js/theme.js";
import { t } from "../public/js/i18n.js";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
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
const noMoreContrast = { matchMedia: () => ({ matches: false }) };
const fakeDoc = () => {
  const root = new FakeNode("html");
  Object.assign(root.dataset, {
    corners: "square", textSize: "larger", lineSpacing: "spacious", linkUnderline: "on", contrast: "on",
  });
  root.classList.add(EASY_READING_CLASS, HIGH_CONTRAST_CLASS);
  return makeFakeDocument({ documentElement: root });
};
const EXPECTED_DEFAULTS = {
  "forum-corners": "round",
  [TEXT_SIZE_STORAGE_KEY]: "default",
  [LINE_SPACING_STORAGE_KEY]: "default",
  [LINK_UNDERLINE_STORAGE_KEY]: "off",
  [EASY_READING_STORAGE_KEY]: "off",
  [CONTRAST_STORAGE_KEY]: "auto",
};
const seeded = () => memoryStorage({
  "forum-corners": "square",
  [TEXT_SIZE_STORAGE_KEY]: "larger",
  [LINE_SPACING_STORAGE_KEY]: "spacious",
  [LINK_UNDERLINE_STORAGE_KEY]: "on",
  [EASY_READING_STORAGE_KEY]: "on",
  [CONTRAST_STORAGE_KEY]: "on",
  [TAB_UNREAD_STORAGE_KEY]: "on",
  [STRONG_LANGUAGE_STORAGE_KEY]: "on",
  [THEME_STORAGE_KEY]: "dark",
  "forum-drafts:u7": "{}",
});
const assertPageReset = (doc) => {
  const root = doc.documentElement;
  assert.equal(root.dataset.corners, "round");
  assert.equal(root.dataset.textSize, "default");
  assert.equal(root.dataset.lineSpacing, "default");
  assert.equal(root.dataset.linkUnderline, "off");
  assert.equal(root.dataset.contrast, "auto");
  assert.equal(root.classList.contains(EASY_READING_CLASS), false);
  assert.equal(root.classList.contains(HIGH_CONTRAST_CLASS), false);
};

test("the six display keys, frozen; the theme, tab count and strong-language filter are not among them", () => {
  assert.deepEqual([...APPEARANCE_KEYS], Object.keys(EXPECTED_DEFAULTS));
  assert.ok(Object.isFrozen(APPEARANCE_KEYS));
  for (const key of [THEME_STORAGE_KEY, TAB_UNREAD_STORAGE_KEY, STRONG_LANGUAGE_STORAGE_KEY]) {
    assert.ok(!APPEARANCE_KEYS.includes(key), key);
  }
  assert.deepEqual({ ...APPEARANCE_DEFAULTS }, EXPECTED_DEFAULTS);
});

test("resetAppearance writes exactly those keys' defaults and restores the page", () => {
  const storage = seeded();
  const doc = fakeDoc();
  resetAppearance(doc, storage, noMoreContrast);
  assert.deepEqual(Object.fromEntries(storage.data), {
    ...EXPECTED_DEFAULTS,
    [TAB_UNREAD_STORAGE_KEY]: "on",
    [STRONG_LANGUAGE_STORAGE_KEY]: "on",
    [THEME_STORAGE_KEY]: "dark",
    "forum-drafts:u7": "{}",
  });
  assertPageReset(doc);
});

test("resetAppearance survives blocked or missing storage and still resets the page", () => {
  for (const storage of [throwingStorage, null]) {
    const doc = fakeDoc();
    assert.doesNotThrow(() => resetAppearance(doc, storage, noMoreContrast));
    assertPageReset(doc);
  }
});

const select = (values, value) => {
  const node = new FakeNode("select");
  for (const option of values) {
    const item = new FakeNode("option");
    item.value = option;
    node.append(item);
  }
  node.value = value;
  return node;
};
const checkbox = (checked) => Object.assign(new FakeNode("input"), { type: "checkbox", checked });

test("button + status: clicking resets storage, unticks boxes, picks each select's first option, says so", async () => {
  const doc = fakeDoc();
  const storage = seeded();
  const panel = new FakeNode("section");
  const corners = checkbox(true);
  const size = select(["default", "large", "larger"], "larger");
  const underline = checkbox(true);
  const contrast = select(["auto", "on", "off"], "on");
  // The strong-language filter is a content choice: [data-reset="keep"].
  const keep = new FakeNode("label");
  keep.setAttribute("data-reset", "keep");
  const strong = checkbox(true);
  keep.append(strong);
  panel.append(corners, size, underline, contrast, keep);
  const reset = createAppearanceReset(doc, storage, panel, noMoreContrast);
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
  assert.equal(underline.checked, false);
  assert.equal(strong.checked, true, "a kept control is left alone");
  assert.equal(size.value, "default");
  assert.equal(contrast.value, "auto");
  assert.equal(storage.data.get("forum-corners"), "round");
  assert.equal(storage.data.get(STRONG_LANGUAGE_STORAGE_KEY), "on");
  assert.equal(storage.data.get(THEME_STORAGE_KEY), "dark");
  assertPageReset(doc);
  assert.equal(status.textContent, t("feed.appearanceResetDone"));
});

test("wiring: one Appearance panel carries every display control, the kept filter, then the reset", () => {
  const feed = read("public/js/routes/feed.js");
  assert.match(feed, /import \{ createAppearanceReset \} from "\.\.\/appearance-reset\.js";/);
  assert.match(feed, /strongLanguage\.dataset\.reset = "keep";\n\s*appearance\.append\(strongLanguage\);/);
  assert.match(feed, /appearance\.append\(strongLanguage\);\n[^\n]*\n\s*appearance\.append\(createAppearanceReset\(document, storage, appearance\)\);/);
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
