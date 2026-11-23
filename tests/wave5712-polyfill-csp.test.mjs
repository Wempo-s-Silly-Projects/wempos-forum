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

// v5.71.2: owner-chosen polyfill (Nov 22 13:33, "use polyfill just in case …
// for people who can't update"; option "Override CSP" picked 13:35). The
// cdnjs polyfill service loads as a classic script before the module graph,
// and only the HTML (static) leg's CSP allows https://cdnjs.cloudflare.com.
// api/vendor/http.mjs stays byte-untouched: the allowance rode makeHttp's
// securityHeaders hook from the app-owned api/core/http.mjs.
// Slate 2026-11-22-e: the cdnjs service is replaced by a self-hosted core-js
// build behind /js/polyfill-loader.js (tests/core-js-polyfill.test.mjs), so
// these pins now assert cdnjs is ABSENT from the shell and every CSP.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { secureResponse, securityHeaders } from "../api/core/http.mjs";
import { cspHosts } from "./helpers/csp.mjs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const POLYFILL_ORIGIN = "https://cdnjs.cloudflare.com";
const scriptSrc = (csp) => (csp.match(/script-src ([^;]+);/) ?? [])[1] ?? "";

test("the HTML leg's CSP allows no cdnjs source and still forbids inline and eval", () => {
  const csp = secureResponse(new Response("x")).headers.get("Content-Security-Policy");
  const sources = scriptSrc(csp).split(/\s+/);
  assert.deepEqual(sources, ["'self'"]);
  assert.equal(cspHosts(csp).has("cdnjs.cloudflare.com"), false);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https:\/\/\*|\s\*[\s;]/);
  assert.match(csp, /object-src 'none'/);
});

test("non-HTML responses: no cdnjs and (Batch F) no Turnstile origin on JSON, feeds, images", () => {
  const csp = securityHeaders(new Headers()).get("Content-Security-Policy");
  assert.equal(cspHosts(csp).has("cdnjs.cloudflare.com"), false);
  assert.equal(cspHosts(csp).has("challenges.cloudflare.com"), false);
});

test("index.html loads the polyfill gate once, same-origin, before every module script", () => {
  const html = read("public/index.html");
  const tags = html.match(/<script\b[^>]*>/gi) ?? [];
  // Exact origin of the src attribute, not a substring (CodeQL
  // js/incomplete-url-substring-sanitization).
  const srcOrigin = (tag) => {
    const src = (tag.match(/\bsrc="([^"]+)"/) ?? [])[1];
    return src ? new URL(src, "https://wempos-forum.com").origin : null;
  };
  assert.deepEqual(tags.filter((tag) => srcOrigin(tag) === POLYFILL_ORIGIN), [], "no cdnjs tag");
  assert.doesNotMatch(html, /cdnjs/);
  const polyfill = tags.filter((tag) => /polyfill/.test(tag));
  assert.deepEqual(polyfill, ['<script src="/js/polyfill-loader.js">'], "exactly one same-origin gate tag");
  assert.doesNotMatch(polyfill[0], /\b(async|defer|type="module")\b/, "classic blocking script so it runs before modules");
  const firstModule = tags.findIndex((tag) => /type="module"/.test(tag));
  assert.ok(tags.indexOf(polyfill[0]) < firstModule, "polyfill gate precedes the first module script");
  const external = tags.filter((tag) => srcOrigin(tag) !== "https://wempos-forum.com");
  assert.deepEqual(external, [], "no external script in the shell");
});

test("the vendored framework file is untouched (its CSP still lists Turnstile; the app strips it)", () => {
  const vendor = read("api/vendor/http.mjs");
  assert.match(vendor, /script-src 'self' https:\/\/challenges\.cloudflare\.com; style-src 'self';/);
  assert.doesNotMatch(vendor, /cdnjs/);
});
