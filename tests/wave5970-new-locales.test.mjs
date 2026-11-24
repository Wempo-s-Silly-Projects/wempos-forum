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

// Wave 5.97 (v5.97.0): Cornish (Kernewek, Standard Written Form), Corsican
// (Corsu, with chj/ghj), Plains Cree (Canadian Aboriginal Syllabics), Dhivehi
// (Thaana, RIGHT TO LEFT), Dzongkha (Tibetan with the tsheg between
// syllables), Esperanto (real ĉ ĝ ĥ ĵ ŝ ŭ), Estonian (õ ä ö ü š ž) and Ewe
// (ɖ ƒ ɣ ŋ ɔ ɛ ʋ). Pins each bundle (same keys in the same order as en.json,
// identical {placeholders}, real translations, no markup or invisible
// characters, no bidi controls even in the rtl bundle), the picker entry,
// direction, browser-tag detection and the plural forms. Intl resolves kw,
// dv, dz, eo, et and ee to themselves, so their CLDR categories come from the
// Intl oracle (kw: zero/one/two/few/many/other; dz: other only; dv, eo, et,
// ee: one/other). The runtime has no plural data for co and cr, so their
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
// C0 controls, DEL, Arabic letter mark, zero-width marks, line/paragraph
// separators, bidi embeddings/overrides/isolates and the BOM. Thaana and
// Tibetan need none of them.
const INVISIBLE = new RegExp(
  `[${span(0x00, 0x1f)}${String.fromCodePoint(0x7f)}${String.fromCodePoint(0x061c)}${span(0x200b, 0x200f)}`
    + `${span(0x2028, 0x202e)}${span(0x2066, 0x2069)}${String.fromCodePoint(0xfeff)}]`, "u");
const SYLLABICS = new RegExp(`[${span(0x1400, 0x167f)}]`, "u");
const THAANA = new RegExp(`[${span(0x0780, 0x07bf)}]`, "u");
const TIBETAN = new RegExp(`[${span(0x0f00, 0x0fff)}]`, "u");
const TSHEG = String.fromCodePoint(0x0f0b);
// Roman-orthography Cree vowels: the bundle must be syllabics, as the owner pasted.
const CREE_ROMAN_VOWELS = /[āēīōâêîôÂÊÎÔ]/u;
// Esperanto x-system digraphs standing in for ĉ ĝ ĥ ĵ ŝ ŭ.
const X_SYSTEM = /[cghjsu]x/iu;
// Greek look-alikes of the Ewe letters ɛ and ʋ.
const EWE_GREEK_LOOKALIKES = /[εΕυν]/u;
// CLDR plurals.xml categories for codes the runtime lacks.
const PINNED_CATEGORIES = Object.freeze({ co: ["one", "other"], cr: ["one", "other"] });
const NEW_LOCALES = Object.freeze([
  { code: "kw", name: "Kernewek", dir: "ltr", tags: ["kw", "kw-GB", "kw_GB"], script: /dh/u,
    categories: ["few", "many", "one", "other", "two", "zero"], intl: true },
  { code: "co", name: "Corsu", dir: "ltr", tags: ["co", "co-FR", "co_FR"], script: /chj|ghj/u,
    categories: ["one", "other"], intl: false },
  { code: "cr", name: "ᓀᐦᐃᔭᐍᐏᐣ", dir: "ltr", tags: ["cr", "cr-CA", "cr_CA"], script: SYLLABICS,
    categories: ["one", "other"], intl: false },
  { code: "dv", name: "ދިވެހި", dir: "rtl", tags: ["dv", "dv-MV", "dv_MV"], script: THAANA,
    categories: ["one", "other"], intl: true },
  { code: "dz", name: "རྫོང་ཁ", dir: "ltr", tags: ["dz", "dz-BT", "dz_BT"], script: new RegExp(TSHEG, "u"),
    categories: ["other"], intl: true },
  { code: "eo", name: "Esperanto", dir: "ltr", tags: ["eo", "eo-001", "eo_001"], script: /[ĉĝĥĵŝŭ]/u,
    categories: ["one", "other"], intl: true },
  { code: "et", name: "Eesti", dir: "ltr", tags: ["et", "et-EE", "et_EE"], script: /õ/u,
    categories: ["one", "other"], intl: true },
  { code: "ee", name: "Eʋegbe", dir: "ltr", tags: ["ee", "ee-GH", "ee_TG"], script: /ʋ/u,
    categories: ["one", "other"], intl: true },
]);

