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

// Wave 5.69 (v5.69.0): Abkhaz (Cyrillic), Afar (Latin), Amharic (Ethiopic)
// and Akan (Latin with ɛ/ɔ), all left to right. Pins each bundle (same keys
// in the same order as en.json, identical {placeholders}, real translations),
// the picker entry, browser-tag detection and the plural forms. The runtime
// has no plural data for ab and aa, so their CLDR categories are pinned here
// (ab: one = n is 1; aa: no CLDR entry, one/other) and tn must not borrow the
// runtime's default locale rules for them; am and ak use the Intl oracle
// because Intl resolves them to themselves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { DEFAULT_LOCALE, LOCALES, createTranslator, detectLocale, localeDir } from "../public/js/i18n.js";

const LOCALE_DIR = new URL("../public/locales/", import.meta.url);
const I18N_URL = new URL("../public/js/i18n.js", import.meta.url).href;
const STYLES = new URL("../public/styles.css", import.meta.url);
const PLACEHOLDER = /\{(\w+)\}/g;
// Same ceiling as tests/i18n.test.mjs: brand names may match English, a copy may not.
const MAX_ENGLISH_SHARE = 0.08;
// CLDR plurals.xml categories for codes the runtime lacks (aa has no entry).
const PINNED_CATEGORIES = Object.freeze({ ab: ["one", "other"], aa: ["one", "other"] });
const NEW_LOCALES = Object.freeze([
  { code: "ab", name: "Аҧсуа", tags: ["ab", "ab-GE", "ab_GE"], script: /[Ѐ-ӿ]/u },
  { code: "aa", name: "Qafar af", tags: ["aa", "aa-ET", "aa-DJ"], script: /[A-Za-z]/u },
  { code: "am", name: "አማርኛ", tags: ["am", "am-ET", "am_ET"], script: /[ሀ-፿]/u },
  { code: "ak", name: "Akan", tags: ["ak", "ak-GH", "ak_GH"], script: /[ɛɔ]/u },
]);

const readLocale = (code) => JSON.parse(readFileSync(new URL(`${code}.json`, LOCALE_DIR), "utf8"));
const placeholders = (value) => [...value.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();
const en = readLocale(DEFAULT_LOCALE);
const enKeys = Object.keys(en);
const sample = { "x.n.one": "one {count}", "x.n.other": "other {count}" };

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
});

for (const { code, script } of NEW_LOCALES) {
  test(`${code}: bundle has every en.json key in the same order, same placeholders, real translations`, () => {
    assert.ok(existsSync(new URL(`${code}.json`, LOCALE_DIR)), `${code}.json missing`);
    const table = readLocale(code);
    assert.deepEqual(Object.keys(table), enKeys, `${code} key order`);
    let sameAsEnglish = 0;
    for (const key of enKeys) {
      assert.equal(typeof table[key], "string", `${code} ${key}`);
      assert.ok(table[key].trim().length > 0, `${code} ${key} is empty`);
      assert.deepEqual(placeholders(table[key]), placeholders(en[key]), `${code} ${key} placeholders`);
      assert.doesNotMatch(table[key], /[<>]|&[a-z]+;|[\u202A-\u202E\u2066-\u2069]/i, `${code} ${key} markup`);
      if (table[key] === en[key]) sameAsEnglish += 1;
    }
    assert.ok(sameAsEnglish / enKeys.length <= MAX_ENGLISH_SHARE,
      `${code}: ${sameAsEnglish}/${enKeys.length} values are untranslated English`);
    assert.match(Object.values(table).join(" "), script, `${code} is written in its own script`);
  });

  test(`${code}: plural keys cover the CLDR categories and tn picks the right form`, () => {
    const resolved = new Intl.PluralRules(code).resolvedOptions();
    const categories = resolved.locale === code ? resolved.pluralCategories : PINNED_CATEGORIES[code];
    assert.ok(categories, `${code}: Intl has no data and no CLDR pin`);
    assert.deepEqual([...categories].sort(), ["one", "other"], code);
    const table = readLocale(code);
    for (const key of enKeys.filter((name) => name.endsWith(".other"))) {
      const base = key.slice(0, -6);
      if (!(`${base}.one` in en)) continue;
      for (const category of categories) assert.ok(`${base}.${category}` in table, `${code} ${base}.${category}`);
    }
    const { tn } = createTranslator(code, sample, sample);
    assert.equal(tn("x.n", 1), "one 1", code);
    assert.equal(tn("x.n", 2), "other 2", code);
    assert.equal(tn("x.n", 21), "other 21", code);
  });
}

test("am and ak follow CLDR: zero takes the one form (i = 0 or n = 1)", () => {
  for (const code of ["am", "ak"]) {
    const { tn } = createTranslator(code, sample, sample);
    assert.equal(tn("x.n", 0), "one 0", code);
  }
});

test("ab and aa: zero takes the other form (CLDR n = 1 only)", () => {
  for (const code of ["ab", "aa"]) {
    const { tn } = createTranslator(code, sample, sample);
    assert.equal(tn("x.n", 0), "other 0", code);
  }
});

test("ab and aa plurals do not borrow the runtime's default locale rules", () => {
  const script = `
    const { createTranslator } = await import(${JSON.stringify(I18N_URL)});
    const sample = ${JSON.stringify(sample)};
    const out = { runtime: new Intl.PluralRules("ab").resolvedOptions().locale };
    for (const code of ["ab", "aa"]) {
      const { tn } = createTranslator(code, sample, sample);
      out[code] = [0, 1, 2, 5, 21].map((n) => tn("x.n", n));
    }
    console.log(JSON.stringify(out));`;
  const env = { ...process.env, LC_ALL: "ru_RU.UTF-8", LANG: "ru_RU.UTF-8" };
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout);
  assert.match(out.runtime, /^ru/, "the child runtime defaults to Russian, so the check can fail");
  const want = ["other 0", "one 1", "other 2", "other 5", "other 21"];
  assert.deepEqual(out.ab, want, "ab");
  assert.deepEqual(out.aa, want, "aa");
});

test("the base font stack lists system Ethiopic fallbacks, no webfonts", () => {
  const css = readFileSync(STYLES, "utf8");
  const root = css.match(/:root\s*\{[^}]*?font-family:\s*([^;]+);/);
  assert.ok(root, ":root font-family");
  assert.match(root[1], /"Noto Sans Ethiopic", "Kefa", "Nyala", "Ebrima", sans-serif$/);
  assert.doesNotMatch(css, /@font-face|fonts\.googleapis/);
});
