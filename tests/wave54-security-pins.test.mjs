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


// Wave 5.4 security review of v4.45.0..v5.3.0 (docs/drafts/security-review-5.4.md):
// regression pins for the honest-404 path (routeForPath runs on the worker
// against attacker-chosen paths), the 74 locale bundles (strings render as
// text, never markup) and the tab-title count.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { makeAssets, makeEnv } from "./helpers/d1.mjs";
import { call } from "./helpers/seed.mjs";
import { routeForPath } from "../public/js/router.js";
import { LOCALES } from "../public/js/i18n.js";
import worker from "../worker.mjs";

const PUBLIC_DIR = new URL("../public/", import.meta.url).pathname;
const SHELL = readFileSync(join(PUBLIC_DIR, "index.html"), "utf8");
const TYPES = { ".json": "application/json", ".js": "text/javascript", ".css": "text/css" };

// The ASSETS binding as configured (not_found_handling = SPA): a real file
// with its own type, any other path index.html with 200.
const realisticAssets = () => makeAssets((request) => {
  const { pathname } = new URL(request.url);
  const file = join(PUBLIC_DIR, pathname);
  if (pathname !== "/" && file.startsWith(PUBLIC_DIR)) {
    try {
      const data = readFileSync(file);
      return new Response(data, { status: 200, headers: { "Content-Type": TYPES[extname(file)] || "application/octet-stream" } });
    } catch {
      // Missing file or a directory (EISDIR): the SPA fallback below.
    }
  }
  return new Response(request.method === "HEAD" ? null : SHELL, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
});

const get = (path) => call(makeEnv({ ASSETS: realisticAssets() }), path);

// F1 (LOW): BOARD_BY_SLUG is a plain object, so /c/constructor matched the
// inherited Object.prototype.constructor — a 200 shell and a category view
// for a board that does not exist (the feed then asked for board=undefined).
for (const slug of ["constructor"]) {
  test(`/c/${slug} is not a category (no prototype-chain board)`, async () => {
    assert.deepEqual(routeForPath(`/c/${slug}`, "?view=new"), { name: "not-found" });
    const response = await get(`/c/${slug}`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  });
}

test("/bookmarks?board=constructor degrades to the whole list", () => {
  assert.deepEqual(routeForPath("/bookmarks", "?board=constructor"), { name: "bookmarks" });
});

// Encoded and odd paths: each is a 404 shell (never cacheable, never a
// redirect), and none reaches a file outside public/.
for (const path of [
  "//", "//evil.example/x", "/%2e%2e/%2e%2e/worker.mjs", "/locales/../wrangler.toml",
  "/locales%2fen.json", "/LOCALES/xx.json", "/posts/1/", "/posts/%31", "/c/General",
  "/admin/" + "a".repeat(4000) + "!", "/this-does-not-exist?view=new&q=x",
]) {
  test(`odd path ${path.slice(0, 40)} answers a 404 shell with no redirect`, async () => {
    const response = await get(path);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Location"), null);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.match(response.headers.get("Content-Type"), /text\/html/);
  });
}

test("routeForPath stays linear on long attacker paths", () => {
  const paths = ["/admin/" + "a-".repeat(50000) + "!", "/users/" + "%".repeat(50000), "/c/" + "a".repeat(100000) + "/"];
  const started = performance.now();
  for (const path of paths) assert.equal(routeForPath(path, "").name, "not-found");
  assert.ok(performance.now() - started < 500, "routeForPath took too long on long paths");
});

// The removed Unanswered view: an old link opens the default feed (200), and
// the query string never flips a page's status.
for (const path of ["/?view=unanswered", "/c/general?view=unanswered", "/posts/1?view=x"]) {
  test(`old/odd query ${path} keeps a known route at 200`, async () => {
    assert.equal((await get(path)).status, 200);
  });
}

for (const [path, status] of [["/nope", 404], ["/rules", 200]]) {
  test(`HEAD ${path} answers ${status} like GET`, async () => {
    const env = makeEnv({ ASSETS: realisticAssets() });
    const response = await worker.fetch(new Request("https://wempos-forum.com" + path, { method: "HEAD" }), env, { waitUntil() {} });
    assert.equal(response.status, status);
  });
}

// Locale bundles: every value is plain text (rendered via textContent) — no
// tags, entities, script URLs or bidi overrides that could flip a layout.
const LOCALE_DIR = join(PUBLIC_DIR, "locales");
const flatten = (object, prefix = "") => Object.entries(object).flatMap(([key, value]) =>
  value && typeof value === "object" ? flatten(value, prefix + key + ".") : [[prefix + key, value]]);
const UNSAFE_TEXT = /[<>]|&#?\w+;|javascript:|data:|vbscript:|[‪-‮⁦-⁩]/i;

test("every shipped locale has a bundle and every bundle is a shipped locale", () => {
  const files = readdirSync(LOCALE_DIR).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5));
  assert.deepEqual(files.sort(), LOCALES.map((locale) => locale.code).sort());
  assert.equal(files.length, 74);
});

test("no locale string carries markup, entities, script URLs or bidi overrides", () => {
  const offenders = [];
  for (const { code } of LOCALES) {
    for (const [key, value] of flatten(JSON.parse(readFileSync(join(LOCALE_DIR, code + ".json"), "utf8")))) {
      if (typeof value !== "string") offenders.push(`${code}:${key} is not a string`);
      else if (UNSAFE_TEXT.test(value)) offenders.push(`${code}:${key}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the tab-title count and its toggle paint text only", () => {
  const source = readFileSync(new URL("../public/js/tab-unread.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(source, /\bapi\(|fetch\(/);
});
