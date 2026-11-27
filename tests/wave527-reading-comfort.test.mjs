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

// Wave 5.27 F1 (reading comfort: line spacing + always-underline links) and
// F2 (high contrast Auto/On/Off). Client-only device preferences stored like
// the reader text size: same storage, same "forum-" naming, same decision to
// survive sign-out, painted before first paint by theme-preload.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  LINE_SPACINGS, LINE_SPACING_STORAGE_KEY, LINK_UNDERLINE_STORAGE_KEY,
  applyLineSpacing, applyLinkUnderline, createLineSpacingPicker, createLinkUnderlineToggle,
  normalizeLineSpacing, readLineSpacing, readLinkUnderline,
} from "../public/js/reading-comfort.js";
import {
  CONTRAST_MODES, CONTRAST_STORAGE_KEY, HIGH_CONTRAST_CLASS, applyContrast, createContrastPicker,
  isHighContrast, normalizeContrast, prefersMoreContrast, readContrast,
} from "../public/js/high-contrast.js";
import { TEXT_SIZE_STORAGE_KEY } from "../public/js/text-size.js";
import { clearAllCatchUp } from "../public/js/catch-up.js";
import { clearAllPins } from "../public/js/chat-pins.js";
import { clearAllMutes } from "../public/js/chat-mutes.js";
import { clearAllDrafts } from "../public/js/drafts.js";
import { clearAllRecents } from "../public/js/gallery-picks.js";
import { clearAllNewcomer } from "../public/js/newcomer.js";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const memoryStorage = (seed = {}) => {
  const data = new Map(Object.entries(seed));
  return {
    get length() { return data.size; },
    key: (index) => Array.from(data.keys())[index] ?? null,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    data,
  };
};
const throwingStorage = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
};
const fakeDoc = () => makeFakeDocument({ documentElement: new FakeNode("html") });
const mediaWindow = (matches) => {
  const queries = [];
  return { queries, matchMedia: (query) => { queries.push(query); return { matches, media: query }; } };
};
const selectIn = (node) => Array.from(node.children).find((child) => child.tagName === "SELECT");
const checkboxIn = (node) => Array.from(node.children).find((child) => child.tagName === "INPUT");

// --- F1: line spacing ----------------------------------------------------------

test("line spacing: three choices, unknown folds to default, blocked storage reads default", () => {
  assert.equal(LINE_SPACING_STORAGE_KEY, "forum-line-spacing");
  assert.deepEqual([...LINE_SPACINGS], ["default", "relaxed", "spacious"]);
  assert.ok(Object.isFrozen(LINE_SPACINGS));
  assert.equal(normalizeLineSpacing("relaxed"), "relaxed");
  assert.equal(normalizeLineSpacing("spacious"), "spacious");
  assert.equal(normalizeLineSpacing("huge"), "default");
  assert.equal(normalizeLineSpacing(null), "default");
  assert.equal(readLineSpacing(memoryStorage()), "default");
  assert.equal(readLineSpacing(memoryStorage({ [LINE_SPACING_STORAGE_KEY]: "spacious" })), "spacious");
  assert.equal(readLineSpacing(throwingStorage), "default");
  assert.equal(readLineSpacing(null), "default");
});

test("applyLineSpacing paints data-line-spacing for each option and normalizes junk", () => {
  const doc = fakeDoc();
  for (const value of LINE_SPACINGS) {
    applyLineSpacing(doc, value);
    assert.equal(doc.documentElement.dataset.lineSpacing, value);
  }
  applyLineSpacing(doc, "bogus");
  assert.equal(doc.documentElement.dataset.lineSpacing, "default");
});

