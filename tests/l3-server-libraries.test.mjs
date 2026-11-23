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

// L3 server libraries (owner order: one library per job, replacing the
// in-house twin). Each block pins the swap at the source (the import is the
// library, the hand-rolled loop is gone) and the behaviour the swap must keep:
//   cookie-es          session cookie parse + serialize (api/core/cookies.mjs)
//   strip-bom          member body text (api/core/text.mjs); normalize-newline
//                      skipped: v5 leaves a lone CR, our contract folds it
//   fresh              conditional GET for /feed.xml and /llms.txt
//   escape-html        the XML/HTML escaper behind feeds and sitemaps
//   serialize-error    MCP internal-error logging
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, seedPost, seedUser } from "./helpers/seed.mjs";

const source = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

// ---- cookie-es ---------------------------------------------------------
test("cookies: the session cookie helpers are cookie-es, not a hand-rolled split", () => {
  const cookies = source("api/core/cookies.mjs");
  assert.match(cookies, /from "cookie-es"/);
  const auth = source("api/core/auth.mjs");
  assert.ok(!auth.includes('split(";")'), "in-house cookie split still in auth.mjs");
  assert.ok(!/"__Host-wempo_session=" \+/.test(auth), "hand-built Set-Cookie string still in auth.mjs");
  assert.ok(!source("api/session.mjs").includes('"__Host-wempo_session=; Path'), "hand-built clear cookie in session.mjs");
});

test("cookies: cookieValue takes the FIRST duplicate, ignores lookalike names and is prototype-safe", async () => {
  const { cookieValue } = await import("../api/core/cookies.mjs");
  const req = (cookie) => new Request("https://wempos-forum.com/", { headers: { Cookie: cookie } });
  assert.equal(cookieValue(req("a=1; __Host-wempo_session=first; __Host-wempo_session=second"), "__Host-wempo_session"), "first");
  assert.equal(cookieValue(req("x__Host-wempo_session=evil"), "__Host-wempo_session"), null);
  assert.equal(cookieValue(req("wempo_session=legacy"), "__Host-wempo_session"), null);
  assert.equal(cookieValue(req("  wempo_session =  legacy  "), "wempo_session"), "legacy");
  assert.equal(cookieValue(req(""), "wempo_session"), null);
  assert.equal(cookieValue(new Request("https://wempos-forum.com/"), "wempo_session"), null);
  assert.equal(cookieValue(req("a=1"), "__proto__"), null);
  assert.equal(cookieValue(req("a=1"), "constructor"), null);
  assert.equal(cookieValue(req("a=1"), "toString"), null);
});

test("cookies: sessionCookie serializes the full __Host- attribute set; clear is Max-Age=0", async () => {
  const { sessionCookie } = await import("../api/core/cookies.mjs");
  const parts = (value) => value.split("; ");
  const set = parts(sessionCookie("__Host-wempo_session", "TOKEN", 3600));
  assert.equal(set[0], "__Host-wempo_session=TOKEN");
  for (const attr of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=3600"]) assert.ok(set.includes(attr), attr);
  assert.ok(!set.some((p) => /^Domain=/i.test(p)), "__Host- cookies must not carry Domain");
  const cleared = parts(sessionCookie("__Host-wempo_session", "", 0));
  assert.equal(cleared[0], "__Host-wempo_session=");
  assert.ok(cleared.includes("Max-Age=0"));
  assert.ok(cleared.includes("Secure"));
  assert.throws(() => sessionCookie("__Host-wempo_session", "a;b", 10), "a value with ; must be refused");
});

test("cookies: a forged session cookie still signs the member in; a lookalike name does not", async () => {
  const env = makeEnv();
  const alice = await seedUser(env.__sqlite, { username: "alice" });
  const session = forgeSession(env.__sqlite, alice);
  const me = await (await call(env, "/api/session", { session })).json();
  assert.equal(me.user && me.user.username, "alice");
  const token = session.cookie.split("=")[1];
  const spoof = { cookie: "x__Host-wempo_session=" + token, csrf: session.csrf };
  const anon = await (await call(env, "/api/session", { session: spoof })).json();
  assert.equal(anon.user, null);
});

// ---- strip-bom + normalize-newline -------------------------------------
test("text: normalizeBodyText is strip-bom (normalize-newline skipped: leaves lone CR) and keeps its contract", async () => {
  const text = source("api/core/text.mjs");
  assert.match(text, /from "strip-bom"/);
  assert.ok(!/^import .*LEADING_BOM/m.test(text) && !/const LEADING_BOM/.test(text), "in-house BOM regex still present");
  const { normalizeBodyText } = await import("../api/core/text.mjs");
  assert.equal(normalizeBodyText("﻿﻿a\r\n\r\nb\rc"), "﻿a\n\nb\nc", "only ONE leading BOM goes");
  assert.equal(normalizeBodyText("a﻿b"), "a﻿b", "an inner BOM stays");
  assert.equal(normalizeBodyText(42), 42);
  assert.equal(normalizeBodyText(null), null);
});

// ---- fresh -------------------------------------------------------------
test("feeds: conditional GET goes through fresh (weak match, list match, star)", async () => {
  assert.match(source("api/feeds.mjs"), /from "fresh"/);
  const env = makeEnv();
  const alice = await seedUser(env.__sqlite, { username: "alice" });
  seedPost(env.__sqlite, { authorId: alice, body: "FRESHTXT" });
  const first = await call(env, "/feed.xml");
  const etag = first.headers.get("ETag");
  assert.match(etag, /^W\/"[0-9a-f]+"$/);
  const strongForm = etag.slice(2);
  for (const inm of [etag, strongForm, '"nope", ' + etag, "*"]) {
    const res = await call(env, "/feed.xml", { headers: { "If-None-Match": inm } });
    assert.equal(res.status, 304, inm);
  }
  assert.equal((await call(env, "/feed.xml", { headers: { "If-None-Match": '"nope"' } })).status, 200);
  const noCache = await call(env, "/feed.xml", { headers: { "If-None-Match": etag, "Cache-Control": "no-cache" } });
  assert.equal(noCache.status, 200, "an explicit no-cache reload is never answered 304");
});

// ---- escape-html -------------------------------------------------------
test("xmlEscape is escape-html: all five specials, numeric apostrophe, no double-escape surprises", async () => {
  assert.match(source("api/discovery.mjs"), /from "escape-html"/);
  const { xmlEscape } = await import("../api/discovery.mjs");
  assert.equal(xmlEscape(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  assert.equal(xmlEscape("&amp;"), "&amp;amp;");
  assert.equal(xmlEscape(5), "5");
});

// ---- serialize-error ---------------------------------------------------
test("mcp: internal errors are logged through serialize-error", () => {
  const mcp = source("api/mcp.mjs");
  assert.match(mcp, /from "serialize-error"/);
  assert.match(mcp, /serializeError\(error\)/);
});
