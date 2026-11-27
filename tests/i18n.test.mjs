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

// Wave i18n (v4.6.0): the forum's own translations. Pins the loader, the
// locale tables (key + placeholder parity, real translations, RTL), and the
// no-copy sweep (no painted English left in client code or index.html).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_LOCALE, LOCALES, applyDocumentLocale, createTranslator, detectLocale,
  interpolate, localeDir,
} from "../public/js/i18n.js";
import { findCopy } from "./helpers/string-literals.mjs";

const ROOT = new URL("../", import.meta.url);
const LOCALE_DIR = new URL("public/locales/", ROOT);
const JS_DIR = new URL("public/js/", ROOT).pathname;
const RTL_CODES = ["ar", "he", "fa", "ur", "dv"];
// A translation may share a value with English (brand names, "GIF"), but a
// locale where more than this share of values equals English is a copy.
const MAX_ENGLISH_SHARE = 0.08;
const PLACEHOLDER = /\{(\w+)\}/g;
const MIN_LOCALES = 40;

const readLocale = (code) => JSON.parse(readFileSync(new URL(`${code}.json`, LOCALE_DIR), "utf8"));
const placeholders = (value) => [...value.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith(".js") ? [join(dir, entry.name)] : []);
// public/js/vendor/** is vendored verbatim (Prism, v5.74) and never edited,
// so its upstream literals are not ours to translate.
const clientFiles = () => walk(JS_DIR).filter((file) => !file.endsWith("/i18n.js") && !file.includes("/vendor/"));

test("detectLocale: stored choice, then browser list, regional and script fallbacks, then English", () => {
  assert.equal(detectLocale("fr", ["de-DE"]), "fr");
  assert.equal(detectLocale("xx", ["pt-BR", "en"]), "pt");
  assert.equal(detectLocale(null, ["zh-TW"]), "zh-Hant");
  assert.equal(detectLocale(null, ["zh-Hant-HK"]), "zh-Hant");
  assert.equal(detectLocale(null, ["zh-CN"]), "zh-Hans");
  assert.equal(detectLocale(null, ["zh"]), "zh-Hans");
  assert.equal(detectLocale(null, ["iw"]), "he");
  assert.equal(detectLocale(null, ["zu", "ko-KR"]), "ko");
  assert.equal(detectLocale(null, ["zu"]), DEFAULT_LOCALE);
  assert.equal(detectLocale(null, ["sw-KE"]), "sw");
  assert.equal(detectLocale(null, ["no-NO"]), "nb");
  assert.equal(detectLocale(null, ["nn"]), "nb");
  assert.equal(detectLocale(null, ["tl"]), "fil");
  assert.equal(detectLocale(null, ["fa-IR"]), "fa");
  assert.equal(detectLocale(undefined, undefined), DEFAULT_LOCALE);
});

test("t falls back to English, then to the key, and fills only known placeholders", () => {
  const { t } = createTranslator("fr", { "a.hi": "Salut {name}" }, { "a.hi": "Hi {name}", "a.bye": "Bye" });
  assert.equal(t("a.hi", { name: "Ann" }), "Salut Ann");
  assert.equal(t("a.bye"), "Bye");
  assert.equal(t("a.missing"), "a.missing");
  assert.equal(interpolate("{a} and {b}", { a: 1 }), "1 and {b}");
});

test("tn picks key.one / key.other through Intl.PluralRules and passes count", () => {
  const en = { "x.replies.one": "{count} reply", "x.replies.other": "{count} replies" };
  assert.equal(createTranslator("en", en, en).tn("x.replies", 1), "1 reply");
  assert.equal(createTranslator("en", en, en).tn("x.replies", 0), "0 replies");
  const fr = { "x.replies.one": "{count} réponse", "x.replies.other": "{count} réponses" };
  assert.equal(createTranslator("fr", fr, en).tn("x.replies", 0), "0 réponse");
  const ja = { "x.replies.one": "返信{count}件", "x.replies.other": "返信{count}件" };
  assert.equal(createTranslator("ja", ja, en).tn("x.replies", 1), "返信1件");
});

