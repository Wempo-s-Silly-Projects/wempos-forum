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

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, TEST_RELAY_TOKEN } from "./helpers/d1.mjs";
import { call, forgeSession, seedUser } from "./helpers/seed.mjs";

const PASSWORD = "correct horse battery";
const ROUTES = ["/api/relay/password-verify", "/api/relay/password-set", "/api/relay/session-revoke-all"];
let env;
let aliceId;
let bobId;

before(async () => {
  env = makeEnv();
  aliceId = await seedUser(env.__sqlite, { username: "Alice", password: PASSWORD });
  bobId = await seedUser(env.__sqlite, { username: "Bob", password: "another long password" });
});

const relay = (path, body, token = TEST_RELAY_TOKEN, targetEnv = env) =>
  call(targetEnv, path, { method: "POST", body, headers: token === null ? {} : { "X-Relay-Token": token } });

for (const path of ROUTES) {
  test(path + ": missing token answers 403 Relay refused.", async () => {
    const response = await relay(path, { username: "Alice", password: PASSWORD, userId: 1 }, null);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Relay refused." });
  });

  test(path + ": wrong token answers the same 403", async () => {
    const response = await relay(path, { username: "Alice", password: PASSWORD, userId: 1 }, TEST_RELAY_TOKEN + "x");
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Relay refused." });
  });

  test(path + ": RELAY_TOKEN unset answers 503", async () => {
    const unset = { ...env, RELAY_TOKEN: undefined };
    const response = await relay(path, { username: "Alice", password: PASSWORD, userId: 1 }, TEST_RELAY_TOKEN, unset);
    assert.equal(response.status, 503);
  });
}

test("password-verify: correct credentials answer valid=true with a public user and no hash material", async () => {
  const response = await relay(ROUTES[0], { username: "alice", password: PASSWORD });
  assert.equal(response.status, 200);
  const text = await response.text();
  const body = JSON.parse(text);
  assert.equal(body.valid, true);
  assert.equal(body.user.username, "Alice");
  assert.equal(Number(body.user.id), aliceId);
  const row = env.__sqlite.prepare("SELECT password_salt, password_hash FROM users WHERE id = ?").get(aliceId);
  assert.ok(!text.includes(row.password_salt), "salt leaked");
  assert.ok(!text.includes(row.password_hash), "hash leaked");
  assert.ok(!/salt|hash/i.test(text), "salt/hash key leaked");
});

test("password-verify: wrong password and unknown user both answer exactly { valid: false }", async () => {
  for (const body of [{ username: "Alice", password: "wrong password here" }, { username: "Nobody", password: PASSWORD }]) {
    const response = await relay(ROUTES[0], body);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { valid: false });
  }
});

test("password-set: stores a new hash that password-verify then accepts", async () => {
  const response = await relay(ROUTES[1], { username: "Bob", password: "a brand new password" });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(JSON.parse(text).changed, true);
  assert.ok(!/salt|hash/i.test(text));
  const verify = await (await relay(ROUTES[0], { username: "Bob", password: "a brand new password" })).json();
  assert.equal(verify.valid, true);
});

test("session-revoke-all: deletes only that user's sessions", async () => {
  forgeSession(env.__sqlite, aliceId);
  forgeSession(env.__sqlite, aliceId);
  forgeSession(env.__sqlite, bobId);
  env.__sqlite.prepare("INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES ('guest', NULL, 'c', 1, 9999999999)").run();
  const response = await relay(ROUTES[2], { userId: aliceId });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revoked: 2 });
  const count = (sql, ...args) => env.__sqlite.prepare(sql).get(...args).n;
  assert.equal(count("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", aliceId), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", bobId), 1);
  assert.equal(count("SELECT COUNT(*) AS n FROM sessions WHERE user_id IS NULL"), 1);
});

test("session-revoke-all: a string userId is rejected with 400 and deletes nothing", async () => {
  forgeSession(env.__sqlite, bobId);
  const before = env.__sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get().n;
  for (const userId of [String(bobId), 0, 1.5, null]) {
    const response = await relay(ROUTES[2], { userId });
    assert.equal(response.status, 400, "userId=" + JSON.stringify(userId));
  }
  assert.equal(env.__sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, before);
});
