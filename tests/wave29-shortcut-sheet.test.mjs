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

// Wave 2026-11-21-29 F2 (v4.34): a closed-by-default "Keyboard shortcuts"
// sheet beside the J/K hint on a thread page. It lists shortcuts the forum
// already has and binds none itself; nothing stored, nothing sent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeFakeDocument } from "./helpers/fake-dom.mjs";
import { SHORTCUT_ROWS, createShortcutSheet } from "../public/js/shortcut-sheet.js";
import { LOCALES } from "../public/js/i18n.js";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const NEW_KEYS = ["shortcuts.title", ...SHORTCUT_ROWS];

test("the sheet is a closed <details> with a summary and one row per shortcut", () => {
  const sheet = createShortcutSheet(makeFakeDocument());
  assert.equal(sheet.tagName, "DETAILS");
  assert.equal(sheet.className, "shortcut-sheet");
  assert.notEqual(sheet.open, true, "closed by default");
  const [summary, list] = sheet.children;
  assert.equal(summary.tagName, "SUMMARY");
  assert.ok(summary.textContent.length > 0);
  assert.equal(list.tagName, "UL");
  assert.equal(list.children.length, SHORTCUT_ROWS.length);
  for (const row of [...list.children]) {
    assert.equal(row.tagName, "LI");
    assert.ok(row.textContent.length > 0);
  }
});

test("every row names a shortcut the forum really wires", () => {
  const en = JSON.parse(read("public/locales/en.json"));
  assert.match(en["shortcuts.posts"], /^J \/ K:/);
  assert.match(read("public/js/post-keys.js"), /POST_KEY_STEPS = Object\.freeze\(\{ j: 1, k: -1 \}\)/);
  assert.match(en["shortcuts.submit"], /^Ctrl\+Enter/);
  assert.match(read("public/js/submit-shortcut.js"), /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(en["shortcuts.images"], /Home \/ End/);
  assert.match(read("public/js/lightbox.js"), /key === "Home"[\s\S]*key === "End"/);
  assert.match(en["shortcuts.mentions"], /Enter or Tab/);
  assert.match(read("public/js/mention-picker.js"), /event\.key === "Enter" \|\| event\.key === "Tab"/);
  assert.match(en["shortcuts.close"], /^Esc:/);
  assert.match(read("public/js/mention-picker.js"), /event\.key === "Escape"/);
});

test("wired beside the J/K hint on the thread page, preloaded and styled", () => {
  const post = read("public/js/routes/post.js");
  assert.match(post, /from "\.\.\/shortcut-sheet\.js"/);
  const hintAt = post.indexOf("main.append(createPostKeysHint(document));");
  const sheetAt = post.indexOf("main.append(createShortcutSheet(document));");
  assert.ok(hintAt > 0 && sheetAt > hintAt, "the sheet follows the hint");
  assert.match(read("public/index.html"), /<link rel="modulepreload" href="\/js\/shortcut-sheet\.js">/);
  assert.match(read("public/styles.css"), /\.shortcut-sheet\s*\{/);
});

test("page-view only: binds no keys, stores and sends nothing", () => {
  assert.doesNotMatch(read("public/js/shortcut-sheet.js"),
    /addEventListener|localStorage|sessionStorage|\bapi\(|fetch\(|innerHTML/);
});

test("new strings exist in en and are translated in all 20 locales", () => {
  const en = JSON.parse(read("public/locales/en.json"));
  for (const key of NEW_KEYS) assert.equal(typeof en[key], "string", key);
  const others = LOCALES.map((locale) => locale.code).filter((code) => code !== "en");
  assert.equal(others.length, 48);
  for (const code of others) {
    const bag = JSON.parse(read(`public/locales/${code}.json`));
    for (const key of NEW_KEYS) {
      assert.equal(typeof bag[key], "string", `${code} ${key}`);
      assert.notEqual(bag[key], en[key], `${code} ${key} is translated`);
    }
  }
});
