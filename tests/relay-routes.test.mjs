// Credential relay (login-parity rescue): behavior pins for the
// worker-to-worker endpoints. The token gate is the whole auth — these tests
// hold the line on what a token-less caller sees (uniform 403/503, no
// oracle) and what a token holder gets (real verify against the users row,
// dummy-salt burn for unknown usernames, set-password writes under the FORUM
// pepper with username_key binding).
import test from "node:test";
import assert from "node:assert/strict";
import { handleRelayRoutes } from "../api/relay.mjs";
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
  const data = await ok(await call(handleRelayRoutes,
    relayRequest("/api/relay/network-ban-check", { ip }, TOKEN),
    relayEnv(db), new URL("https://forum.test/api/relay/network-ban-check"),
    "/api/relay/network-ban-check", "POST",
  ));
  assert.deepEqual(data, { banned: true });
  const lookup = db.statements.find((statement) => statement.sql.includes("FROM banned_ips bi JOIN bans b"));
  assert.ok(lookup, "active network-ban lookup ran");
  const expected = await requestIpHash(
    new Request("https://forum.test/", { headers: { "CF-Connecting-IP": ip } }),
    relayEnv(db),
  );
  assert.equal(lookup.params[0], expected, "the lookup uses the Forum-keyed IP hash");
});

test("relay network-ban check reports an unbanned address as false", async () => {
  const db = fakeDb();
  const data = await ok(await call(handleRelayRoutes,
    relayRequest("/api/relay/network-ban-check", { ip: "2001:db8::7" }, TOKEN),
    relayEnv(db), new URL("https://forum.test/api/relay/network-ban-check"),
    "/api/relay/network-ban-check", "POST",
  ));
  assert.deepEqual(data, { banned: false });
});

test("network-ban check: returns Forum-keyed active-ban status without exposing the IP hash", async () => {
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
  assert.deepEqual(await ok(response), { banned: true });
  const lookup = db.statements.find((statement) => statement.sql.includes("FROM banned_ips"));
  assert.ok(lookup);
  assert.equal(lookup.params[0], expectedHash, "lookup uses Forum-keyed IP hash");
  assert.equal(JSON.stringify(await response.clone().json()).includes("198.51.100.7"), false);
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
