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

// Wave 5.72 (v5.72.0): Bislama (Latin), Bosnian (Latin), Breton (Latin with
// c'h/ñ), Burmese (Myanmar script), Chamorro (Latin with å/ñ), Chechen
// (Cyrillic with palochka), Chichewa (Latin with ŵ) and Chuvash (Cyrillic with
// ӑ/ӗ/ҫ/ӳ), all left to right. Pins each bundle (same keys in the same order as
// en.json, identical {placeholders}, real translations, no markup or invisible
// characters), the picker entry, browser-tag detection and the plural forms.
// Intl resolves bs, br, my, ce, ny and cv to themselves, so their CLDR
// categories come from the Intl oracle (bs: one/few/other; br:
// one/two/few/many/other; my: other only; cv: zero/one/other). The runtime has
// no plural data for bi and ch, so their one/other split is pinned here and tn
// must not borrow the runtime's default locale rules for them. Bundles are
// two-form tables (key.one / key.other): only the PluralRules "one" category
// takes key.one. Burmese must be standard Unicode, never Zawgyi.
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
// Bosnian shares much with Croatian and Serbian; a straight copy of either would not.
const MAX_NEIGHBOUR_SHARE = 0.8;
const span = (from, to) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`;
// C0 controls, DEL, zero-width marks, line/paragraph separators, bidi
// embeddings/isolates and the BOM.
const INVISIBLE = new RegExp(
  `[${span(0x00, 0x1f)}${String.fromCodePoint(0x7f)}${span(0x200b, 0x200f)}${span(0x2028, 0x202e)}`
    + `${span(0x2066, 0x2069)}${String.fromCodePoint(0xfeff)}]`, "u");
const PALOCHKA = String.fromCodePoint(0x04c0);
// Latin l, I or 1 glued to a Cyrillic letter: a palochka typed with the wrong key.
const LATIN_IN_CYRILLIC = /[Ѐ-ӿ][lI1]|[lI1][Ѐ-ӿ]/u;
// Latin look-alikes of the Chuvash letters ӑ ӗ ҫ ӳ.
const CHUVASH_LATIN_LOOKALIKES = /[ăĕçÿĂĔÇŸ]/u;
// Code points Zawgyi repurposes for stacked forms; standard Burmese never uses them.
const ZAWGYI_RANGE = new RegExp(`[${span(0x1060, 0x109f)}]`, "u");
// Unicode stores the vowel sign E (U+1031) after its consonant and medials;
// Zawgyi stores it first.
const E_VOWEL_FIRST = new RegExp(
  `(?:^|[^${span(0x1000, 0x102a)}${span(0x103b, 0x103f)}${span(0x1050, 0x1055)}])${String.fromCodePoint(0x1031)}`, "u");
// CLDR plurals.xml categories for codes the runtime lacks.
const PINNED_CATEGORIES = Object.freeze({ bi: ["one", "other"], ch: ["one", "other"] });
const NEW_LOCALES = Object.freeze([
  { code: "bi", name: "Bislama", tags: ["bi", "bi-VU", "bi_VU"], script: /\bblong\b/u,
    categories: ["one", "other"], intl: false },
  { code: "bs", name: "Bosanski", tags: ["bs", "bs-BA", "bs_BA"], script: /[čćšžđ]/u,
    categories: ["few", "one", "other"], intl: true },
  { code: "br", name: "Brezhoneg", tags: ["br", "br-FR", "br_FR"], script: /c['’]h/u,
    categories: ["few", "many", "one", "other", "two"], intl: true },
  { code: "my", name: "မြန်မာ", tags: ["my", "my-MM", "my_MM"], script: new RegExp(`[${span(0x1000, 0x105f)}]`, "u"),
    categories: ["other"], intl: true },
  { code: "ch", name: "Finu' Chamoru", tags: ["ch", "ch-GU", "ch_MP"], script: /[åÅ]/u,
    categories: ["one", "other"], intl: false },
  { code: "ce", name: "Нохчийн мотт", tags: ["ce", "ce-RU", "ce_RU"], script: new RegExp(PALOCHKA, "u"),
    categories: ["one", "other"], intl: true },
  { code: "ny", name: "Chichewa", tags: ["ny", "ny-MW", "ny_MW"], script: /ŵ/u,
    categories: ["one", "other"], intl: true },
  { code: "cv", name: "Чӑвашла", tags: ["cv", "cv-RU", "cv_RU"], script: /[ӑӗҫӳ]/u,
    categories: ["one", "other", "zero"], intl: true },
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

test("the picker lists 66 languages, each new one by its endonym, left to right", () => {
  assert.equal(LOCALES.length, 66);
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

test("bi, ch, ce and ny: only n = 1 takes the one form (zero is other)", () => {
  for (const code of ["bi", "ch", "ce", "ny"]) {
    assert.deepEqual(tnForms(code, [0, 1, 2, 5, 21]), ["other 0", "one 1", "other 2", "other 5", "other 21"], code);
  }
});

test("bs: CLDR one (1, 21) takes key.one; few (2, 22) and other (5, 11, 0) fall to key.other", () => {
  assert.deepEqual(tnForms("bs", [1, 21, 2, 22, 5, 11, 0]),
    ["one 1", "one 21", "other 2", "other 22", "other 5", "other 11", "other 0"]);
});

test("br: CLDR one (1, 21) takes key.one; two, few, many and other fall to key.other", () => {
  assert.deepEqual(new Intl.PluralRules("br").select(1000000), "many", "the oracle knows br many");
  assert.deepEqual(tnForms("br", [1, 21, 2, 22, 3, 1000000, 5, 11, 0]),
    ["one 1", "one 21", "other 2", "other 22", "other 3", "other 1000000", "other 5", "other 11", "other 0"]);
});

test("my has a single plural form: every count takes key.other", () => {
  assert.deepEqual(tnForms("my", [0, 1, 2, 21]), ["other 0", "other 1", "other 2", "other 21"]);
});

test("cv: CLDR zero (0) falls to key.other; one (1) takes key.one", () => {
  assert.equal(new Intl.PluralRules("cv").select(0), "zero", "the oracle knows cv zero");
  assert.deepEqual(tnForms("cv", [0, 1, 2, 5, 21]), ["other 0", "one 1", "other 2", "other 5", "other 21"]);
});

test("bi and ch plurals do not borrow the runtime's default locale rules", () => {
  const script = `
    const { createTranslator } = await import(${JSON.stringify(I18N_URL)});
    const sample = ${JSON.stringify(sample)};
    const out = { runtime: new Intl.PluralRules("bi").resolvedOptions().locale };
    for (const code of ["bi", "ch"]) {
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
  for (const code of ["bi", "ch"]) assert.deepEqual(out[code], want, code);
});

