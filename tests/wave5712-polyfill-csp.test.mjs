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
// api/vendor/http.mjs stays byte-untouched: the allowance rides makeHttp's
// securityHeaders hook from the app-owned api/core/http.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { secureResponse, securityHeaders } from "../api/core/http.mjs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const POLYFILL_ORIGIN = "https://cdnjs.cloudflare.com";
const scriptSrc = (csp) => (csp.match(/script-src ([^;]+);/) ?? [])[1] ?? "";

test("the HTML leg's CSP allows the cdnjs polyfill origin and still forbids inline and eval", () => {
  const csp = secureResponse(new Response("x")).headers.get("Content-Security-Policy");
  const sources = scriptSrc(csp).split(/\s+/);
  assert.deepEqual(sources, ["'self'", "https://challenges.cloudflare.com", POLYFILL_ORIGIN]);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https:\/\/\*|\s\*[\s;]/);
  assert.match(csp, /object-src 'none'/);
});

test("non-HTML responses keep the vendor CSP (no cdnjs on JSON, feeds, images)", () => {
  const csp = securityHeaders(new Headers()).get("Content-Security-Policy");
  assert.doesNotMatch(csp, /cdnjs/);
});

test("index.html loads the polyfill once, before every module script, without leaking the referrer", () => {
  const html = read("public/index.html");
  const tags = html.match(/<script\b[^>]*>/gi) ?? [];
  // Exact origin of the src attribute, not a substring (CodeQL
  // js/incomplete-url-substring-sanitization): a look-alike host such as
  // cdnjs.cloudflare.com.evil.example must not count as the polyfill.
  const srcOrigin = (tag) => {
    const src = (tag.match(/\bsrc="([^"]+)"/) ?? [])[1];
    return src ? new URL(src, "https://wempos-forum.com").origin : null;
  };
  const polyfill = tags.filter((tag) => srcOrigin(tag) === POLYFILL_ORIGIN);
  assert.equal(polyfill.length, 1, "exactly one polyfill tag");
  assert.match(polyfill[0], /src="https:\/\/cdnjs\.cloudflare\.com\/polyfill\/v3\/polyfill\.min\.js\?version=4\.8\.0&amp;features=/);
  assert.match(polyfill[0], /referrerpolicy="no-referrer"/);
  assert.doesNotMatch(polyfill[0], /\b(async|defer|type="module")\b/, "classic blocking script so it runs before modules");
  const firstModule = tags.findIndex((tag) => /type="module"/.test(tag));
  assert.ok(tags.indexOf(polyfill[0]) < firstModule, "polyfill precedes the first module script");
  const external = tags.filter((tag) => /src="https?:\/\//.test(tag));
  assert.deepEqual(external, polyfill, "the polyfill is the only external script in the shell");
});

test("the vendored framework file is untouched (CSP still only lists Turnstile there)", () => {
  const vendor = read("api/vendor/http.mjs");
  assert.match(vendor, /script-src 'self' https:\/\/challenges\.cloudflare\.com; style-src 'self';/);
  assert.doesNotMatch(vendor, /cdnjs/);
});
