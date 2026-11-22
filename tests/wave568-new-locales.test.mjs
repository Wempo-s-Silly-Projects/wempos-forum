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

// Wave 5.68 (v5.68.0): four more interface languages, all Latin script and
// left-to-right. Pins each bundle (same keys in the same order as en.json,
// identical {placeholders}, real translations, CLDR plural forms), the picker
// entry (endonym, dir), browser-tag detection, and the English fallback for an
// unknown code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { DEFAULT_LOCALE, LOCALES, createTranslator, detectLocale, localeDir } from "../public/js/i18n.js";

const LOCALE_DIR = new URL("../public/locales/", import.meta.url);
const PLACEHOLDER = /\{(\w+)\}/g;
// Same ceiling as tests/i18n.test.mjs: brand names may match English, a copy may not.
const MAX_ENGLISH_SHARE = 0.08;
const NEW_LOCALES = Object.freeze([
  { code: "af", name: "Afrikaans", tags: ["af", "af-ZA", "af_NA"] },
  { code: "sq", name: "Shqip", tags: ["sq", "sq-AL", "sq-XK"] },
  { code: "az", name: "Azərbaycanca", tags: ["az", "az-AZ", "az-Latn-AZ"] },
  { code: "eu", name: "Euskara", tags: ["eu", "eu-ES", "eu-FR"] },
]);

const readLocale = (code) => JSON.parse(readFileSync(new URL(`${code}.json`, LOCALE_DIR), "utf8"));
const placeholders = (value) => [...value.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();
const en = readLocale(DEFAULT_LOCALE);
const enKeys = Object.keys(en);

test("the picker lists 65 languages, each new one by its endonym, left to right", () => {
  assert.equal(LOCALES.length, 65);
  for (const { code, name } of NEW_LOCALES) {
    const entry = LOCALES.find((locale) => locale.code === code);
    assert.ok(entry, `${code} missing from LOCALES`);
    assert.equal(entry.name, name, code);
    assert.equal(entry.dir, "ltr", code);
    assert.equal(localeDir(code), "ltr", code);
  }
  assert.equal(new Set(LOCALES.map((locale) => locale.code)).size, LOCALES.length, "codes are unique");
  assert.equal(new Set(LOCALES.map((locale) => locale.name)).size, LOCALES.length, "names are unique");
});

test("browser tags pick the new languages; an unknown code still falls back to English", () => {
  for (const { code, tags } of NEW_LOCALES) {
    for (const tag of tags) assert.equal(detectLocale(null, [tag]), code, tag);
    assert.equal(detectLocale(code, ["fr"]), code, `stored ${code}`);
  }
  assert.equal(detectLocale("xx", ["zz-ZZ"]), DEFAULT_LOCALE);
  assert.equal(detectLocale(null, ["unknown"]), DEFAULT_LOCALE);
  assert.equal(existsSync(new URL("unknown.json", LOCALE_DIR)), false);
});

for (const { code } of NEW_LOCALES) {
  test(`${code}: bundle has every en.json key in the same order, same placeholders, real translations`, () => {
    assert.ok(existsSync(new URL(`${code}.json`, LOCALE_DIR)), `${code}.json missing`);
    const table = readLocale(code);
    assert.deepEqual(Object.keys(table), enKeys, `${code} key order`);
    let sameAsEnglish = 0;
    for (const key of enKeys) {
      assert.equal(typeof table[key], "string", `${code} ${key}`);
      assert.ok(table[key].trim().length > 0, `${code} ${key} is empty`);
      assert.deepEqual(placeholders(table[key]), placeholders(en[key]), `${code} ${key} placeholders`);
      assert.doesNotMatch(table[key], /[<>]|&[a-z]+;|[‪-‮⁦-⁩]/i, `${code} ${key} markup`);
      if (table[key] === en[key]) sameAsEnglish += 1;
    }
    assert.ok(sameAsEnglish / enKeys.length <= MAX_ENGLISH_SHARE,
      `${code}: ${sameAsEnglish}/${enKeys.length} values are untranslated English`);
  });

  test(`${code}: plural keys cover the CLDR categories and tn picks the right form`, () => {
    const categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
    assert.deepEqual([...categories].sort(), ["one", "other"], code);
    const table = readLocale(code);
    const bases = enKeys.filter((key) => key.endsWith(".other")).map((key) => key.slice(0, -6));
    assert.ok(bases.length > 0);
    for (const base of bases) {
      if (!(`${base}.one` in en)) continue;
      for (const category of categories) assert.ok(`${base}.${category}` in table, `${code} ${base}.${category}`);
    }
    const sample = { "x.n.one": "one {count}", "x.n.other": "other {count}" };
    const { tn } = createTranslator(code, sample, sample);
    assert.equal(tn("x.n", 1), "one 1", code);
    assert.equal(tn("x.n", 2), "other 2", code);
    assert.equal(tn("x.n", 0), "other 0", code);
  });
}