test("tn on the two-form tables: only PluralRules 'one' takes key.one, few/many/two fall to key.other", () => {
  const table = { "x.n.one": "one {count}", "x.n.other": "other {count}" };
  const pick = (code, n) => createTranslator(code, table, table).tn("x.n", n);
  for (const code of ["cs", "sk", "hr", "sr"]) {
    assert.equal(pick(code, 1), "one 1", code);
    assert.equal(pick(code, 3), "other 3", code);
    assert.equal(pick(code, 5), "other 5", code);
  }
  assert.equal(pick("hr", 21), "one 21");
  assert.equal(pick("ro", 2), "other 2");
  assert.equal(pick("fa", 0), "one 0");
  assert.equal(pick("bn", 0), "one 0");
  assert.equal(pick("fil", 2), "one 2");
  assert.equal(pick("fil", 4), "other 4");
  assert.equal(pick("ms", 1), "other 1");
  for (const code of ["sv", "nb", "da", "fi", "hu", "bg", "el", "ca", "ur", "ta", "sw"]) {
    assert.equal(pick(code, 1), "one 1", code);
    assert.equal(pick(code, 7), "other 7", code);
  }
});

test("tn honours key.few / key.many when the table has them, else falls back to key.other", () => {
  const table = {
    "x.n.one": "one {count}", "x.n.few": "few {count}", "x.n.many": "many {count}", "x.n.other": "other {count}",
  };
  const pick = (code, n, messages = table) => createTranslator(code, messages, {}).tn("x.n", n);
  assert.equal(pick("be", 1), "one 1");
  assert.equal(pick("be", 3), "few 3");
  assert.equal(pick("be", 22), "few 22");
  assert.equal(pick("be", 5), "many 5");
  assert.equal(pick("be", 11), "many 11");
  assert.equal(pick("be", 1.5), "other 1.5");
  assert.equal(pick("bs", 3), "few 3");
  assert.equal(pick("bs", 5), "other 5");
  const noMany = { "x.n.one": "one {count}", "x.n.few": "few {count}", "x.n.other": "other {count}" };
  assert.equal(pick("be", 5, noMany), "other 5");
  assert.equal(pick("be", 4, noMany), "few 4");
  assert.equal(createTranslator("be", noMany, { "x.n.many": "en many {count}" }).tn("x.n", 5), "other 5",
    "a few/many form is taken only from the active locale, never from the English fallback");
});

test("RTL: ar, he, fa, ur and dv switch the document to dir=rtl, every other locale stays ltr", () => {
  assert.deepEqual(LOCALES.filter((locale) => locale.dir === "rtl").map((locale) => locale.code), RTL_CODES);
  for (const { code } of LOCALES) {
    const doc = { documentElement: { lang: "", dir: "" } };
    applyDocumentLocale(doc, code);
    assert.equal(doc.documentElement.lang, code);
    assert.equal(doc.documentElement.dir, RTL_CODES.includes(code) ? "rtl" : "ltr", code);
  }
  assert.equal(localeDir("unknown"), "ltr");
});

test("every listed locale has a table on disk, and nothing unlisted ships", () => {
  assert.ok(LOCALES.length - 1 >= MIN_LOCALES, "at least 40 translated languages");
  const onDisk = readdirSync(LOCALE_DIR).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)).sort();
  assert.deepEqual(onDisk, LOCALES.map((locale) => locale.code).sort());
});

const en = readLocale(DEFAULT_LOCALE);
const enKeys = Object.keys(en).sort();

test("en.json is a flat table of non-empty strings with paired plural keys", () => {
  assert.ok(enKeys.length > 0);
  for (const key of enKeys) {
    assert.match(key, /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/, key);
    assert.equal(typeof en[key], "string", key);
    assert.ok(en[key].trim().length > 0, key);
    if (key.endsWith(".one")) assert.ok(`${key.slice(0, -4)}.other` in en, `${key} lacks .other`);
  }
});

for (const { code } of LOCALES.filter((locale) => locale.code !== DEFAULT_LOCALE)) {
  test(`${code}: exactly the en.json key set, same {placeholders}, real translations`, () => {
    const table = readLocale(code);
    assert.deepEqual(Object.keys(table).sort(), enKeys);
    let sameAsEnglish = 0;
    for (const key of enKeys) {
      assert.equal(typeof table[key], "string", `${code} ${key}`);
      assert.ok(table[key].trim().length > 0, `${code} ${key} is empty`);
      assert.deepEqual(placeholders(table[key]), placeholders(en[key]), `${code} ${key} placeholders`);
      if (table[key] === en[key]) sameAsEnglish += 1;
    }
    assert.ok(sameAsEnglish / enKeys.length <= MAX_ENGLISH_SHARE,
      `${code}: ${sameAsEnglish}/${enKeys.length} values are untranslated English`);
  });
}

