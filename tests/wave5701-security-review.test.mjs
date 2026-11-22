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

// v5.70.1 security review of v5.67-v5.70 (docs/security-review-v5.67-v5.70.md):
// regression pins for the eight new locale bundles (af sq az eu ab aa am ak),
// the plural-rules fallback, the locale loader and picker, the PATCH /api/me
// write limit order, the shared sign-up social column list and the v5.70
// font stack. No finding needed a fix, so every pin here is a regression pin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeAssets, makeEnv } from "./helpers/d1.mjs";
import { call } from "./helpers/seed.mjs";
import { LOCALES, createTranslator, detectLocale, localeDir } from "../public/js/i18n.js";
import { SOCIAL_PLATFORMS, SOCIAL_SELECT_COLUMNS } from "../api/core/shapers.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const NEW_CODES = ["af", "sq", "az", "eu", "ab", "aa", "am", "ak"];
const EN = JSON.parse(read("public/locales/en.json"));
const bundle = (code) => JSON.parse(read(`public/locales/${code}.json`));
const placeholders = (text) => (text.match(/\{\{?\s*[\w.]+\s*\}?\}/g) || []).sort();
const braces = (text) => [...text].filter((char) => char === "{" || char === "}").length;

// Markup, entities, script schemes; C0/C1 controls (tab/newline aside),
// zero-width and bidi marks/embeddings/overrides/isolates, word joiner and
// invisible operators, BOM and soft hyphen. None is expected in these scripts
// (Latin, Cyrillic, Ethiopic), all left to right.
const UNSAFE_MARKUP = /[<>]|&#?\w+;|javascript:|data:|vbscript:/i;
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/;

test("each new locale is registered once, left to right, with a bundle", () => {
  for (const code of NEW_CODES) {
    const entries = LOCALES.filter((locale) => locale.code === code);
    assert.equal(entries.length, 1, code);
    assert.equal(entries[0].dir, "ltr", code);
    assert.equal(localeDir(code), "ltr", code);
    assert.ok(entries[0].name.length > 0, code);
    assert.doesNotMatch(entries[0].name, UNSAFE_MARKUP, code);
    assert.doesNotMatch(entries[0].name, UNSAFE_CHARS, code);
  }
});

test("each new bundle is a flat string map with exactly en's keys", () => {
  const enKeys = Object.keys(EN).sort();
  for (const code of NEW_CODES) {
    const raw = read(`public/locales/${code}.json`);
    assert.notEqual(raw.charCodeAt(0), 0xfeff, `${code} BOM`);
    const table = JSON.parse(raw);
    assert.deepEqual(Object.keys(table).sort(), enKeys, code);
    for (const key of enKeys) assert.equal(typeof table[key], "string", `${code} ${key}`);
  }
});

test("each new string keeps en's placeholder set and adds no braces, markup or hidden characters", () => {
  for (const code of NEW_CODES) {
    const table = bundle(code);
    for (const key of Object.keys(EN)) {
      const text = table[key];
      assert.deepEqual(placeholders(text), placeholders(EN[key]), `${code} ${key} placeholders`);
      assert.equal(braces(text), braces(EN[key]), `${code} ${key} braces`);
      if (!EN[key].includes("{{")) assert.ok(!text.includes("{{"), `${code} ${key} {{`);
      assert.doesNotMatch(text, UNSAFE_MARKUP, `${code} ${key} markup`);
      assert.doesNotMatch(text, UNSAFE_CHARS, `${code} ${key} hidden char`);
    }
  }
});

test("locale detection only ever yields a shipped code", () => {
  for (const code of NEW_CODES) {
    assert.equal(detectLocale(code), code);
    assert.equal(detectLocale(null, [`${code}-XX`]), code);
  }
  const shipped = new Set(LOCALES.map((locale) => locale.code));
  for (const hostile of ["../en", "ab/../../x", "aa.json", "am%2F..", "ak?x=1", "<am>", "ab‮", ""]) {
    assert.ok(shipped.has(detectLocale(hostile)), hostile);
    assert.ok(shipped.has(detectLocale(null, [hostile])), hostile);
  }
});