test("line spacing picker shows the stored choice; a change stores and applies it", async () => {
  const storage = memoryStorage({ [LINE_SPACING_STORAGE_KEY]: "relaxed" });
  const doc = fakeDoc();
  const picker = createLineSpacingPicker(doc, storage);
  const select = selectIn(picker);
  assert.equal(select.children.length, 3);
  assert.deepEqual(Array.from(select.children).map((option) => option.value), ["default", "relaxed", "spacious"]);
  assert.ok(Array.from(select.children).every((option) => option.textContent.trim().length > 0));
  assert.equal(select.value, "relaxed");
  assert.equal(picker.getAttribute("for"), select.id);
  select.value = "spacious";
  await select.fire("change");
  assert.equal(storage.data.get(LINE_SPACING_STORAGE_KEY), "spacious");
  assert.equal(doc.documentElement.dataset.lineSpacing, "spacious");
  const blocked = createLineSpacingPicker(doc, throwingStorage);
  assert.equal(selectIn(blocked).value, "default");
  selectIn(blocked).value = "relaxed";
  await assert.doesNotReject(selectIn(blocked).fire("change"));
  assert.equal(doc.documentElement.dataset.lineSpacing, "relaxed", "applies for this page view even when storage is blocked");
});

// --- F1: always underline links ---------------------------------------------------

test("link underline: off by default, 'on' only when stored as on, blocked storage reads off", () => {
  assert.equal(LINK_UNDERLINE_STORAGE_KEY, "forum-link-underline");
  assert.equal(readLinkUnderline(memoryStorage()), false);
  assert.equal(readLinkUnderline(memoryStorage({ [LINK_UNDERLINE_STORAGE_KEY]: "on" })), true);
  assert.equal(readLinkUnderline(memoryStorage({ [LINK_UNDERLINE_STORAGE_KEY]: "yes" })), false);
  assert.equal(readLinkUnderline(throwingStorage), false);
  const doc = fakeDoc();
  applyLinkUnderline(doc, true);
  assert.equal(doc.documentElement.dataset.linkUnderline, "on");
  applyLinkUnderline(doc, false);
  assert.equal(doc.documentElement.dataset.linkUnderline, "off");
});

test("link underline checkbox reflects storage; toggling stores on/off and applies it", async () => {
  const storage = memoryStorage({ [LINK_UNDERLINE_STORAGE_KEY]: "on" });
  const doc = fakeDoc();
  const toggle = createLinkUnderlineToggle(doc, storage);
  const box = checkboxIn(toggle);
  assert.equal(box.type, "checkbox");
  assert.equal(box.checked, true);
  assert.ok(toggle.textContent.trim().length > 0);
  box.checked = false;
  await box.fire("change");
  assert.equal(storage.data.get(LINK_UNDERLINE_STORAGE_KEY), "off");
  assert.equal(doc.documentElement.dataset.linkUnderline, "off");
  box.checked = true;
  await box.fire("change");
  assert.equal(storage.data.get(LINK_UNDERLINE_STORAGE_KEY), "on");
  assert.equal(doc.documentElement.dataset.linkUnderline, "on");
  assert.doesNotThrow(() => createLinkUnderlineToggle(doc, throwingStorage));
});

// --- F2: high contrast --------------------------------------------------------------

test("contrast: Auto/On/Off, default auto, junk folds to auto, blocked storage reads auto", () => {
  assert.equal(CONTRAST_STORAGE_KEY, "forum-contrast");
  assert.deepEqual([...CONTRAST_MODES], ["auto", "on", "off"]);
  assert.ok(Object.isFrozen(CONTRAST_MODES));
  assert.equal(normalizeContrast("on"), "on");
  assert.equal(normalizeContrast("off"), "off");
  assert.equal(normalizeContrast("max"), "auto");
  assert.equal(readContrast(memoryStorage()), "auto");
  assert.equal(readContrast(memoryStorage({ [CONTRAST_STORAGE_KEY]: "off" })), "off");
  assert.equal(readContrast(throwingStorage), "auto");
});

test("auto follows prefers-contrast: more (stubbed matchMedia); on forces it; off disables it", () => {
  const wants = mediaWindow(true);
  const doesNot = mediaWindow(false);
  assert.equal(prefersMoreContrast(wants), true);
  assert.deepEqual(wants.queries, ["(prefers-contrast: more)"]);
  assert.equal(prefersMoreContrast(doesNot), false);
  assert.equal(prefersMoreContrast({}), false, "no matchMedia: no preference");
  assert.equal(prefersMoreContrast({ matchMedia() { throw new Error("nope"); } }), false);
  assert.equal(isHighContrast("auto", wants), true);
  assert.equal(isHighContrast("auto", doesNot), false);
  assert.equal(isHighContrast("on", doesNot), true);
  assert.equal(isHighContrast("off", wants), false);
});

