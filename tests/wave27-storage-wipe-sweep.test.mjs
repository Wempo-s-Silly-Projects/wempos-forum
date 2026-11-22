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

// Wave 2026-11-21-27 F1 (privacy): static sweep for browser storage. Every
// public/js module that WRITES storage (setItem) is either a device
// preference listed below with a reason, or an account-scoped family whose
// exported clearAll…() is imported by routes/account-nav.js and called inside
// wipeAccountLocalData(). A new family that forgets the sign-out wipe fails
// here before it can leave one member's data for the next on a shared browser.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const JS_ROOT = new URL("../public/js/", import.meta.url).pathname;
const VENDOR_DIR = "vendor";
// Wave 31: also dot-assignment (`localStorage.key = v`); `==` compares are not writes.
const STORAGE_WRITE = /\b(?:setItem\s*\(|(?:local|session)Storage\s*(?:\[[^\]]+\]|\.(?!getItem|setItem|removeItem|clear|key|length)\w+)\s*=(?!=))/;
const ACCOUNT_SCOPE = /":u"/;

// Device preferences: shared by everyone on the browser, kept on sign-out.
const DEVICE_PREF_FILES = new Map([
  ["theme.js", "light/dark theme choice"],
  ["text-size.js", "reader text size"],
  ["reading-comfort.js", "line spacing and always-underline links (wave 5.27)"],
  ["high-contrast.js", "high contrast Auto/On/Off (wave 5.27)"],
  ["tab-unread.js", "unread count in the tab title on/off"],
  ["routes/feed.js", "square/round corners preference"],
  ["dm-effects.js", "DM effects on/off"],
  ["i18n.js", "interface language"],
  ["appearance-reset.js", "corners, text size and tab-title count back to defaults (wave 5.7)"],
  ["global-keys.js", "single-key shortcuts on/off (Batch J)"],
]);

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  if (statSync(full).isDirectory()) return name === VENDOR_DIR ? [] : walk(full);
  return name.endsWith(".js") ? [full] : [];
});

// Batch K: IndexedDB through the vendored idb-keyval is storage too — any
// module importing it is a writer and must register its clearAll in the wipe.
const IDB_WRITE = /from\s*"(?:\.\.?\/)+vendor\/idb-keyval\.js"/;

const sources = new Map(walk(JS_ROOT).map((full) => [relative(JS_ROOT, full), readFileSync(full, "utf8")]));
const writers = [...sources].filter(([, src]) => STORAGE_WRITE.test(src) || IDB_WRITE.test(src)).map(([path]) => path);
const idbWriters = [...sources].filter(([, src]) => IDB_WRITE.test(src)).map(([path]) => path);

test("the IndexedDB rule catches idb-keyval importers, and drafts.js is one", () => {
  assert.ok(IDB_WRITE.test('import { set } from "./vendor/idb-keyval.js";'));
  assert.ok(IDB_WRITE.test('import { set } from "../vendor/idb-keyval.js";'));
  assert.ok(!IDB_WRITE.test('import { api } from "./api.js";'));
  assert.ok(idbWriters.includes("drafts.js"), "drafts.js keeps drafts in IndexedDB: " + idbWriters.join(", "));
  assert.ok(idbWriters.every((path) => !DEVICE_PREF_FILES.has(path)), "IndexedDB stores are account data, never device prefs");
});

const NAV = sources.get("routes/account-nav.js");
const wipeBody = NAV.match(/function wipeAccountLocalData\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
// name -> module path (relative to public/js) for every clearAll import.
const wipeImports = new Map([...NAV.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\.\/([^"]+)"/g)]
  .flatMap(([, names, from]) => names.split(",").map((name) => name.trim())
    .filter((name) => name.startsWith("clearAll")).map((name) => [name, from])));
const calledInWipe = (name) => new RegExp("\\b" + name + "\\(\\)").test(wipeBody);

test("the write pattern catches every storage write shape and skips reads", () => {
  for (const write of ['storage.setItem("k", v)', 'localStorage["k"] = v', "sessionStorage.k = v", "localStorage.draft=v"]) {
    assert.ok(STORAGE_WRITE.test(write), write);
  }
  for (const read of ['localStorage.getItem("k")', "localStorage.length === 0", "if (localStorage.k == null) {}"]) {
    assert.ok(!STORAGE_WRITE.test(read), read);
  }
});

test("the wipe function and its imports are where the sweep expects them", () => {
  assert.ok(wipeBody.trim(), "wipeAccountLocalData() body not found in routes/account-nav.js");
  assert.ok(wipeImports.size >= 6, "expected the clearAll… imports in account-nav.js");
  assert.ok(writers.length >= 6, "sweep found too few storage writers: " + writers.join(", "));
});

test("every account-scoped storage writer registers a clearAll in the sign-out wipe", () => {
  const unregistered = writers.filter((path) => !DEVICE_PREF_FILES.has(path)).filter((path) => {
    const exported = [...sources.get(path).matchAll(/export\s+(?:async\s+)?(?:function\s+|const\s+)(clearAll\w+)/g)]
      .map((match) => match[1]);
    return !exported.some((name) => wipeImports.get(name) === path && calledInWipe(name));
  });
  assert.deepEqual(unregistered, [],
    "storage written without a clearAll…() called in wipeAccountLocalData(): " + unregistered.join(", "));
});

test("no device-preference file builds an account-scoped (:u) key", () => {
  const scoped = [...DEVICE_PREF_FILES.keys()].filter((path) => ACCOUNT_SCOPE.test(sources.get(path) ?? ""));
  assert.deepEqual(scoped, []);
});

test("the device-preference list has no dead entries", () => {
  const dead = [...DEVICE_PREF_FILES.keys()].filter((path) => !writers.includes(path));
  assert.deepEqual(dead, [], "listed as a device preference but writes no storage: " + dead.join(", "));
});

test("every clearAll imported into account-nav is called by the wipe", () => {
  const uncalled = [...wipeImports.keys()].filter((name) => !calledInWipe(name));
  assert.deepEqual(uncalled, []);
});
