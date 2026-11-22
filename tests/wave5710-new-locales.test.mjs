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

// Wave 5.71 (v5.71.0): Aragonese (Latin), Armenian (Armenian script),
// Assamese (Bengali-Assamese script), Avar (Cyrillic with palochka), Aymara
// (Latin), Bambara (Latin with ɛ/ɔ/ɲ/ŋ), Bashkir (Cyrillic) and Belarusian
// (Cyrillic), all left to right. Pins each bundle (same keys in the same order
// as en.json, identical {placeholders}, real translations, no markup or
// invisible characters), the picker entry, browser-tag detection and the
// plural forms. Intl resolves an, hy, as, bm and be to themselves, so their
// CLDR categories come from the Intl oracle (be: one/few/many/other; bm:
// other only). The runtime has no plural data for av, ay and ba, so their
// one/other split is pinned here and tn must not borrow the runtime's default
// locale rules for them. Bundles are two-form tables (key.one / key.other):
// only the PluralRules "one" category takes key.one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { DEFAULT_LOCALE, LOCALES, createTranslator, detectLocale, localeDir } from "../public/js/i18n.js";

const LOCALE_DIR = new URL("../public/locales/", import.meta.url);
const I18N_URL = new URL("../public/js/i18n.js", import.meta.url).href;
const PLACEHOLDER = /\{(\w+)\}/g;
// Same ceiling as tests/i18n.test.mjs: brand names may match English, a copy may not.
const MAX_ENGLISH_SHARE = 0.08;
const span = (from, to) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`;
// C0 controls, DEL, zero-width marks, line/paragraph separators, bidi
// embeddings/isolates and the BOM.
const INVISIBLE = new RegExp(
  `[${span(0x00, 0x1f)}${String.fromCodePoint(0x7f)}${span(0x200b, 0x200f)}${span(0x2028, 0x202e)}`
    + `${span(0x2066, 0x2069)}${String.fromCodePoint(0xfeff)}]`, "u");
const PALOCHKA_UPPER = String.fromCodePoint(0x04c0);
const PALOCHKA_LOWER = String.fromCodePoint(0x04cf);
// Latin l or I glued to a Cyrillic letter: a palochka typed with the wrong key.
const LATIN_IN_CYRILLIC = /[Ѐ-ӿ][lI1]|[lI1][Ѐ-ӿ]/u;
// CLDR plurals.xml categories for codes the runtime lacks.
const PINNED_CATEGORIES = Object.freeze({ av: ["one", "other"], ay: ["one", "other"], ba: ["one", "other"] });
const NEW_LOCALES = Object.freeze([
  { code: "an", name: "Aragonés", tags: ["an", "an-ES", "an_ES"], script: /[A-Za-z]/u,
    categories: ["one", "other"], intl: true },
  { code: "hy", name: "Հայերեն", tags: ["hy", "hy-AM", "hy_AM"], script: /[Ա-֏]/u,
    categories: ["one", "other"], intl: true },
  { code: "as", name: "অসমীয়া", tags: ["as", "as-IN", "as_IN"], script: /[ৰৱ]/u,
    categories: ["one", "other"], intl: true },
  { code: "av", name: `Авар мац${PALOCHKA_LOWER}`, tags: ["av", "av-RU", "av_RU"],
    script: new RegExp(`[${PALOCHKA_UPPER}${PALOCHKA_LOWER}]`, "u"), categories: ["one", "other"], intl: false },
  { code: "ay", name: "Aymar aru", tags: ["ay", "ay-BO", "ay_PE"], script: /(?:ch|[ptkq])['’]/u,
    categories: ["one", "other"], intl: false },
  { code: "bm", name: "Bamanankan", tags: ["bm", "bm-ML", "bm_ML"], script: /[ɛɔɲŋ]/u,
    categories: ["other"], intl: true },
  { code: "ba", name: "Башҡорт теле", tags: ["ba", "ba-RU", "ba_RU"], script: /[ҡғҫҙһ]/u,
    categories: ["one", "other"], intl: false },
  { code: "be", name: "Беларуская", tags: ["be", "be-BY", "be_BY"], script: /[ўі]/u,
    categories: ["few", "many", "one", "other"], intl: true },
]);

const readLocale = (code) => JSON.parse(readFileSync(new URL(`${code}.json`, LOCALE_DIR), "utf8"));
const placeholders = (value) => [...value.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();
const en = readLocale(DEFAULT_LOCALE);
const enKeys = Object.keys(en);
const sample = { "x.n.one": "one {count}", "x.n.other": "other {count}" };
const tnForms = (code, counts) => {
  const { tn } = createTranslator(code, sample, sample);
  return counts.map((n) => tn("x.n", n));
};

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
      assert.doesNotMatch(table[key], /[<>]|&[a-z]+;|\{\{|\}\}/i, `${code} ${key} markup`);
      assert.doesNotMatch(table[key], INVISIBLE, `${code} ${key} invisible or control character`);
      if (table[key] === en[key]) sameAsEnglish += 1;
    }
    assert.ok(sameAsEnglish / enKeys.length <= MAX_ENGLISH_SHARE,
      `${code}: ${sameAsEnglish}/${enKeys.length} values are untranslated English`);
    assert.match(Object.values(table).join(" "), script, `${code} is written in its own script`);
  });
}

for (const { code, categories, intl } of NEW_LOCALES) {
  test(`${code}: CLDR plural categories are ${categories.join("/")} and every plural pair is present`, () => {
    const resolved = new Intl.PluralRules(code).resolvedOptions();
    assert.equal(resolved.locale === code, intl, `${code}: Intl resolves it to itself`);
    const actual = intl ? resolved.pluralCategories : PINNED_CATEGORIES[code];
    assert.ok(actual, `${code}: Intl has no data and no CLDR pin`);
    assert.deepEqual([...actual].sort(), categories, code);
    const table = readLocale(code);
    for (const key of enKeys.filter((name) => name.endsWith(".other"))) {
      const base = key.slice(0, -6);
      if (!(`${base}.one` in en)) continue;
      assert.ok(`${base}.one` in table && `${base}.other` in table, `${code} ${base} pair`);
    }
  });
}

test("an, av, ay and ba: only n = 1 takes the one form (zero is other)", () => {
  for (const code of ["an", "av", "ay", "ba"]) {
    assert.deepEqual(tnForms(code, [0, 1, 2, 5, 21]), ["other 0", "one 1", "other 2", "other 5", "other 21"], code);
  }
});

test("hy and as follow CLDR: zero takes the one form (i = 0 or n = 1)", () => {
  for (const code of ["hy", "as"]) {
    assert.deepEqual(tnForms(code, [0, 1, 2, 21]), ["one 0", "one 1", "other 2", "other 21"], code);
  }
});

test("bm has a single plural form: every count takes key.other", () => {
  assert.deepEqual(tnForms("bm", [0, 1, 2, 21]), ["other 0", "other 1", "other 2", "other 21"]);
});

test("be: CLDR one (1, 21) takes key.one; few and many fall to key.other", () => {
  assert.deepEqual(tnForms("be", [1, 21, 2, 5, 11, 0]),
    ["one 1", "one 21", "other 2", "other 5", "other 11", "other 0"]);
});

test("av, ay and ba plurals do not borrow the runtime's default locale rules", () => {
  const script = `
    const { createTranslator } = await import(${JSON.stringify(I18N_URL)});
    const sample = ${JSON.stringify(sample)};
    const out = { runtime: new Intl.PluralRules("av").resolvedOptions().locale };
    for (const code of ["av", "ay", "ba"]) {
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
  for (const code of ["av", "ay", "ba"]) assert.deepEqual(out[code], want, code);
});

test("av writes the palochka as U+04C0/U+04CF, never a Latin l, I or 1; ba keeps Latin out of Cyrillic", () => {
  for (const code of ["av", "ba"]) {
    const table = readLocale(code);
    for (const key of enKeys) {
      assert.doesNotMatch(table[key], LATIN_IN_CYRILLIC, `${code} ${key} mixes Latin into a Cyrillic word`);
    }
  }
});

test("be is Belarusian, not Russian: no и, щ or ъ", () => {
  const table = readLocale("be");
  for (const key of enKeys) assert.doesNotMatch(table[key], /[иИщЩъЪ]/u, `be ${key}`);
});