test("ce writes the palochka as U+04C0, never a Latin l, I or 1; cv keeps Latin out of Cyrillic", () => {
  for (const code of ["ce", "cv"]) {
    const table = readLocale(code);
    for (const key of enKeys) {
      assert.doesNotMatch(table[key], LATIN_IN_CYRILLIC, `${code} ${key} mixes Latin into a Cyrillic word`);
    }
  }
});

test("cv uses the Cyrillic letters ӑ ӗ ҫ ӳ, never the Latin look-alikes ă ĕ ç ÿ", () => {
  const table = readLocale("cv");
  for (const key of enKeys) assert.doesNotMatch(table[key], CHUVASH_LATIN_LOOKALIKES, `cv ${key}`);
});

test("my is standard Unicode Burmese, not Zawgyi", () => {
  const table = readLocale("my");
  for (const key of enKeys) {
    assert.doesNotMatch(table[key], ZAWGYI_RANGE, `my ${key} uses a Zawgyi-range code point`);
    assert.doesNotMatch(table[key], E_VOWEL_FIRST, `my ${key} stores the vowel sign E before its consonant`);
  }
});

test("bs is its own Bosnian bundle, not a copy of Croatian or Serbian", () => {
  const table = readLocale("bs");
  for (const neighbour of ["hr", "sr"]) {
    const other = readLocale(neighbour);
    const shared = enKeys.filter((key) => other[key] === table[key]).length;
    assert.ok(shared / enKeys.length <= MAX_NEIGHBOUR_SHARE,
      `bs: ${shared}/${enKeys.length} values are identical to ${neighbour}`);
  }
});