test("plural rules: ab and aa use the n = 1 split, never the runtime's language", () => {
  const messages = { "x.one": "ONE {count}", "x.other": "OTHER {count}" };
  for (const code of ["ab", "aa"]) {
    const { tn } = createTranslator(code, messages, messages);
    assert.equal(tn("x", 1), "ONE 1", code);
    for (const count of [0, 2, 3, 5, 11, 21, 22, 101]) assert.equal(tn("x", count), `OTHER ${count}`, `${code} ${count}`);
  }
  for (const code of NEW_CODES) assert.match(createTranslator(code, messages, messages).tn("x", 7), /^(ONE|OTHER) 7$/);
});

test("the locale loader encodes the code and every surface paints strings as text", () => {
  const source = read("public/js/i18n.js");
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.match(source, /fetch\(`\/locales\/\$\{encodeURIComponent\(code\)\}\.json`/);
  assert.match(source, /option\.textContent = locale\.name;/);
  assert.match(source, /node\.textContent = t\(node\.dataset\.i18n\);/);
  // The plural fallback added no storage, network or account-scoped key.
  const plural = source.slice(source.indexOf("function pluralRulesFor"), source.indexOf("export function createTranslator"));
  assert.ok(plural.length > 0);
  assert.doesNotMatch(plural, /localStorage|sessionStorage|fetch\(|api\(/);
  assert.doesNotMatch(source, /sessionStorage|:u\$?\{/);
});

const PUBLIC_DIR = new URL("../public/", import.meta.url).pathname;
const SHELL = readFileSync(join(PUBLIC_DIR, "index.html"), "utf8");
const realisticAssets = () => makeAssets((request) => {
  const { pathname } = new URL(request.url);
  const file = join(PUBLIC_DIR, pathname);
  if (pathname !== "/" && file.startsWith(PUBLIC_DIR)) {
    try {
      return new Response(readFileSync(file), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch {
      // Missing file: the SPA fallback below.
    }
  }
  return new Response(SHELL, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
});

test("new bundles serve 200 JSON; unknown locale paths stay an honest 404", async () => {
  const env = makeEnv({ ASSETS: realisticAssets() });
  for (const code of NEW_CODES) {
    const response = await call(env, `/locales/${code}.json`);
    assert.equal(response.status, 200, code);
    assert.match(response.headers.get("Content-Type") || "", /application\/json/, code);
  }
  for (const path of ["/locales/unknown.json", "/locales/xx.json", "/locales/ab-XX.json"]) {
    const response = await call(env, path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(await response.text(), /<html/i, path);
  }
});

test("PATCH /api/me: auth, ban gate, then the write limit, all before the body is read", () => {
  const source = read("api/profiles.mjs");
  const start = source.indexOf('if (path === "/api/me" && method === "PATCH")');
  assert.ok(start > 0);
  const block = source.slice(start, start + 600);
  const order = ["requireUser(request, env)", "assertNotBanned(env, session.user.id)",
    'rateLimit(request, env, "write", String(session.user.id))', "readJson(request, ME_JSON_BYTES)"]
    .map((needle) => block.indexOf(needle));
  for (const index of order) assert.ok(index > 0);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("sign-up read: the shared social list is code-built column names with one bound id", () => {
  assert.equal(SOCIAL_SELECT_COLUMNS, SOCIAL_PLATFORMS.map((platform) => platform.column).join(", ") + ", ");
  for (const platform of SOCIAL_PLATFORMS) assert.match(platform.column, /^[a-z_]+$/);
  const source = read("api/session.mjs");
  const start = source.indexOf("SOCIAL_SELECT_COLUMNS +");
  assert.ok(start > 0);
  const statement = source.slice(source.lastIndexOf("prepare(", start), source.indexOf(".first()", start));
  assert.equal((statement.match(/\?/g) || []).length, 1);
  assert.match(statement, /FROM users WHERE id = \? LIMIT 1/);
  assert.match(statement, /\.bind\(Number\(result\.meta\.last_row_id\)\)/);
});

test("v5.70 font stack names local fonts only: no web font fetch", () => {
  const css = read("public/styles.css");
  assert.match(css, /font-family: "Trebuchet MS", "Segoe UI", "Noto Sans Ethiopic", "Kefa", "Nyala", "Ebrima", sans-serif;/);
  assert.doesNotMatch(css, /@font-face|@import|url\(\s*["']?(?:https?:)?\/\//i);
});
