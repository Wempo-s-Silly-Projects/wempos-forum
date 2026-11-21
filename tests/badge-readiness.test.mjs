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

// Badge-readiness polish: small static pins for the shell's description,
// the package license field and the RFC 9116 security.txt file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeAssets, makeEnv } from "./helpers/d1.mjs";
import { call } from "./helpers/seed.mjs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("the app shell carries a static English meta description", () => {
  const match = read("public/index.html").match(/<meta name="description" content="([^"]+)">/);
  assert.ok(match, "missing <meta name=\"description\">");
  assert.ok(match[1].length >= 50 && match[1].length <= 160, "description length " + match[1].length);
});

test("package.json declares the AGPL-3.0-or-later license", () => {
  assert.equal(JSON.parse(read("package.json")).license, "AGPL-3.0-or-later");
});

// RFC 9116: a real file under public/.well-known/ passes the worker's honest
// 404 guard (only the SPA's HTML fallback is re-judged there).
const SECURITY_TXT = read("public/.well-known/security.txt");

test("security.txt carries the RFC 9116 fields with an unexpired date", () => {
  assert.match(SECURITY_TXT, /^Contact: https:\/\/github\.com\/Wempo-s-Silly-Projects\/wempos-forum\/security\/advisories\/new$/m);
  assert.match(SECURITY_TXT, /^Policy: https:\/\/github\.com\/Wempo-s-Silly-Projects\/wempos-forum\/blob\/main\/SECURITY\.md$/m);
  assert.match(SECURITY_TXT, /^Preferred-Languages: en$/m);
  const expires = SECURITY_TXT.match(/^Expires: (\S+)$/m);
  assert.ok(expires, "missing Expires");
  assert.ok(Date.parse(expires[1]) > Date.now(), "security.txt has expired — renew the Expires line");
  assert.equal(SECURITY_TXT.match(/^Expires:/gm).length, 1);
});

test("the worker serves /.well-known/security.txt as text/plain, not the SPA shell", async () => {
  const shell = read("public/index.html");
  const assets = makeAssets((request) => new URL(request.url).pathname === "/.well-known/security.txt"
    ? new Response(SECURITY_TXT, { status: 200, headers: { "Content-Type": "text/plain" } })
    : new Response(shell, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }));
  const response = await call(makeEnv({ ASSETS: assets }), "/.well-known/security.txt");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /text\/plain/);
  assert.equal(await response.text(), SECURITY_TXT);
});
