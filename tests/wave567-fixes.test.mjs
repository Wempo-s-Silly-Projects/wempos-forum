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

// v5.67.0: two v5.66 LOW findings. (#2) PATCH /api/me had no rateLimit;
// (#4) the register return projection hand-listed 10 of the 27 social columns.

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { SOCIAL_PLATFORMS } from "../api/core/shapers.mjs";
import { makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedUser, sha256 } from "./helpers/seed.mjs";

const DAY = 86400;

function bioOf(env, id) {
  return env.__sqlite.prepare("SELECT bio FROM users WHERE id = ?").get(id).bio;
}

async function member(env) {
  const id = await seedUser(env.__sqlite, { username: "alice" });
  return { id, session: forgeSession(env.__sqlite, id) };
}

function tableExists(env, name) {
  return Boolean(env.__sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

test("PATCH /api/me answers 429 and writes nothing once the write bucket is exhausted", async () => {
  const env = makeEnv(makeLimiters(false).bindings);
  const alice = await member(env);
  const before = bioOf(env, alice.id);
  const response = await call(env, "/api/me", { method: "PATCH", body: { bio: "spam" }, session: alice.session });
  assert.equal(response.status, 429);
  assert.equal(bioOf(env, alice.id), before);
  if (tableExists(env, "automod_profile_edits")) {
    assert.equal(env.__sqlite.prepare("SELECT COUNT(*) AS n FROM automod_profile_edits").get().n, 0);
  }
});

test("PATCH /api/me consults WRITE_RATE_LIMITER keyed by the member id, and still succeeds under it", async () => {
  const writeCalls = [];
  const writeLimiter = { limit: async ({ key }) => { writeCalls.push(key); return { success: true }; } };
  const env = makeEnv({ WRITE_RATE_LIMITER: writeLimiter });
  const alice = await member(env);
  const response = await call(env, "/api/me", { method: "PATCH", body: { bio: "hello" }, session: alice.session });
  assert.equal(response.status, 200);
  assert.equal(bioOf(env, alice.id), "hello");
  assert.ok(writeCalls.includes(sha256("write:" + alice.id)), "write bucket keyed by member id");
});

test("PATCH /api/me source: rateLimit(\"write\") runs after the ban gate and before the body is read", () => {
  const source = readFileSync(new URL("../api/profiles.mjs", import.meta.url), "utf8");
  const start = source.indexOf('if (path === "/api/me" && method === "PATCH")');
  assert.ok(start > 0);
  const block = source.slice(start, source.indexOf("readJson(request", start));
  assert.match(
    block,
    /await assertNotBanned\(env, session\.user\.id\);\s*await rateLimit\(request, env, "write", String\(session\.user\.id\)\);/,
  );
});

function forgeGuestSession(sqlite) {
  const token = randomBytes(33).toString("base64url");
  const csrf = randomBytes(24).toString("base64url");
  sqlite.prepare("INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, NULL, ?, ?, ?)")
    .run(sha256(token), csrf, now(), now() + DAY);
  return { cookie: "__Host-wempo_session=" + token, csrf };
}

// Records every SQL string the handlers prepare, without changing behaviour.
function captureSql(env) {
  const seen = [];
  const db = env.FORUM_DB;
  const proxy = new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") return (sql) => { seen.push(sql); return target.prepare(sql); };
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { seen, env: { ...env, FORUM_DB: proxy } };
}

const RETURN_PROJECTION = /^SELECT (.+) FROM users WHERE id = \? LIMIT 1$/;

async function registerAndCapture() {
  const base = makeEnv();
  const guest = forgeGuestSession(base.__sqlite);
  const { seen, env } = captureSql(base);
  const response = await call(env, "/api/auth/register", {
    method: "POST", body: { username: "newbie", password: "correct-horse-battery" }, session: guest,
  });
  assert.equal(response.status, 201, await response.clone().text());
  const insertAt = seen.findIndex((sql) => sql.startsWith("INSERT INTO users"));
  assert.ok(insertAt >= 0, "register inserted a user");
  const projection = seen.slice(insertAt + 1).find((sql) => RETURN_PROJECTION.test(sql));
  assert.ok(projection, "register re-read the new row");
  const columns = RETURN_PROJECTION.exec(projection)[1].split(",").map((column) => column.trim());
  return { response, columns };
}

const isSocialColumn = (column) => column.startsWith("social_") || column === "polytoria_username";

test("register's return projection selects every SOCIAL_PLATFORMS column (all 27, shared order)", async () => {
  const { columns } = await registerAndCapture();
  const shared = SOCIAL_PLATFORMS.map((platform) => platform.column);
  assert.equal(shared.length, 27);
  assert.deepEqual(columns.filter(isSocialColumn), shared);
});

test("register's return projection selects no social-shaped column outside SOCIAL_PLATFORMS", async () => {
  const { columns } = await registerAndCapture();
  const shared = new Set(SOCIAL_PLATFORMS.map((platform) => platform.column));
  for (const column of columns.filter(isSocialColumn)) assert.ok(shared.has(column), column);
  assert.equal(new Set(columns).size, columns.length, "no duplicate columns");
});

test("register response for a brand-new member is unchanged (empty socials, null polytoria)", async () => {
  const { response } = await registerAndCapture();
  const body = await response.json();
  assert.equal(body.user.username, "newbie");
  assert.deepEqual(body.user.socials ?? {}, {});
  assert.equal(body.user.polytoriaUsername ?? null, null);
});

test("session.mjs carries no hand-listed social column; it reuses the shared list", () => {
  const source = readFileSync(new URL("../api/session.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /"[^"\n]*\bsocial_[a-z]+/);
  assert.match(source, /SOCIAL_SELECT_COLUMNS/);
});
