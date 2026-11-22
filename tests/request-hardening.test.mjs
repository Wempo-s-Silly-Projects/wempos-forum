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

// Worker request hardening: safe JSON bodies, length-safe token compares,
// Sec-Fetch-Site on writes, internal-path redirects, one Content-Type
// parser, BOM/CRLF body normalisation, and the first-visit locale pick.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv, TEST_RELAY_TOKEN } from "./helpers/d1.mjs";
import { ORIGIN, call, forgeSession, seedUser } from "./helpers/seed.mjs";
import { equalConstantTime } from "../api/core/crypto.mjs";
import { parseJsonSafely, parseContentType } from "../api/core/http.mjs";
import { normalizeBodyText } from "../api/core/text.mjs";
import { safeInternalPath } from "../public/js/safe-path.js";
import { detectLocale } from "../public/js/i18n.js";
import { MAX_COMPOSER_BODY_CHARS } from "../api/posts-write.mjs";

let env;
let session;
let userId;

before(async () => {
  env = makeEnv();
  userId = await seedUser(env.__sqlite, { username: "Hardy", password: "correct horse battery" });
  session = forgeSession(env.__sqlite, userId);
});

const freshSession = () => forgeSession(env.__sqlite, userId);
const rawPost = (path, rawBody, headers = {}, s = session) =>
  call(env, path, { method: "POST", session: s, body: rawBody, headers: { "Content-Type": "application/json", ...headers } });

// ---- 1. JSON bodies --------------------------------------------------------

test("parseJsonSafely rejects __proto__ keys at any depth", () => {
  assert.throws(() => parseJsonSafely('{"__proto__":{"polluted":true}}'));
  assert.throws(() => parseJsonSafely('{"a":{"b":[{"__proto__":{"polluted":true}}]}}'));
  assert.throws(() => parseJsonSafely('{"a":{"constructor":{"prototype":{"polluted":true}}}}'));
  assert.equal(({}).polluted, undefined);
});

test("parseJsonSafely parses ordinary JSON unchanged", () => {
  assert.deepEqual(parseJsonSafely('{"body":"hi","n":[1,2,{"x":null}]}'), { body: "hi", n: [1, 2, { x: null }] });
  assert.throws(() => parseJsonSafely("{nope"));
});

test("a prototype-pollution body is refused 400 on a JSON route and stores nothing", async () => {
  const count = () => env.__sqlite.prepare("SELECT COUNT(*) AS n FROM posts").get().n;
  const prior = count();
  const response = await rawPost("/api/posts", '{"body":"polluting","board":"general","__proto__":{"polluted":true}}');
  assert.equal(response.status, 400);
  assert.equal(({}).polluted, undefined);
  assert.equal(count(), prior);
});

test("a nested constructor.prototype body is refused 400", async () => {
  const response = await rawPost("/api/chat", '{"body":"x","meta":{"constructor":{"prototype":{"polluted":true}}}}');
  assert.equal(response.status, 400);
});

test("MCP refuses a __proto__ JSON-RPC body as a parse error", async () => {
  const response = await call(env, "/mcp", {
    method: "POST",
    body: '{"jsonrpc":"2.0","id":1,"method":"tools/list","__proto__":{"polluted":true}}',
    headers: { "Content-Type": "application/json" },
  });
  const reply = await response.json();
  assert.equal(reply.error && reply.error.code, -32700);
  assert.equal(({}).polluted, undefined);
});

test("request-body routes no longer call a bare JSON.parse", () => {
  for (const file of ["api/mcp.mjs", "api/filterstore.mjs", "api/profiles.mjs", "api/rules.mjs"]) {
    const source = readFileSync(new URL("../" + file, import.meta.url), "utf8");
    assert.ok(!/\bJSON\.parse\(/.test(source), file + " still calls JSON.parse on request data");
  }
});

// ---- 2. constant-time compare ---------------------------------------------

test("equalConstantTime keeps its answers", () => {
  assert.equal(equalConstantTime("abc", "abc"), true);
  assert.equal(equalConstantTime("", ""), true);
  assert.equal(equalConstantTime("abc", "abd"), false);
  assert.equal(equalConstantTime("abc", "abcd"), false);
  assert.equal(equalConstantTime("abcd", "abc"), false);
  assert.equal(equalConstantTime("a\u0000", "a"), false, "zero padding must not collide");
  assert.equal(equalConstantTime("é", "é"), false);
  assert.equal(equalConstantTime("ü", "ü"), true);
  assert.equal(equalConstantTime(null, "x"), false);
  assert.equal(equalConstantTime("x", undefined), false);
});

test("equalConstantTime has no early return on a length mismatch", () => {
  const source = equalConstantTime.toString();
  assert.ok(!/length\s*!==\s*b\.length\)\s*return false/.test(source), source);
});

