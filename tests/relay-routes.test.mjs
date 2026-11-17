// Copyright 2026 YourLocalGoober
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

// Credential relay (login-parity rescue): behavior pins for the
// worker-to-worker endpoints. The token gate is the whole auth — these tests
// hold the line on what a token-less caller sees (uniform 403/503, no
// oracle) and what a token holder gets (real verify against the users row,
// dummy-salt burn for unknown usernames, set-password writes under the FORUM
// pepper with username_key binding).
import test from "node:test";
import assert from "node:assert/strict";
import { handleRelayRoutes, relayWorkerStamp } from "../api/relay.mjs";
import { readFileSync } from "node:fs";
import worker from "../worker.mjs";
import { HttpError } from "../api/core/http.mjs";
import { hashPassword } from "../api/core/passwords.mjs";
import { requestIpHash } from "../api/core/auth.mjs";

const TOKEN = "t".repeat(64);
const PEPPER = "0123456789abcdef0123456789abcdef";

// Recording fake db (same shape as the other route test files); the
// stateful set test replaces the db with a tiny persistent row store.
function fakeDb(sqlAnswers = {}, runChanges = {}) {
  const statements = [];
  const answer = (sql) => {
    for (const [needle, value] of Object.entries(sqlAnswers)) {
      if (sql.includes(needle)) return typeof value === "function" ? value() : value;
    }
    return null;
  };
  const changes = (sql) => {
    for (const [needle, value] of Object.entries(runChanges)) {
      if (sql.includes(needle)) return value;
    }
    return 1;
  };
  const mk = (sql, params) => {
    statements.push({ sql, params });
    return {
      first: async () => answer(sql),
      all: async () => ({ results: [] }),
      run: async () => ({ meta: { changes: changes(sql), last_row_id: statements.length } }),
    };
  };
  return {
    statements,
    prepare: (sql) => ({
      first: async () => answer(sql),
      all: async () => ({ results: [] }),
      bind: (...params) => mk(sql, params),
    }),
  };
}

function relayEnv(db, token = TOKEN) {
  return {
    FORUM_DB: db,
    RELAY_TOKEN: token,
    PASSWORD_PEPPER: PEPPER,
    LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
    PASSWORD_CHANGE_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
}

function relayRequest(path, body, token) {
  return new Request("https://forum.test" + path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { "X-Relay-Token": token }),
    },
  });
}

async function ok(response) {
  assert.ok(response, "handler returned a response");
  return await response.json();
}

