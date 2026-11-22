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

// v5.73.1 security review of v5.71.0-v5.73.0 (docs/security-review-v5.71-v5.73.md).
// M1 (fixed): the HTML leg's script-src allowed every script on
// https://cdnjs.cloudflare.com, a public CDN that hosts CSP-bypass gadgets
// (old AngularJS and friends); it is now scoped to the polyfill path. The
// rest are regression pins: the 16 new locale bundles, the locale loader,
// the polyfill tag shape, the nomodule notice, the two-state theme value,
// the HTML sinks and the CSS / source-map hygiene.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { makeAssets, makeEnv } from "./helpers/d1.mjs";
import { call } from "./helpers/seed.mjs";
import { FakeNode } from "./helpers/fake-dom.mjs";
import { json, secureResponse, securityHeaders } from "../api/core/http.mjs";
import { LOCALES, detectLocale, localeDir } from "../public/js/i18n.js";
import { resolveTheme, THEME_FOLLOW_OS, THEME_STORAGE_KEY } from "../public/js/theme.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const NEW_CODES = ["an", "hy", "as", "av", "ay", "bm", "ba", "be", "bi", "bs", "br", "my", "ch", "ce", "ny", "cv"];
const EN = JSON.parse(read("public/locales/en.json"));
const bundle = (code) => JSON.parse(read(`public/locales/${code}.json`));
const placeholders = (text) => (text.match(/\{\{?\s*[\w.]+\s*\}?\}/g) || []).sort();
const braces = (text) => [...text].filter((char) => char === "{" || char === "}").length;
// Markup, entities, script schemes; C0/C1 controls (tab/newline aside),
// Arabic letter mark, zero-width and bidi marks/embeddings/overrides/isolates,
// word joiner and invisible operators, BOM and soft hyphen. None is expected
// in these scripts (Latin, Cyrillic, Armenian, Bengali-Assamese, Myanmar),
// all left to right; the 16 bundles carry no ZWJ/ZWNJ either.
const UNSAFE_MARKUP = /[<>]|&#?\w+;|javascript:|data:|vbscript:/i;
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/;

const directives = (csp) => new Map(csp.split(";").map((part) => part.trim()).filter(Boolean)
  .map((part) => {
    const [name, ...sources] = part.split(/\s+/);
    return [name, sources];
  }));
const POLYFILL_SOURCE = "https://cdnjs.cloudflare.com/polyfill/";

test("M1: the HTML leg allows only the cdnjs polyfill path, not the whole CDN", () => {
  const csp = secureResponse(new Response("x")).headers.get("Content-Security-Policy");
  const scriptSrc = directives(csp).get("script-src");
  assert.deepEqual(scriptSrc, ["'self'", "https://challenges.cloudflare.com", POLYFILL_SOURCE]);
  // Exact source-list comparison (not a URL substring test): no entry may be the bare CDN origin.
  const HOST_WIDE_CDNJS = "https://cdnjs.cloudflare.com";
  assert.equal(scriptSrc.filter((source) => source === HOST_WIDE_CDNJS).length, 0, "no host-wide cdnjs source");
  // The shell's polyfill URL sits under the allowed path.
  const src = (read("public/index.html").match(/<script src="(https:\/\/cdnjs\.cloudflare\.com\/[^"]+)"/) ?? [])[1];
  assert.ok(src && src.startsWith(POLYFILL_SOURCE), src);
});

test("the HTML leg differs from the vendor CSP in script-src only, and loosens nothing else", () => {
  const html = directives(secureResponse(new Response("x")).headers.get("Content-Security-Policy"));
  const vendor = directives(securityHeaders(new Headers()).get("Content-Security-Policy"));
  // v5.76 (Batch D, embeds) deliberately adds media-src and appends to
  // exactly these directives; tests/wave576-embeds.test.mjs pins the values.
  const widened = new Set(["script-src", "style-src", "img-src", "connect-src", "frame-src", "media-src"]);
  assert.deepEqual([...html.keys()].filter((name) => name !== "media-src"), [...vendor.keys()]);
  for (const [name, sources] of vendor) if (!widened.has(name)) assert.deepEqual(html.get(name), sources, name);
  for (const [name, sources] of vendor) {
    if (widened.has(name)) assert.deepEqual(html.get(name).slice(0, sources.length), sources, name + " only appends");
  }
  assert.equal(html.get("script-src").length, 3);
  assert.equal(html.get("style-src").length, 2);
  assert.match(html.get("style-src")[1], /^'sha256-[A-Za-z0-9+/]+=*'$/);
  for (const name of ["default-src", "script-src", "style-src"]) {
    for (const source of html.get(name)) assert.doesNotMatch(source, /unsafe-|^\*$|^https?:$|^https?:\/\/\*|^data:$|^blob:$/, `${name} ${source}`);
  }
  for (const sources of html.values()) for (const source of sources) assert.doesNotMatch(source, /unsafe-/, source);
  // JSON (API) responses keep the vendor set untouched.
  assert.equal(json({}).headers.get("Content-Security-Policy"), securityHeaders(new Headers()).get("Content-Security-Policy"));
});