test("applyContrast sets data-contrast and toggles the high-contrast root class", () => {
  assert.equal(HIGH_CONTRAST_CLASS, "high-contrast");
  const doc = fakeDoc();
  const cases = [
    ["on", mediaWindow(false), true],
    ["off", mediaWindow(true), false],
    ["auto", mediaWindow(true), true],
    ["auto", mediaWindow(false), false],
    ["junk", mediaWindow(false), false],
  ];
  for (const [mode, win, expected] of cases) {
    applyContrast(doc, mode, win);
    assert.equal(doc.documentElement.dataset.contrast, normalizeContrast(mode), mode);
    assert.equal(doc.documentElement.classList.contains(HIGH_CONTRAST_CLASS), expected, `${mode} ${expected}`);
  }
});

test("contrast picker shows the stored mode; a change stores and applies it", async () => {
  const storage = memoryStorage({ [CONTRAST_STORAGE_KEY]: "on" });
  const doc = fakeDoc();
  const win = mediaWindow(false);
  const picker = createContrastPicker(doc, storage, win);
  const select = selectIn(picker);
  assert.deepEqual(Array.from(select.children).map((option) => option.value), ["auto", "on", "off"]);
  assert.equal(select.value, "on");
  select.value = "off";
  await select.fire("change");
  assert.equal(storage.data.get(CONTRAST_STORAGE_KEY), "off");
  assert.equal(doc.documentElement.classList.contains(HIGH_CONTRAST_CLASS), false);
  select.value = "on";
  await select.fire("change");
  assert.equal(doc.documentElement.classList.contains(HIGH_CONTRAST_CLASS), true);
  assert.doesNotThrow(() => createContrastPicker(doc, throwingStorage, win));
});

// --- survive-or-wipe: the same list as the reader text size ---------------------------

const NEW_KEYS = [LINE_SPACING_STORAGE_KEY, LINK_UNDERLINE_STORAGE_KEY, CONTRAST_STORAGE_KEY];

test("the new keys are device preferences like forum-text-size: every sign-out wipe keeps them", () => {
  const prefs = {
    [TEXT_SIZE_STORAGE_KEY]: "larger",
    [LINE_SPACING_STORAGE_KEY]: "spacious",
    [LINK_UNDERLINE_STORAGE_KEY]: "on",
    [CONTRAST_STORAGE_KEY]: "on",
  };
  const storage = memoryStorage({ ...prefs, "forum-draft:u7:reply:12": "x", "forum-chat-pins:u7": "[]" });
  for (const clear of [clearAllCatchUp, clearAllPins, clearAllMutes, clearAllDrafts, clearAllRecents, clearAllNewcomer]) {
    clear(storage);
  }
  assert.deepEqual(Object.fromEntries(storage.data), prefs);
  for (const key of NEW_KEYS) assert.doesNotMatch(key, /:u\d|^forum-(draft|chat|seen|gallery|newcomer)/);
});

test("the storage sweep lists both new modules beside text-size.js in DEVICE_PREF_FILES", () => {
  const sweep = read("tests/wave27-storage-wipe-sweep.test.mjs");
  const list = sweep.match(/const DEVICE_PREF_FILES = new Map\(\[([\s\S]*?)\]\);/)[1];
  for (const path of ["text-size.js", "reading-comfort.js", "high-contrast.js"]) {
    assert.match(list, new RegExp(`\\["${path.replace(".", "\\.")}",`), path);
  }
});

// --- before first paint ---------------------------------------------------------------

const runPreload = ({ stored = {}, prefersMore = false } = {}) => {
  const root = new FakeNode("html");
  const listeners = [];
  const context = {
    localStorage: memoryStorage(stored),
    document: { documentElement: root },
    matchMedia: (query) => ({
      matches: query === "(prefers-contrast: more)" ? prefersMore : false,
      media: query,
      addEventListener: (type, fn) => listeners.push([query, type, fn]),
    }),
  };
  vm.runInNewContext(read("public/js/theme-preload.js"), context);
  return { root, listeners, context };
};