// Literals that never reach the page, with the reason.
const NOT_PAINTED = new Map([
  ["app.js \"Unknown client exception\"", "client error report payload (staff-only diagnostics)"],
  ["app.js \"Window error\"", "client error report payload (staff-only diagnostics)"],
]);

test("no-copy sweep: no painted English literals left in public/js", () => {
  const leftovers = clientFiles().flatMap((file) =>
    findCopy(readFileSync(file, "utf8"))
      .filter((hit) => !NOT_PAINTED.has(`${file.slice(JS_DIR.length)} ${JSON.stringify(hit.text)}`))
      .map((hit) => `${file.slice(JS_DIR.length)}:${hit.line} ${JSON.stringify(hit.text)}`));
  assert.deepEqual(leftovers, []);
});

test("every literal t()/tn() key used in public/js exists in en.json", () => {
  const missing = [];
  for (const file of [...clientFiles(), join(JS_DIR, "i18n.js")]) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\btn?\(\s*["']([a-z][\w.]*)["']/g)) {
      const key = match[1];
      const isPlural = /\btn\(\s*$/.test(source.slice(0, match.index + 3));
      const present = isPlural ? `${key}.other` in en && `${key}.one` in en : key in en;
      if (!present) missing.push(`${file.slice(JS_DIR.length)} ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("index.html: every visible string and labelled attribute is keyed for translation", () => {
  const html = readFileSync(new URL("public/index.html", ROOT), "utf8");
  let body = html.slice(html.indexOf("<body"), html.indexOf("</body>"));
  for (let previous = ""; previous !== body;) {
    previous = body;
    body = body.replace(/<!--[\s\S]*?-->/g, "");
  }
  // v5.73 (B3): #legacy-notice is, like <noscript>, shown only where the
  // i18n module can never run (nomodule browsers), so it stays English by
  // slate design. Exactly that one block is exempt, nothing else.
  body = body
    .replace(/<noscript>[\s\S]*?<\/noscript>/g, "")
    .replace(/<div id="legacy-notice" class="legacy-notice" hidden>[\s\S]*?<\/div>/, "")
    .replace(/<svg[\s\S]*?<\/svg>/g, "");
  const problems = [];
  for (const match of body.matchAll(/<([a-z][\w-]*)([^>]*)>([^<]*)/g)) {
    const [, tag, attributes, text] = match;
    if (/[A-Za-z]{2,}/.test(text) && !/\bdata-i18n="/.test(attributes)) problems.push(`<${tag}> text "${text.trim()}"`);
    for (const attribute of ["aria-label", "placeholder", "title", "alt"]) {
      const value = attributes.match(new RegExp(`\\s${attribute}="([^"]*)"`))?.[1];
      if (value && /[A-Za-z]{2,}/.test(value) && !attributes.includes(`data-i18n-${attribute}="`)) {
        problems.push(`<${tag}> ${attribute}="${value}"`);
      }
    }
  }
  assert.deepEqual(problems, []);
  for (const match of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) assert.ok(match[1] in en, match[1]);
});

test("each self-mounting surface awaits i18nReady() before painting", () => {
  for (const name of ["app.js", "chat-widget.js", "who-online.js", "webmcp.js"]) {
    assert.match(readFileSync(join(JS_DIR, name), "utf8"), /await i18nReady\(\)/, name);
  }
});

test("Crowdin is gone: no config, no workflow, no mentions", () => {
  for (const path of ["crowdin.yml", ".github/workflows/crowdin.yml"]) {
    assert.throws(() => readFileSync(new URL(path, ROOT)), { code: "ENOENT" }, path);
  }
  for (const path of ["README.md", "package.json", "wrangler.toml"]) {
    assert.doesNotMatch(readFileSync(new URL(path, ROOT), "utf8"), /crowdin/i, path);
  }
});