test("the polyfill tag is exactly one classic external script with src and no-referrer only", () => {
  const html = read("public/index.html");
  const external = (html.match(/<script\b[^>]*>/gi) ?? []).filter((tag) => /\bsrc="https?:/i.test(tag));
  assert.equal(external.length, 1);
  assert.match(external[0], /^<script src="https:\/\/cdnjs\.cloudflare\.com\/polyfill\/v3\/polyfill\.min\.js\?[^"\s<>]+" referrerpolicy="no-referrer">$/);
});

test("the nomodule notice: same-origin classic file, static hidden block, plain ES5 with no side channels", () => {
  const html = read("public/index.html");
  assert.match(html, /<script nomodule src="\/js\/legacy-notice\.js"><\/script>/);
  const block = (html.match(/<div id="legacy-notice" class="legacy-notice" hidden>[\s\S]*?<\/div>/) ?? [])[0];
  assert.ok(block);
  assert.doesNotMatch(block, /<script|\son\w+=|style=|javascript:/i);
  assert.deepEqual(block.match(/href="[^"]*"/g), ['href="https://www.mozilla.org/firefox/new/"']);

  const source = read("public/js/legacy-notice.js");
  const code = source.split("\n").filter((line) => !line.startsWith("//")).join("\n");
  assert.doesNotMatch(code, /=>|\blet\b|\bconst\b|\bclass\b|\bimport\b|\bexport\b|`/, "plain ES5");
  assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval|Function\(|setTimeout|setInterval/);
  assert.doesNotMatch(code, /localStorage|sessionStorage|cookie|fetch|XMLHttpRequest|sendBeacon|navigator|location|\.src\b/);

  // Runs without modules: un-hides the block and touches nothing else.
  const notice = new FakeNode("div");
  notice.setAttribute("hidden", "");
  const asked = [];
  const document = {
    getElementById: (id) => {
      asked.push(id);
      return id === "legacy-notice" ? notice : null;
    },
  };
  vm.runInNewContext(source, { document });
  assert.equal(notice.hasAttribute("hidden"), false);
  assert.deepEqual(asked, ["legacy-notice"]);
  assert.doesNotThrow(() => vm.runInNewContext(source, { document: { getElementById: () => null } }));
});

test("theme two-state: 'system' rides the same device-pref key and always means follow the OS", () => {
  assert.equal(THEME_STORAGE_KEY, "forum-theme");
  assert.equal(THEME_FOLLOW_OS, "system");
  assert.equal(resolveTheme(THEME_FOLLOW_OS, true), "dark");
  assert.equal(resolveTheme(THEME_FOLLOW_OS, false), "light");
  const preload = read("public/js/theme-preload.js");
  assert.match(preload, /if \(storedTheme === "dark" \|\| storedTheme === "light"\) \{/);
  const theme = read("public/js/theme.js");
  // Only named *_KEY constants are written: no new ad-hoc key family.
  for (const write of theme.match(/setItem\([^,]+,/g) ?? []) assert.match(write, /^setItem\([A-Z_]+_KEY,$/, write);
  assert.doesNotMatch(theme, /:u\$?\{|sessionStorage/);
});

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
  const files = readdirSync(new URL("../public/locales/", import.meta.url)).filter((name) => name.endsWith(".json"));
  assert.deepEqual(files.map((name) => name.slice(0, -5)).sort(), LOCALES.map((locale) => locale.code).sort());
});

test("each new bundle is a flat string map with exactly en's keys, no BOM", () => {
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
  for (const hostile of ["../en", "hy/../../x", "br.json", "my%2F..", "cv?x=1", "<bs>", "be\u202E", ""]) {
    assert.ok(shipped.has(detectLocale(hostile)), hostile);
    assert.ok(shipped.has(detectLocale(null, [hostile])), hostile);
  }
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
  for (const path of ["/locales/unknown.json", "/locales/xx.json", "/locales/hy-AM.json"]) {
    const response = await call(env, path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(await response.text(), /<html/i, path);
  }
});

test("no client module writes HTML: DM bubbles, the notice and every string paint as text", () => {
  const dir = new URL("../public/js/", import.meta.url);
  const files = readdirSync(dir, { recursive: true })
    .filter((name) => name.endsWith(".js") && !name.startsWith("vendor"));
  assert.ok(files.length > 20);
  for (const name of files) {
    const code = readFileSync(new URL(name, dir), "utf8").split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");
    assert.doesNotMatch(code, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\(|document\.write\(|\beval\(|new Function\(/, name);
  }
});

test("v5.71-v5.73 CSS adds no remote fetch; source maps are uploaded, never served", () => {
  const css = read("public/styles.css");
  assert.doesNotMatch(css, /@font-face|@import|url\(\s*["']?(?:https?:)?\/\//i);
  const notice = css.slice(css.indexOf(".legacy-notice {"), css.indexOf(".legacy-notice[hidden]"));
  assert.ok(notice.length > 0);
  assert.doesNotMatch(notice, /url\(/);
  assert.match(read("wrangler.toml"), /^upload_source_maps = true$/m);
  const maps = readdirSync(new URL("../public/", import.meta.url), { recursive: true }).filter((name) => name.endsWith(".map"));
  assert.deepEqual(maps, []);
});