test("theme-preload paints line spacing, underline and contrast before first paint", () => {
  const plain = runPreload();
  assert.equal(plain.root.dataset.lineSpacing, undefined, "default needs no attribute");
  assert.equal(plain.root.dataset.linkUnderline, undefined);
  assert.equal(plain.root.classList.contains("high-contrast"), false);
  const set = runPreload({ stored: { "forum-line-spacing": "spacious", "forum-link-underline": "on", "forum-contrast": "on" } });
  assert.equal(set.root.dataset.lineSpacing, "spacious");
  assert.equal(set.root.dataset.linkUnderline, "on");
  assert.equal(set.root.dataset.contrast, "on");
  assert.equal(set.root.classList.contains("high-contrast"), true);
  const auto = runPreload({ prefersMore: true });
  assert.equal(auto.root.classList.contains("high-contrast"), true, "auto follows prefers-contrast: more");
  const off = runPreload({ stored: { "forum-contrast": "off" }, prefersMore: true });
  assert.equal(off.root.classList.contains("high-contrast"), false, "off overrides the device");
  const junk = runPreload({ stored: { "forum-line-spacing": "<b>", "forum-contrast": "max" } });
  assert.equal(junk.root.dataset.lineSpacing, undefined);
  assert.equal(junk.root.classList.contains("high-contrast"), false);
});

test("theme-preload follows a live prefers-contrast change while on Auto", () => {
  const { root, listeners, context } = runPreload();
  const contrast = listeners.find(([query, type]) => query === "(prefers-contrast: more)" && type === "change");
  assert.ok(contrast, "a change listener on (prefers-contrast: more)");
  contrast[2]({ matches: true });
  assert.equal(root.classList.contains("high-contrast"), true);
  context.localStorage.setItem("forum-contrast", "off");
  contrast[2]({ matches: true });
  assert.equal(root.classList.contains("high-contrast"), false);
});

test("theme-preload survives blocked storage and a missing matchMedia", () => {
  const root = new FakeNode("html");
  const context = { localStorage: throwingStorage, document: { documentElement: root } };
  assert.doesNotThrow(() => vm.runInNewContext(read("public/js/theme-preload.js"), context));
  assert.equal(root.classList.contains("high-contrast"), false);
});

// --- CSS + wiring + safety --------------------------------------------------------------

test("CSS: line spacing and underline rules, and a high-contrast override for light and dark", () => {
  const css = read("public/styles.css");
  assert.match(css, /:root\[data-line-spacing="relaxed"\]/);
  assert.match(css, /:root\[data-line-spacing="spacious"\]/);
  assert.match(css, /:root\[data-link-underline="on"\] a/);
  const light = css.match(/:root\.high-contrast \{([^}]*)\}/);
  assert.ok(light, "light high-contrast block");
  assert.match(light[1], /--ink:\s*#000000/);
  assert.match(light[1], /--paper:\s*#ffffff/);
  const dark = css.match(/:root\.high-contrast\[data-theme="dark"\] \{([^}]*)\}/);
  assert.ok(dark, "dark high-contrast block");
  assert.match(dark[1], /--ink:\s*#ffffff/);
  assert.match(dark[1], /--paper:\s*#000000/);
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\s*:root\.high-contrast:not\(\[data-theme="light"\]\):not\(\[data-theme="dark"\]\) \{/);
  assert.match(css, /:root\.high-contrast :where\(a, button, input, textarea, select, summary\):focus-visible/);
});

test("wiring: the reading-comfort controls sit in the Appearance panel (trim list #10); no innerHTML", () => {
  const feed = read("public/js/routes/feed.js");
  assert.match(feed, /createLineSpacingPicker\(document, storage\)/);
  assert.match(feed, /createLinkUnderlineToggle\(document, storage\)/);
  assert.match(feed, /createContrastPicker\(document, storage, window\)/);
  assert.match(feed, /appearance\.append\(createLineSpacingPicker\(document, storage\)\);/);
  assert.doesNotMatch(feed, /readingComfort\.title|account\.append\(readingComfort\)/, "no second display panel");
  for (const path of ["public/js/reading-comfort.js", "public/js/high-contrast.js", "public/js/theme-preload.js"]) {
    assert.doesNotMatch(read(path), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, path);
  }
});
