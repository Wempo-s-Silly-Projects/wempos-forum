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

// Wave 5.22 fuzz lane: fast-check (fixed seed, bounded runs) throws junk
// bodies and query strings at the JSON body reader and at real handlers
// through the test harness. Properties: never an unhandled throw, never a
// 500, and bad input answers its documented 4xx.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fc from "fast-check";
import { HttpError, MAX_JSON_BYTES, readJson } from "../api/core/http.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedPost, seedUser, sha256 } from "./helpers/seed.mjs";

const FUZZ = Object.freeze({ seed: 522, numRuns: 120 });
const DAY = 86400;

// A signed-out visitor's session (user_id NULL): what the boot GET mints, and
// what login/register's requireCsrf demands.
function forgeGuestSession(sqlite) {
  const token = randomBytes(33).toString("base64url");
  const csrf = randomBytes(24).toString("base64url");
  sqlite.prepare("INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, NULL, ?, ?, ?)")
    .run(sha256(token), csrf, now(), now() + DAY);
  return { cookie: "__Host-wempo_session=" + token, csrf };
}

// Any JSON value, plus near-miss shapes the handlers read field by field.
const jsonish = fc.oneof(
  fc.jsonValue(),
  fc.dictionary(fc.constantFrom("username", "password", "body", "board", "title", "__proto__", "constructor"),
    fc.oneof(fc.jsonValue(), fc.string(), fc.constant(null))),
);

// Raw wire bodies: invalid UTF-8, truncated JSON, non-objects, oversize.
const rawBody = fc.oneof(
  jsonish.map((value) => JSON.stringify(value) ?? ""),
  fc.string(),
  fc.uint8Array({ maxLength: 256 }).map((bytes) => Buffer.from(bytes).toString("latin1")),
  fc.constantFrom("", "{", "[]", "null", "1", "\"x\"", "{\"a\":", "﻿{}", "{}garbage",
    "{\"username\":\"\uD800\"}", "x".repeat(MAX_JSON_BYTES + 1)),
);

// Weighted toward JSON so most runs reach the handler past the 415 gate.
const contentTypeish = fc.oneof(
  { arbitrary: fc.constant("application/json"), weight: 4 },
  fc.constantFrom("application/json", "APPLICATION/JSON; charset=utf-8", "text/plain", "",
    "application/jsonx", "multipart/form-data", "application/x-www-form-urlencoded"),
  fc.string({ maxLength: 40 }),
);

function bodyRequest(bytes, contentType, declaredLength) {
  const headers = new Headers();
  if (contentType) headers.set("Content-Type", contentType);
  if (declaredLength !== undefined) headers.set("Content-Length", String(declaredLength));
  return new Request("https://wempos-forum.com/api/x", { method: "POST", headers, body: bytes });
}

async function assertNo500(response, allowed, label) {
  const text = await response.text();
  assert.notEqual(response.status, 500, label + " → 500: " + text);
  assert.ok(allowed.includes(response.status), label + " → unexpected " + response.status + ": " + text);
  if (response.status >= 400) assert.equal(typeof JSON.parse(text).error, "string");
}

test("fuzz readJson: a plain object, or HttpError 400/413/415 — nothing else", async () => {
  await fc.assert(fc.asyncProperty(
    fc.oneof(
      rawBody.map((text) => new TextEncoder().encode(text)),
      fc.uint8Array({ maxLength: 512 }),
      fc.constant(new Uint8Array(MAX_JSON_BYTES + 10).fill(0x20)),
    ),
    contentTypeish,
    fc.option(fc.oneof(fc.nat(), fc.constant(MAX_JSON_BYTES + 1)), { nil: undefined }),
    async (bytes, contentType, declared) => {
      try {
        const value = await readJson(bodyRequest(bytes, contentType, declared));
        assert.ok(value && typeof value === "object" && !Array.isArray(value));
      } catch (error) {
        assert.ok(error instanceof HttpError, "unhandled " + error);
        assert.ok([400, 413, 415].includes(error.status), String(error.status));
        if (!String(contentType).toLowerCase().startsWith("application/json")) assert.equal(error.status, 415);
      }
    },
  ), { ...FUZZ, numRuns: 300 });
});