const readLocale = (code) => JSON.parse(readFileSync(new URL(`${code}.json`, LOCALE_DIR), "utf8"));
const placeholders = (value) => [...value.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();
const withoutPlaceholders = (value) => value.replace(PLACEHOLDER, "");
const en = readLocale(DEFAULT_LOCALE);
const enKeys = Object.keys(en);
const sample = { "x.n.one": "one {count}", "x.n.other": "other {count}" };
const tnForms = (code, counts) => {
  const { tn } = createTranslator(code, sample, sample);
  return counts.map((n) => tn("x.n", n));
};

test("the picker lists 74 languages, each new one by its endonym and direction", () => {
  assert.equal(LOCALES.length, 74);
  for (const { code, name, dir } of NEW_LOCALES) {
    const entry = LOCALES.find((locale) => locale.code === code);
    assert.ok(entry, `${code} missing from LOCALES`);
    assert.equal(entry.name, name, code);
    assert.equal(entry.dir, dir, code);
    assert.equal(localeDir(code), dir, code);
  }
  assert.equal(new Set(LOCALES.map((locale) => locale.code)).size, LOCALES.length, "codes are unique");
  assert.equal(new Set(LOCALES.map((locale) => locale.name)).size, LOCALES.length, "names are unique");
});

test("dv is right to left on the same path as ar, he, fa and ur", () => {
  assert.equal(localeDir("dv"), "rtl");
  assert.equal(localeDir("DV"), "rtl", "case-insensitive like the other codes");
  assert.deepEqual(LOCALES.filter((locale) => locale.dir === "rtl").map((locale) => locale.code),
    ["ar", "he", "fa", "ur", "dv"]);
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

test("kw: the oracle reports every CLDR category; only one (1) takes key.one", () => {
  const rules = new Intl.PluralRules("kw");
  const samples = {
    zero: [0], one: [1], two: [2, 22, 102], few: [3, 23, 103], many: [21, 41, 101], other: [4, 11, 100],
  };
  for (const [category, counts] of Object.entries(samples)) {
    for (const n of counts) assert.equal(rules.select(n), category, `kw ${n}`);
  }
  const counts = Object.values(samples).flat();
  assert.deepEqual(tnForms("kw", counts), counts.map((n) => (n === 1 ? `one ${n}` : `other ${n}`)));
});

test("co, cr, dv, eo, et and ee: only n = 1 takes the one form (zero is other)", () => {
  for (const code of ["co", "cr", "dv", "eo", "et", "ee"]) {
    assert.deepEqual(tnForms(code, [0, 1, 2, 5, 21]), ["other 0", "one 1", "other 2", "other 5", "other 21"], code);
  }
});

test("dz has a single plural form: every count takes key.other", () => {
  assert.deepEqual(tnForms("dz", [0, 1, 2, 21]), ["other 0", "other 1", "other 2", "other 21"]);
});

test("co and cr plurals do not borrow the runtime's default locale rules", () => {
  const script = `
    const { createTranslator } = await import(${JSON.stringify(I18N_URL)});
    const sample = ${JSON.stringify(sample)};
    const out = { runtime: new Intl.PluralRules("co").resolvedOptions().locale };
    for (const code of ["co", "cr"]) {
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
  for (const code of ["co", "cr"]) assert.deepEqual(out[code], want, code);
});

test("cr is written in syllabics, never the Roman orthography's long vowels", () => {
  const table = readLocale("cr");
  for (const key of enKeys) assert.doesNotMatch(table[key], CREE_ROMAN_VOWELS, `cr ${key}`);
});

test("cr, dv and dz values are written in their own script, not left in Latin", () => {
  for (const [code, script] of [["cr", SYLLABICS], ["dv", THAANA], ["dz", TIBETAN]]) {
    const table = readLocale(code);
    const inScript = enKeys.filter((key) => script.test(table[key])).length;
    assert.ok(inScript / enKeys.length >= 1 - MAX_ENGLISH_SHARE,
      `${code}: only ${inScript}/${enKeys.length} values use the script`);
  }
});

test("eo uses the real letters ĉ ĝ ĥ ĵ ŝ ŭ, never the x-system", () => {
  const table = readLocale("eo");
  for (const key of enKeys) {
    if (X_SYSTEM.test(withoutPlaceholders(en[key]))) continue;
    assert.doesNotMatch(withoutPlaceholders(table[key]), X_SYSTEM, `eo ${key}`);
  }
});

test("ee uses ɖ ƒ ɣ ŋ ɔ ɛ ʋ, never Greek look-alikes", () => {
  const table = readLocale("ee");
  const all = Object.values(table).join(" ");
  for (const letter of ["ɖ", "ɛ", "ɔ", "ʋ"]) assert.ok(all.includes(letter), `ee uses ${letter}`);
  for (const key of enKeys) assert.doesNotMatch(table[key], EWE_GREEK_LOOKALIKES, `ee ${key}`);
});
