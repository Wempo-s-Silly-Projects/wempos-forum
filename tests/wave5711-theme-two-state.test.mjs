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

// v5.71.1: the theme toggle is two-state against the OS. Clicking to the
// opposite of the OS look stores that choice; clicking back to the OS look
// stops storing a manual choice, so the forum follows the OS again. The key
// is overwritten with a follow-the-OS value, never removed (the wave 5.6 pin
// keeps device prefs out of every storage removal).
import { test } from "node:test";
import assert from "node:assert/strict";
import { initTheme, resolveTheme, THEME_STORAGE_KEY } from "../public/js/theme.js";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

// rethemeTurnstile re-renders against the global document; give it one with
// no Turnstile slots.
globalThis.document ??= { querySelectorAll: () => [] };

const fakeStorage = (seed = {}) => {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
};

const fakeDoc = (osDark) => {
  const toggle = new FakeNode("button");
  const doc = makeFakeDocument({
    documentElement: { dataset: {} },
    defaultView: { matchMedia: () => ({ matches: osDark }) },
    querySelector: (selector) => (selector === "#theme-toggle" ? toggle : null),
    querySelectorAll: () => [],
  });
  return { doc, toggle };
};

const storedPreference = (storage) => {
  const value = storage.getItem(THEME_STORAGE_KEY);
  return value === "dark" || value === "light" ? value : null;
};

for (const osDark of [false, true]) {
  const os = osDark ? "dark" : "light";
  const opposite = osDark ? "light" : "dark";

  test(`OS ${os}: clicking to ${opposite} stores the manual choice`, () => {
    const storage = fakeStorage();
    const { doc, toggle } = fakeDoc(osDark);
    initTheme(doc, storage);
    assert.equal(doc.documentElement.dataset.theme, os);
    toggle.dispatch("click");
    assert.equal(doc.documentElement.dataset.theme, opposite);
    assert.equal(storage.getItem(THEME_STORAGE_KEY), opposite);
  });

  test(`OS ${os}: clicking back to ${os} drops the manual choice and follows the OS again`, () => {
    const storage = fakeStorage();
    const { doc, toggle } = fakeDoc(osDark);
    initTheme(doc, storage);
    toggle.dispatch("click");
    toggle.dispatch("click");
    assert.equal(doc.documentElement.dataset.theme, os);
    assert.equal(storedPreference(storage), null, "no manual dark/light choice is stored");
    // A later OS flip is followed on the next load.
    assert.equal(resolveTheme(storage.getItem(THEME_STORAGE_KEY), !osDark), opposite);
  });

  test(`OS ${os}: a stale stored ${os} choice is dropped when clicked away and back`, () => {
    const storage = fakeStorage({ [THEME_STORAGE_KEY]: os });
    const { doc, toggle } = fakeDoc(osDark);
    initTheme(doc, storage);
    toggle.dispatch("click");
    assert.equal(storage.getItem(THEME_STORAGE_KEY), opposite);
    toggle.dispatch("click");
    assert.equal(storedPreference(storage), null);
  });
}

test("blocked storage: clicking still flips the page theme", () => {
  const throwing = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
    removeItem: () => { throw new Error("blocked"); },
  };
  const { doc, toggle } = fakeDoc(false);
  initTheme(doc, throwing);
  assert.doesNotThrow(() => toggle.dispatch("click"));
  assert.equal(doc.documentElement.dataset.theme, "dark");
  assert.doesNotThrow(() => toggle.dispatch("click"));
  assert.equal(doc.documentElement.dataset.theme, "light");
});