test("fuzz POST /api/auth/login: junk bodies answer 400/401/413/415, never 500", async () => {
  const env = makeEnv();
  await seedUser(env.__sqlite, { username: "alice" });
  const guest = forgeGuestSession(env.__sqlite);
  await fc.assert(fc.asyncProperty(
    fc.oneof(
      rawBody,
      // Mostly-invalid credential shapes keep the PBKDF2 path rare (cheap).
      fc.record({
        username: fc.oneof(fc.anything(), fc.string({ maxLength: 30 }), fc.constantFrom("alice", " alice ", "ALICE")),
        password: fc.oneof(fc.anything(), fc.constantFrom("", "x".repeat(129), "wrong-password")),
      }).map((value) => JSON.stringify(value) ?? ""),
    ),
    contentTypeish,
    async (body, contentType) => {
      const response = await call(env, "/api/auth/login", {
        method: "POST", body, session: guest, headers: { "Content-Type": contentType },
      });
      await assertNo500(response, [400, 401, 413, 415], "login");
    },
  ), { ...FUZZ, numRuns: 80 });
});

test("fuzz POST /api/auth/register: invalid credentials always answer 400 (or 413/415)", async () => {
  const env = makeEnv();
  const guest = forgeGuestSession(env.__sqlite);
  await fc.assert(fc.asyncProperty(
    fc.oneof(fc.anything(), fc.string({ maxLength: 30 }), fc.stringMatching(/^[A-Za-z0-9_]{0,26}$/)),
    // Never a valid 12–128 char password, so no account is ever created.
    fc.oneof(fc.anything(), fc.string({ maxLength: 11 }), fc.constant("p".repeat(129))),
    async (username, password) => {
      const response = await call(env, "/api/auth/register", {
        method: "POST", body: JSON.stringify({ username, password }) ?? "", session: guest,
        headers: { "Content-Type": "application/json" },
      });
      await assertNo500(response, [400], "register");
    },
  ), FUZZ);
});

test("fuzz GET /api/search: any q/by/in answers 200 or the documented 400, never 500", async () => {
  const env = makeEnv();
  const alice = await seedUser(env.__sqlite, { username: "alice" });
  seedPost(env.__sqlite, { authorId: alice, body: "hello %_ world ||secret||" });
  const member = forgeSession(env.__sqlite, alice);
  const paramish = fc.oneof(
    fc.string({ maxLength: 120 }),
    fc.string({ unit: fc.constantFrom("%", "_", "\\", "'", "\"", "*", "a", " ", "\u0000", "\uD800"), maxLength: 110 }),
    fc.constantFrom("alice", "replies", "REPLIES", " replies ", "x".repeat(101)),
  );
  await fc.assert(fc.asyncProperty(
    fc.option(paramish, { nil: undefined }),
    fc.option(paramish, { nil: undefined }),
    fc.option(paramish, { nil: undefined }),
    fc.boolean(),
    async (q, by, inParam, signedIn) => {
      const params = new URLSearchParams();
      if (q !== undefined) params.set("q", q);
      if (by !== undefined) params.set("by", by);
      if (inParam !== undefined) params.set("in", inParam);
      const response = await call(env, "/api/search?" + params, signedIn ? { session: member } : {});
      await assertNo500(response, [200, 400], "search");
    },
  ), FUZZ);
});

test("fuzz POST /api/posts: junk bodies answer 201 or a documented 4xx, never 500", async () => {
  const env = makeEnv();
  const alice = await seedUser(env.__sqlite, { username: "alice" });
  const member = forgeSession(env.__sqlite, alice);
  const postBody = fc.oneof(
    rawBody,
    fc.record({
      body: fc.oneof(fc.anything(), fc.string({ maxLength: 60 }), fc.constant(" "), fc.constant("b".repeat(5000))),
      board: fc.oneof(fc.anything(), fc.constantFrom("general", "updates", "polls", "suggestions", "", "constructor", "__proto__")),
    }, { requiredKeys: [] }).map((value) => JSON.stringify(value) ?? ""),
  );
  await fc.assert(fc.asyncProperty(postBody, contentTypeish, async (body, contentType) => {
    const response = await call(env, "/api/posts", {
      method: "POST", body, session: member, headers: { "Content-Type": contentType },
    });
    await assertNo500(response, [201, 400, 403, 413, 415], "create post");
  }), FUZZ);
});