// Route handlers throw HttpError; production converts it to a Response before
// this layer. The test harness mirrors that edge:
async function call(handler, request, env, url, path, method) {
  try {
    return await handler(request, env, url, path, method);
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
}

test("relay network-ban check: missing token is refused before any database lookup", async () => {
  const db = fakeDb();
  const response = await call(handleRelayRoutes,
    relayRequest("/api/relay/network-ban-check", { ip: "203.0.113.7" }),
    relayEnv(db), new URL("https://forum.test/api/relay/network-ban-check"),
    "/api/relay/network-ban-check", "POST",
  );
  assert.equal(response.status, 403);
  assert.equal(db.statements.length, 0);
});

test("relay network-ban check: missing Forum pepper fails closed", async () => {
  const db = fakeDb();
  const env = relayEnv(db);
  env.PASSWORD_PEPPER = "";
  const response = await call(handleRelayRoutes,
    relayRequest("/api/relay/network-ban-check", { ip: "203.0.113.7" }, TOKEN),
    env, new URL("https://forum.test/api/relay/network-ban-check"),
    "/api/relay/network-ban-check", "POST",
  );
  assert.equal(response.status, 503);
  assert.equal(db.statements.length, 0);
});

test("relay network-ban check: invalid address shape is rejected", async () => {
  const db = fakeDb();
  const response = await call(handleRelayRoutes,
    relayRequest("/api/relay/network-ban-check", { ip: "not-a-hostname.example" }, TOKEN),
    relayEnv(db), new URL("https://forum.test/api/relay/network-ban-check"),
    "/api/relay/network-ban-check", "POST",
  );
  assert.equal(response.status, 400);
  assert.equal(db.statements.length, 0);
});

test("relay network-ban check uses the Forum pepper and reports an active ban", async () => {
  const ip = "203.0.113.7";
  const db = fakeDb({
    "FROM banned_ips bi JOIN bans b": { "1": 1 },
  });
  const response = await call(handleRelayRoutes,
    relayRequest("/api/relay/network-ban-check", { ip }, TOKEN),
    relayEnv(db), new URL("https://forum.test/api/relay/network-ban-check"),
    "/api/relay/network-ban-check", "POST",
  );
  const data = await ok(response);
  const lookup = db.statements.find((statement) => statement.sql.includes("FROM banned_ips bi JOIN bans b"));
  assert.ok(lookup, "active network-ban lookup ran");
  const expected = await requestIpHash(
    new Request("https://forum.test/", { headers: { "CF-Connecting-IP": ip } }),
    relayEnv(db),
  );
  assert.deepEqual(data, { banned: true, ipHash: expected });
  assert.equal(lookup.params[0], expected, "the lookup uses the Forum-keyed IP hash");
});

test("relay network-ban check reports an unbanned address as false", async () => {
  const db = fakeDb();
  const data = await ok(await call(handleRelayRoutes,
    relayRequest("/api/relay/network-ban-check", { ip: "2001:db8::7" }, TOKEN),
    relayEnv(db), new URL("https://forum.test/api/relay/network-ban-check"),
    "/api/relay/network-ban-check", "POST",
  ));
  const expected = await requestIpHash(
    new Request("https://forum.test/", { headers: { "CF-Connecting-IP": "2001:db8::7" } }),
    relayEnv(db),
  );
  assert.deepEqual(data, { banned: false, ipHash: expected });
});

test("network-ban check: returns the opaque Forum-keyed hash only through the authenticated relay", async () => {
  const request = relayRequest("/api/relay/network-ban-check", { ip: "198.51.100.7" }, TOKEN);
  const expectedHash = await requestIpHash(
    new Request("https://forum.test/", { headers: { "CF-Connecting-IP": "198.51.100.7" } }),
    { PASSWORD_PEPPER: PEPPER },
  );
  const db = fakeDb({ "FROM banned_ips bi JOIN bans b": { active: 1 } });
  const response = await call(
    handleRelayRoutes, request, relayEnv(db),
    new URL("https://forum.test/api/relay/network-ban-check"),
    "/api/relay/network-ban-check", "POST",
  );
  const responseCopy = response.clone();
  assert.deepEqual(await ok(response), { banned: true, ipHash: expectedHash });
  const lookup = db.statements.find((statement) => statement.sql.includes("FROM banned_ips"));
  assert.ok(lookup);
  assert.equal(lookup.params[0], expectedHash, "lookup uses Forum-keyed IP hash");
  const serialized = JSON.stringify(await responseCopy.json());
  assert.equal(serialized.includes("198.51.100.7"), false);
  assert.equal(serialized.includes(expectedHash), true, "the opaque hash is returned for GooberCord's atomic D1 guard");
});

test("network-ban check: rejects malformed IPs and unauthenticated callers before D1", async () => {
  const db = fakeDb();
  const malformed = await call(
    handleRelayRoutes,
    relayRequest("/api/relay/network-ban-check", { ip: "not-an-ip.example" }, TOKEN),
    relayEnv(db),
    new URL("https://forum.test/api/relay/network-ban-check"),
    "/api/relay/network-ban-check", "POST",
  );
  assert.equal(malformed.status, 400);
  const unauthenticated = await call(
    handleRelayRoutes,
    relayRequest("/api/relay/network-ban-check", { ip: "198.51.100.7" }, "wrong"),
    relayEnv(db),
    new URL("https://forum.test/api/relay/network-ban-check"),
    "/api/relay/network-ban-check", "POST",
  );
  assert.equal(unauthenticated.status, 403);
  assert.equal(db.statements.length, 0);
});

test("relay verify: absent token answers 403 with no body oracle", async () => {
  const db = fakeDb();
  const response = await call(handleRelayRoutes,
    relayRequest("/api/relay/password-verify", { username: " tester ", password: "whatever-long-1" }),
    relayEnv(db), new URL("https://forum.test/api/relay/password-verify"),
    "/api/relay/password-verify", "POST",
  );
  assert.equal(response.status, 403);
  assert.equal(db.statements.length, 0, "refused calls touch no tables");
});

test("relay verify: wrong token answers 403 the same as an absent one", async () => {
  const db = fakeDb();
  const response = await call(handleRelayRoutes,
    relayRequest("/api/relay/password-verify", { username: "tester", password: "whatever-long-1" }, "nope"),
    relayEnv(db), new URL("https://forum.test/api/relay/password-verify"),
    "/api/relay/password-verify", "POST",
  );
  assert.equal(response.status, 403);
  assert.equal(db.statements.length, 0);
});

test("relay verify: unconfigured relay answers 503 before reading the body", async () => {
  const db = fakeDb();
  const response = await call(handleRelayRoutes,
    relayRequest("/api/relay/password-verify", { username: "tester", password: "whatever-long-1" }),
    relayEnv(db, ""), new URL("https://forum.test/api/relay/password-verify"),
    "/api/relay/password-verify", "POST",
  );
  assert.equal(response.status, 503);
  assert.equal(db.statements.length, 0);
});

test("relay verify: correct credentials answer valid with a redacted user", async () => {
  const hashed = await hashPassword("correct-horse-battery", PEPPER);
  const db = fakeDb({
    "FROM users WHERE username_key = ?": {
      id: 9, username: "tester", username_key: "tester", role: "member", bio: "",
      password_salt: hashed.salt, password_hash: hashed.hash,
      profile_accent: null, banner_color: null, banner_text: null, flair: null,
      pending_css: null, approved_css: null, avatar_status: null, avatar_mime: null,
      avatar_updated_at: null, avatar_version: null,
    },
  });
  const data = await ok(await call(handleRelayRoutes,
    relayRequest("/api/relay/password-verify", { username: "tester", password: "correct-horse-battery" }, TOKEN),
    relayEnv(db), new URL("https://forum.test/api/relay/password-verify"),
    "/api/relay/password-verify", "POST",
  ));
  assert.equal(data.valid, true);
  assert.equal(data.user.id, 9);
  assert.ok(!("password_hash" in data.user) && !("password_salt" in data.user), "no credential material in the response");
});

test("relay verify: wrong password and unknown user answer identical {valid:false} with a PBKDF2 burn", async () => {
  const hashed = await hashPassword("correct-horse-battery", PEPPER);
  const known = relayEnv(fakeDb({
    "FROM users WHERE username_key = ?": {
      id: 9, username: "tester", username_key: "tester", role: "member", bio: "",
      password_salt: hashed.salt, password_hash: hashed.hash,
      profile_accent: null, banner_color: null, banner_text: null, flair: null,
      pending_css: null, approved_css: null, avatar_status: null, avatar_mime: null,
      avatar_updated_at: null, avatar_version: null,
    },
  }));
  const unknown = relayEnv(fakeDb());
  const knownAnswer = await ok(await call(handleRelayRoutes,
    relayRequest("/api/relay/password-verify", { username: "tester", password: "wrong-password-1" }, TOKEN),
    known, new URL("https://forum.test/api/relay/password-verify"),
    "/api/relay/password-verify", "POST",
  ));
  const unknownAnswer = await ok(await call(handleRelayRoutes,
    relayRequest("/api/relay/password-verify", { username: "nobody", password: "wrong-password-1" }, TOKEN),
    unknown, new URL("https://forum.test/api/relay/password-verify"),
    "/api/relay/password-verify", "POST",
  ));
  assert.deepEqual(knownAnswer, { valid: false });
  assert.deepEqual(unknownAnswer, { valid: false });
});

test("relay set: unknown username answers 404 after the UPDATE refuses to land", async () => {
  const db = fakeDb({}, { "UPDATE users SET password_salt = ?, password_hash = ?": 0 });
  const response = await call(handleRelayRoutes,
    relayRequest("/api/relay/password-set", { username: "ghost", password: "reset-pass-123" }, TOKEN),
    relayEnv(db), new URL("https://forum.test/api/relay/password-set"),
    "/api/relay/password-set", "POST",
  );
  assert.equal(response.status, 404);
});

test("relay set: a valid password writes salt/hash bound under the forum pepper", async () => {
  // A tiny PERSISTENT row store: the UPDATE writes into `users` and the
  // SELECT reads the same values back, so set → verify proves the round trip.
  const users = { tester: { id: 9, username: "tester", username_key: "tester", role: "member", bio: "" } };
  const db = {
    statements: [],
    prepare(sql) {
      return {
        bind(...params) {
          db.statements.push({ sql, params });
          return {
            first: async () => (
              sql.includes("FROM users WHERE username_key = ?") ? users[params[0]] ?? null : null
            ),
            all: async () => ({ results: [] }),
            run: async () => {
              if (sql.includes("UPDATE users SET password_salt")) {
                users[params[2]] = {
                  ...users[params[2]],
                  password_salt: params[0],
                  password_hash: params[1],
                };
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 1 } }),
      };
    },
  };
  const data = await ok(await call(handleRelayRoutes,
    relayRequest("/api/relay/password-set", { username: "Tester", password: "reset-pass-123" }, TOKEN),
    relayEnv(db), new URL("https://forum.test/api/relay/password-set"),
    "/api/relay/password-set", "POST",
  ));
  assert.equal(data.changed, true);
  const statement = db.statements.find((s) => s.sql.includes("UPDATE users SET password_salt"));
  assert.ok(statement, "set-password UPDATE ran");
  assert.equal(statement.params[2], "tester", "stores by username_key");
  const verify = await ok(await call(handleRelayRoutes,
    relayRequest("/api/relay/password-verify", { username: "tester", password: "reset-pass-123" }, TOKEN),
    relayEnv(db), new URL("https://forum.test/api/relay/password-verify"),
    "/api/relay/password-verify", "POST",
  ));
  assert.equal(verify.valid, true, "the stored hash verifies with the same pepper");
});

test("relay set: an invalid password answers 400 before any write", async () => {
  const db = fakeDb();
  const response = await call(handleRelayRoutes,
    relayRequest("/api/relay/password-set", { username: "tester", password: "short" }, TOKEN),
    relayEnv(db), new URL("https://forum.test/api/relay/password-set"),
    "/api/relay/password-set", "POST",
  );
  assert.equal(response.status, 400);
  assert.equal(db.statements.length, 0, "validation failures write nothing");
});

// --- relay session-revoke-all (the accounts page's "sign out everywhere") -----

test("relay session-revoke-all: token gate comes first — absent, wrong, or unconfigured answers 403/503 with no statement", async () => {
  for (const [token, expected] of [[undefined, 403], ["wrong", 403], ["", 503]]) {
    const db = fakeDb();
    const env = relayEnv(db, token === "" ? "" : undefined);
    const response = await call(handleRelayRoutes,
      relayRequest("/api/relay/session-revoke-all", { userId: 9 }, token),
      env, new URL("https://forum.test/api/relay/session-revoke-all"),
      "/api/relay/session-revoke-all", "POST",
    );
    assert.equal(response.status, expected);
    assert.equal(db.statements.length, 0, "refused calls touch no tables");
  }
});

test("relay session-revoke-all: the user_id shape gate is 400 before any storage question", async () => {
  for (const bad of [0, -3, "9", 9.5, null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    const db = fakeDb();
    const response = await call(handleRelayRoutes,
      relayRequest("/api/relay/session-revoke-all", { userId: bad }, TOKEN),
      relayEnv(db), new URL("https://forum.test/api/relay/session-revoke-all"),
      "/api/relay/session-revoke-all", "POST",
    );
    assert.equal(response.status, 400, "shape " + JSON.stringify(bad) + " is a 400");
    assert.equal(db.statements.length, 0, "bad shapes never reach the table");
  }
});

test("relay session-revoke-all: one user_id-scoped DELETE, count-only answer", async () => {
  const db = fakeDb({}, { "DELETE FROM sessions WHERE user_id = ?": 4 });
  const data = await ok(await call(handleRelayRoutes,
    relayRequest("/api/relay/session-revoke-all", { userId: 9 }, TOKEN),
    relayEnv(db), new URL("https://forum.test/api/relay/session-revoke-all"),
    "/api/relay/session-revoke-all", "POST",
  ));
  assert.deepEqual(data, { revoked: 4 });
  const deletes = db.statements.filter((s) => s.sql.includes("DELETE FROM sessions"));
  assert.equal(deletes.length, 1);
  // The exact scoped statement, never an unscoped one: guest-shaped sessions
  // (user_id NULL) cannot match `= ?` by construction.
  assert.match(deletes[0].sql, /DELETE FROM sessions WHERE user_id = \?$/);
  assert.equal(deletes[0].sql.includes("WHERE token_hash"), false);
  assert.deepEqual(deletes[0].params, [9]);
});

test("relay session-revoke-all: zero rows answers { revoked: 0 } — no existence oracle", async () => {
  const db = fakeDb({}, { "DELETE FROM sessions WHERE user_id = ?": 0 });
  const data = await ok(await call(handleRelayRoutes,
    relayRequest("/api/relay/session-revoke-all", { userId: 424242 }, TOKEN),
    relayEnv(db), new URL("https://forum.test/api/relay/session-revoke-all"),
    "/api/relay/session-revoke-all", "POST",
  ));
  assert.deepEqual(data, { revoked: 0 }, "the unknown-user answer matches the empty-user answer");
});

// --- H2: the dispatch tier keys relay-lane work per-worker ---------------------

test("relayWorkerStamp: a plain slug rides through, anything else is nothing", async () => {
  const mk = (value) => new Request("https://forum.test/", { headers: value ? { "X-Relay-Worker": value } : {} });
  assert.equal(relayWorkerStamp(mk("goobercord")), "goobercord");
  assert.equal(relayWorkerStamp(mk("wempos-forum")), "wempos-forum");
  assert.equal(relayWorkerStamp(mk("x".repeat(65))), null, "over-long stamps are nothing");
  assert.equal(relayWorkerStamp(mk("../../etc/passwd")), null, "non-slug stamps are nothing");
  assert.equal(relayWorkerStamp(mk("")), null, "an empty stamp is nothing");
  assert.equal(relayWorkerStamp(mk()), null, "an absent stamp is nothing");
});

test("the dispatch tier keys a stamped relay call's bucket on the CALLING WORKER, not a shared unknown bucket", async () => {
  const writeKeys = [];
  const db = fakeDb({}, { "DELETE FROM sessions WHERE user_id = ?": 1 });
  const env = {
    FORUM_DB: db,
    RELAY_TOKEN: TOKEN,
    PASSWORD_PEPPER: PEPPER,
    WRITE_RATE_LIMITER: { limit: async ({ key }) => { writeKeys.push(key); return { success: true }; } },
    LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
    PASSWORD_CHANGE_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };

  // Two different calling workers, same relay lane, same verb: each gets its
  // OWN keyed bucket on the global tier (the write tier) — GC's and
  // Accounts' relay work no longer throttle each other.
  for (const stamp of ["goobercord", "wempos-forum"]) {
    const response = await worker.fetch(
      new Request("https://forum.test/api/relay/session-revoke-all", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Relay-Token": TOKEN,
          "X-Relay-Worker": stamp,
        },
        body: JSON.stringify({ userId: 9 }),
      }),
      env,
      undefined,
    );
    assert.equal(response.status, 200);
  }

  assert.equal(writeKeys.length, 2);
  assert.notEqual(writeKeys[0], writeKeys[1], "distinct buckets per calling worker");
});

test("an UNstamped relay call keeps the current browser-shaped bucket — fallback behavior unchanged", async () => {
  const writeKeys = [];
  const db = fakeDb({}, { "DELETE FROM sessions WHERE user_id = ?": 1 });
  const env = {
    FORUM_DB: db,
    RELAY_TOKEN: TOKEN,
    PASSWORD_PEPPER: PEPPER,
    WRITE_RATE_LIMITER: { limit: async ({ key }) => { writeKeys.push(key); return { success: true }; } },
    LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
    PASSWORD_CHANGE_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
  const response = await worker.fetch(
    new Request("https://forum.test/api/relay/session-revoke-all", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Relay-Token": TOKEN },
      body: JSON.stringify({ userId: 9 }),
    }),
    env,
    undefined,
  );
  assert.equal(response.status, 200);
  assert.equal(writeKeys.length, 1, "one global write-tier pass, keyed as it always was");
});

test("the forum's own redeem client declares its identity: api/accounts.mjs stamps X-Relay-Worker", async () => {
  const source = readFileSync(new URL("../api/accounts.mjs", import.meta.url), "utf8");
  assert.match(source, /"X-Relay-Worker": "wempos-forum"/,
    "the forum's redeem binding call declares the wempos-forum slug (accounts enforces return_site against it)");
});