test("equalConstantTime uses crypto.subtle.timingSafeEqual on equal-length buffers when the platform has it", () => {
  const subtle = globalThis.crypto.subtle;
  const original = subtle.timingSafeEqual;
  const calls = [];
  subtle.timingSafeEqual = (x, y) => {
    calls.push([x.byteLength, y.byteLength]);
    const a = new Uint8Array(x.buffer ?? x, x.byteOffset ?? 0, x.byteLength);
    const b = new Uint8Array(y.buffer ?? y, y.byteOffset ?? 0, y.byteLength);
    return a.every((value, index) => value === b[index]);
  };
  try {
    assert.equal(equalConstantTime("short", "much longer value"), false);
    assert.equal(equalConstantTime("same", "same"), true);
  } finally {
    if (original === undefined) delete subtle.timingSafeEqual;
    else subtle.timingSafeEqual = original;
  }
  assert.equal(calls.length, 2);
  for (const [x, y] of calls) assert.equal(x, y);
});

// ---- 3. Sec-Fetch-Site ------------------------------------------------------

test("a cross-site write is refused 403 even with a valid origin and CSRF token", async () => {
  const response = await call(env, "/api/auth/logout", { method: "POST", session: freshSession(), headers: { "Sec-Fetch-Site": "cross-site" } });
  assert.equal(response.status, 403);
});

test("a same-site (sibling subdomain) write is refused: the origin policy is exact-origin", async () => {
  const response = await call(env, "/api/auth/logout", { method: "POST", session: freshSession(), headers: { "Sec-Fetch-Site": "same-site" } });
  assert.equal(response.status, 403);
});

test("same-origin, none and an absent Sec-Fetch-Site still pass on to the Origin/CSRF checks", async () => {
  for (const value of ["same-origin", "none", null]) {
    const headers = value === null ? {} : { "Sec-Fetch-Site": value };
    const response = await call(env, "/api/auth/logout", { method: "POST", session: freshSession(), headers });
    assert.equal(response.status, 200, String(value));
  }
});

test("Sec-Fetch-Site none does not bypass the Origin check", async () => {
  const response = await call(env, "/api/auth/logout", {
    method: "POST",
    session: freshSession(),
    headers: { "Sec-Fetch-Site": "none", Origin: "https://evil.example" },
  });
  assert.equal(response.status, 403);
});

test("the session-less appeal route refuses a cross-site POST", async () => {
  const response = await call(env, "/api/appeals", {
    method: "POST",
    body: { username: "Hardy", password: "x", message: "please" },
    headers: { Origin: ORIGIN, "Sec-Fetch-Site": "cross-site" },
  });
  assert.equal(response.status, 403);
});

test("the Accounts relay (token route) is unaffected by Sec-Fetch-Site", async () => {
  const response = await call(env, "/api/relay/password-verify", {
    method: "POST",
    body: { username: "Hardy", password: "correct horse battery" },
    headers: { "X-Relay-Token": TEST_RELAY_TOKEN, "Sec-Fetch-Site": "cross-site" },
  });
  assert.equal(response.status, 200, await response.clone().text());
});

test("MCP (bearer/anonymous JSON-RPC) is unaffected by Sec-Fetch-Site", async () => {
  const response = await call(env, "/mcp", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }),
    headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
  });
  assert.equal(response.status, 200);
  assert.ok(Array.isArray((await response.json()).result.tools));
});

// ---- 4. internal-path redirects -------------------------------------------

test("safeInternalPath accepts single-slash internal paths", () => {
  for (const path of ["/", "/posts/12", "/c/general?sort=new#top", "/u/Hardy"]) {
    assert.equal(safeInternalPath(path), path);
  }
});

test("safeInternalPath refuses off-site and scheme targets", () => {
  for (const bad of [
    "//evil.com", "/\\evil.com", "\\\\evil.com", "javascript:alert(1)", "https://evil.com",
    "evil.com", "posts/1", "", " /posts", "/posts\n/x", "/\tevil", "/\u0000x", "/\u007fx", null, undefined, 42,
    "JAVASCRIPT:alert(1)", "///evil.com", "/ x",
  ]) {
    assert.equal(safeInternalPath(bad), null, JSON.stringify(bad));
  }
});

