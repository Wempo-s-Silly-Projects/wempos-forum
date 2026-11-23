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

// Serbian ships in both scripts (owner decision, 2026-11-22): sr is Cyrillic
// (the official script and the CLDR default), sr-Latn is its 1:1 Latin twin.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LOCALES, detectLocale } from "../public/js/i18n.js";
import { strayLatin, toCyrillic, toLatin } from "./helpers/serbian-script.mjs";

const readLocale = (code) => JSON.parse(readFileSync(new URL(`../public/locales/${code}.json`, import.meta.url), "utf8"));
const sr = readLocale("sr");
const srLatn = readLocale("sr-Latn");
const CYRILLIC = /[Ѐ-ӿ]/;

test("the transliteration handles lj / nj / dž as single letters and keeps their case", () => {
  assert.equal(toCyrillic("Ljubav, NJIVA i džep"), "Љубав, ЊИВА и џеп");
  assert.equal(toLatin("Љубав, ЊИВА и џеп"), "Ljubav, NJIVA i džep");
  assert.equal(toCyrillic("Otvori {name} na https://example.com uz Wempo i GIF-ove"),
    "Отвори {name} на https://example.com уз Wempo и GIF-ове");
});

test("sr is Cyrillic: no Latin word outside placeholders and allow-listed names", () => {
  for (const [key, value] of Object.entries(sr)) {
    assert.deepEqual(strayLatin(value, key), [], `sr ${key}: ${value}`);
  }
  const cyrillic = Object.values(sr).filter((value) => CYRILLIC.test(value)).length;
  assert.ok(cyrillic / Object.keys(sr).length > 0.95, `only ${cyrillic} sr values carry Cyrillic`);
});

test("sr-Latn is the 1:1 Latin form of sr and round-trips back to it", () => {
  assert.deepEqual(Object.keys(srLatn), Object.keys(sr));
  for (const [key, value] of Object.entries(sr)) {
    assert.equal(srLatn[key], toLatin(value), `sr-Latn ${key}`);
    assert.doesNotMatch(srLatn[key], CYRILLIC, `sr-Latn ${key} keeps Cyrillic`);
    assert.equal(toCyrillic(srLatn[key], key), value, `round trip ${key}`);
  }
});

test("both scripts are in the picker, and -Latn browser tags pick the Latin bundle", () => {
  const byCode = new Map(LOCALES.map((locale) => [locale.code, locale.name]));
  assert.equal(byCode.get("sr"), "Српски");
  assert.equal(byCode.get("sr-Latn"), "Srpski (latinica)");
  assert.equal(detectLocale(null, ["sr"]), "sr");
  assert.equal(detectLocale(null, ["sr-RS"]), "sr");
  assert.equal(detectLocale(null, ["sr-Cyrl-RS"]), "sr");
  assert.equal(detectLocale(null, ["sr-Latn"]), "sr-Latn");
  assert.equal(detectLocale(null, ["sr-Latn-RS"]), "sr-Latn");
  assert.equal(detectLocale("sr-latn", []), "sr-Latn");
});