test("the WebMCP navigator routes every target through safeInternalPath", () => {
  const source = readFileSync(new URL("../public/js/webmcp.js", import.meta.url), "utf8");
  assert.match(source, /import \{[^}]*safeInternalPath[^}]*\} from "\.\/safe-path\.js"/);
  assert.match(source, /safeInternalPath\(path\)/);
});

// ---- 5. Content-Type --------------------------------------------------------

test("parseContentType reads type and charset case-insensitively", () => {
  assert.deepEqual(parseContentType('Application/JSON; Charset="UTF-8"'), { type: "application/json", charset: "utf-8" });
  assert.deepEqual(parseContentType("multipart/form-data; boundary=abc"), { type: "multipart/form-data", charset: "" });
  assert.equal(parseContentType(""), null);
  assert.equal(parseContentType(null), null);
  assert.equal(parseContentType("not a type"), null);
});

test("JSON routes answer 415 for look-alike or wrong-charset content types", async () => {
  for (const type of ["application/jsonp", "application/json-seq", "text/plain", "application/json; charset=latin1", "application/x-json"]) {
    const response = await rawPost("/api/chat", '{"body":"typed"}', { "Content-Type": type }, freshSession());
    assert.equal(response.status, 415, type);
  }
});

test("JSON routes accept application/json with any case and a utf-8 charset", async () => {
  for (const type of ["application/json", "Application/JSON", "application/json; charset=UTF-8", "application/json;charset=utf-8"]) {
    const response = await rawPost("/api/chat", '{"body":"typed ok"}', { "Content-Type": type }, freshSession());
    assert.equal(response.status, 201, type + " " + (await response.clone().text()));
  }
});

// ---- 6. BOM / CRLF normalisation ------------------------------------------

test("normalizeBodyText strips one leading BOM and folds CRLF/CR to LF", () => {
  assert.equal(normalizeBodyText("﻿a\r\nb\rc\nd"), "a\nb\nc\nd");
  assert.equal(normalizeBodyText("a﻿b"), "a﻿b");
  assert.equal(normalizeBodyText(5), 5);
  assert.equal(normalizeBodyText(undefined), undefined);
});

test("a CRLF post body is stored as LF and counted after normalisation", async () => {
  const lines = Math.floor(MAX_COMPOSER_BODY_CHARS / 2);
  const crlf = "﻿" + "x\r\n".repeat(lines - 1) + "x";
  assert.ok(crlf.length > MAX_COMPOSER_BODY_CHARS);
  const response = await call(env, "/api/posts", { method: "POST", session: freshSession(), body: { body: crlf, board: "general" } });
  assert.equal(response.status, 201, await response.clone().text());
  const { post } = await response.json();
  const stored = env.__sqlite.prepare("SELECT body FROM posts WHERE id = ?").get(post.id).body;
  assert.ok(!stored.includes("\r") && !stored.startsWith("﻿"));
  assert.ok(stored.length <= MAX_COMPOSER_BODY_CHARS);
});

test("the cap still applies after normalisation", async () => {
  const tooLong = "y".repeat(MAX_COMPOSER_BODY_CHARS) + "\r\n" + "y";
  const response = await call(env, "/api/posts", { method: "POST", session: freshSession(), body: { body: tooLong, board: "general" } });
  assert.equal(response.status, 400);
});

test("chat and bio bodies are normalised before storage", async () => {
  const chat = await call(env, "/api/chat", { method: "POST", session: freshSession(), body: { body: "﻿one\r\ntwo" } });
  assert.equal(chat.status, 201);
  const row = env.__sqlite.prepare("SELECT body FROM chat_messages ORDER BY id DESC LIMIT 1").get();
  assert.equal(row.body, "one\ntwo");
  const bio = await call(env, "/api/me", { method: "PATCH", session: freshSession(), body: { bio: "﻿hi\r\nthere" } });
  assert.equal(bio.status, 200, await bio.clone().text());
  assert.equal(env.__sqlite.prepare("SELECT bio FROM users WHERE id = ?").get(userId).bio, "hi\nthere");
});

// ---- 7. first-visit locale ------------------------------------------------

test("first visit picks the best supported locale from the browser's ordered language list", () => {
  assert.equal(detectLocale(null, ["pt-BR", "en"]), "pt");
  assert.equal(detectLocale(null, ["xx-YY", "pt-BR"]), "pt");
  assert.equal(detectLocale(null, ["zh-TW"]), "zh-Hant");
  assert.equal(detectLocale(null, ["iw-IL"]), "he");
  assert.equal(detectLocale("de", ["pt-BR"]), "de", "an explicit choice wins");
  assert.equal(detectLocale(null, []), "en");
});
