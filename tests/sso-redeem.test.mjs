// Wempo Accounts SSO redeem (the alternate front door): behavior pins. The
// route must ride the exact service-binding lane (sso.internal + token
// header), validate the code shape with an anchored regex, answer EVERY
// relay refusal — expired, refused, degraded binding, unknown member — with
// the one shared 401 copy, and mint the forum's OWN session through the same
// createSession call a normal login makes (same cookie shape, same ban gate).
import test from "node:test";
import assert from "node:assert/strict";
import { handleAccountsRoutes } from "../api/accounts.mjs";
import { createSession } from "../api/core/auth.mjs";
import { HttpError } from "../api/core/http.mjs";

const TOKEN = "t".repeat(64);
const CODE = "9f".repeat(32);
const REFUSAL = "That sign-in link has expired. Sign in again.";
const BANNED = "This account is currently banned.";
const COOKIE_TOKEN = "g".repeat(44);
const USER = { id: 9, username: "tester", username_key: "tester", role: "member", bio: "" };

function fakeDb({ sqlAnswers = {}, runChanges = {}, batchInsertChanges = 1 } = {}) {
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
    // The bound statement carries its SQL so `batch` can tell the guarded
    // session INSERT apart from the DELETE riding beside it.
    return {
      sql,
      first: async () => answer(sql),
      run: async () => ({ meta: { changes: changes(sql), last_row_id: statements.length } }),
    };
  };
  return {
    statements,
    prepare: (sql) => ({
      first: async () => answer(sql),
      bind: (...params) => mk(sql, params),
    }),
    batch: async (batch) => batch.map((statement) => ({
      meta: { changes: statement.sql.includes("INSERT INTO sessions") ? batchInsertChanges : 1 },
    })),
  };
}

// The ACCOUNTS_WORKER service-binding mock: records every call (URL, method,
// headers, body) so the lane contract is pinned, and replies with a canned
// payload/status.
function mockAccountsBinding({ status = 200, body = { userId: 9, username: "tester", role: "member" } } = {}) {
  const calls = [];
  return {
    calls,
    async fetch(request) {
      const headers = {};
      for (const [name, value] of request.headers.entries()) headers[name] = value;
      calls.push({ url: request.url, method: request.method, headers, body: await request.text() });
      return new Response(JSON.stringify(body), { status });
    },
  };
}

function ssoEnv(db, accounts) {
  return {
    FORUM_DB: db,
    // Only set when the mock is passed — its absence pins the degraded leg.
    ...(accounts ? { ACCOUNTS_WORKER: accounts } : {}),
    RELAY_TOKEN: TOKEN,
    LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
}

function ssoRequest(env, wt) {
  return new Request("https://forum.test/api/auth/sso/redeem", {
    method: "POST",
    body: JSON.stringify({ wt }),
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://forum.test",
      "Cookie": "wempo_session=" + COOKIE_TOKEN,
      "X-CSRF-Token": "csrf-guest",
      "CF-Connecting-IP": "203.0.113.9",
    },
  });
}

// Route handlers throw HttpError; production converts it to a Response before
// this layer. The test harness mirrors that edge:
async function call(request, env, path = "/api/auth/sso/redeem") {
  try {
    return await handleAccountsRoutes(request, env, new URL(request.url), path, "POST");
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
}

const GUEST_SESSION = {
  token_hash: "hash-guest",
  user_id: null,
  csrf_token: "csrf-guest",
  expires_at: 9_999_999_999,
  username: null,
  role: null,
  bio: null,
  avatar_status: null,
  avatar_mime: null,
  avatar_updated_at: null,
  avatar_version: null,
  totp_enabled: 0,
};

function happyDb(extra = {}) {
  return fakeDb({
    sqlAnswers: {
      // assertNetworkNotBanned: no banned network.
      "FROM banned_ips bi JOIN bans b ON b.id = bi.ban_id": null,
      // readSession: the guest session the client already holds.
      "FROM sessions s LEFT JOIN users u ON u.id = s.user_id": GUEST_SESSION,
      // userById: the SHARED users row accounts signed into.
      "FROM users WHERE id = ? LIMIT 1": USER,
      // The ban gate: no active ban.
      "SELECT reason, expires_at FROM bans WHERE user_id": null,
    },
    ...extra,
  });
}

function assertRefused(response) {
  assert.equal(response.status, 401);
  assert.equal(response.message, REFUSAL);
}

test("the lane is pinned: binding fetch to sso.internal/api/sso/redeem with the token header", async () => {
  const accounts = mockAccountsBinding();
  const db = happyDb();
  const env = ssoEnv(db, accounts);

  const response = await call(ssoRequest(env, CODE), env);
  assert.equal(response.status, 200);
  assert.equal(accounts.calls.length, 1);
  const relayed = accounts.calls[0];
  assert.equal(relayed.url, "https://sso.internal/api/sso/redeem");
  assert.equal(relayed.method, "POST");
  assert.equal(relayed.headers["x-relay-token"], TOKEN);
  assert.deepEqual(JSON.parse(relayed.body), { code: CODE });
  // The token rides the header only — it must never leak into a body or a URL.
  assert.ok(!relayed.url.includes(TOKEN));
});

test("redeemed codes never print the relay token; refusals carry only the shared copy", async () => {
  const accounts = mockAccountsBinding({ status: 410 });
  const env = ssoEnv(happyDb(), accounts);
  const response = await call(ssoRequest(env, CODE), env);
  const refusal = response instanceof HttpError ? response.message : "";
  assert.equal(refusal, REFUSAL);
  assert.ok(!refusal.includes(TOKEN));
});

test("wt shape: anything but 64 hex characters answers 400 and never reaches accounts", async () => {
  for (const wt of [CODE.slice(1), CODE + "ff", "zz".repeat(32), 12345, undefined]) {
    const accounts = mockAccountsBinding();
    const env = ssoEnv(happyDb(), accounts);
    const response = await call(ssoRequest(env, wt), env);
    assert.equal(response.status, 400, JSON.stringify(wt));
    assert.equal(response.message, "That sign-in link is incomplete. Sign in again.");
    assert.equal(accounts.calls.length, 0, "shape failures never touch the accounts worker");
  }
});

test("degraded null: an absent binding and an absent relay token both answer the shared 401", async () => {
  // No ACCOUNTS_WORKER binding:
  const noBinding = ssoEnv(happyDb(), mockAccountsBinding());
  delete noBinding.ACCOUNTS_WORKER;
  assertRefused(await call(ssoRequest(noBinding, CODE), noBinding));
  // Binding present, RELAY_TOKEN unconfigured:
  const noToken = ssoEnv(happyDb(), mockAccountsBinding());
  noToken.RELAY_TOKEN = "";
  assertRefused(await call(ssoRequest(noToken, CODE), noToken));
});

test("every accounts refusal — 410, 401, garbage body — answers the one shared 401", async () => {
  for (const status of [410, 401, 403, 500]) {
    const accounts = mockAccountsBinding({ status, body: { error: "details leaking upstream copy" } });
    const env = ssoEnv(happyDb(), accounts);
    assertRefused(await call(ssoRequest(env, CODE), env));
  }
  const forGarbage = mockAccountsBinding({ body: { userId: "9" } }); // status 200, malformed payload
  const garbageEnv = ssoEnv(happyDb(), forGarbage);
  assertRefused(await call(ssoRequest(garbageEnv, CODE), garbageEnv));
});

test("an accounts response whose member is unknown on the forum answers 401", async () => {
  const db = happyDb({
    sqlAnswers: {
      "FROM banned_ips bi JOIN bans b ON b.id = bi.ban_id": null,
      "FROM sessions s LEFT JOIN users u ON u.id = s.user_id": GUEST_SESSION,
      "FROM users WHERE id = ? LIMIT 1": null,
      "SELECT reason, expires_at FROM bans WHERE user_id": null,
    },
  });
  const env = ssoEnv(db, mockAccountsBinding());
  const response = await call(ssoRequest(env, CODE), env);
  assertRefused(response);
});

test("session mint parity: the redeem mints the login route's own session shape", async () => {
  const accounts = mockAccountsBinding();
  const db = happyDb();
  const env = ssoEnv(db, accounts);
  const response = await call(ssoRequest(env, CODE), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.user.id, 9);
  assert.equal(data.user.username, "tester");
  assert.equal(data.user.role, "member");
  assert.equal(typeof data.csrfToken, "string", "the member session's CSRF token ships like a login");
  assert.ok(!("password_salt" in data.user) && !("password_hash" in data.user), "no credential material rides the session payload");

  const cookie = response.headers.get("Set-Cookie");
  assert.match(cookie, /^wempo_session=[A-Za-z0-9_-]{40,50}(;|$)/);
  // Parity with a normal login: both go through createSession(request, env,
  // id, oldTokenHash, requireUnbanned) — the flag tail must match exactly.
  const direct = await createSession(
    new Request("https://forum.test/", { headers: { "CF-Connecting-IP": "203.0.113.9" } }),
    env, 9, "hash-guest", true,
  );
  const flags = (value) => value.split(";").slice(1).map((part) => part.trim()).join(";");
  assert.equal(flags(cookie), flags(direct.setCookie), "same cookie name, Path, HttpOnly, SameSite, Max-Age, Secure as a password login");

  // And the same machinery under it: the unbanned-guarded INSERT plus the
  // guest-token rotation and the known-ip tracking a login performs.
  assert.ok(db.statements.some((statement) => statement.sql.includes("INSERT INTO sessions") && statement.sql.includes("WHERE EXISTS (SELECT 1 FROM sessions WHERE token_hash = ? AND user_id IS NULL AND expires_at > ?)") && statement.sql.includes("NOT EXISTS (SELECT 1 FROM bans")),
    "session insert is conditioned on the existing guest session and an unbanned account");
  assert.ok(db.statements.some((statement) => statement.sql.includes("INSERT INTO known_ips")));
});

test("a competing auth transition cannot rotate an already-consumed guest session", async () => {
  const db = happyDb({ batchInsertChanges: 0 });
  const env = ssoEnv(db, mockAccountsBinding());
  const response = await call(ssoRequest(env, CODE), env);
  assert.equal(response.status, 409);
  assert.match(response.message, /completed in another tab/);
  assert.equal(response.headers?.get?.("Set-Cookie") ?? null, null);
});

test("the ban gate: an active ban answers the login's 403 ban screen with reason and expiry", async () => {
  const db = happyDb({
    sqlAnswers: {
      "FROM banned_ips bi JOIN bans b ON b.id = bi.ban_id": null,
      "FROM sessions s LEFT JOIN users u ON u.id = s.user_id": GUEST_SESSION,
      "FROM users WHERE id = ? LIMIT 1": USER,
      "SELECT reason, expires_at FROM bans WHERE user_id": { reason: "Spam", expires_at: 9_999_999_999 + 60 },
    },
  });
  const env = ssoEnv(db, mockAccountsBinding());
  const response = await call(ssoRequest(env, CODE), env);
  assert.equal(response.status, 403);
  assert.equal(response.message, BANNED);
  assert.equal(response.payload.banned, true);
  assert.equal(response.payload.reason, "Spam");
  assert.equal(response.payload.expiresAt, 9_999_999_999 + 60);
});

test("a ban landing at the insert still blocks: a lost unbanned INSERT 403s", async () => {
  const accounts = mockAccountsBinding();
  const db = happyDb({
    batchInsertChanges: 0,
    sqlAnswers: {
      "FROM banned_ips bi JOIN bans b ON b.id = bi.ban_id": null,
      "FROM sessions s LEFT JOIN users u ON u.id = s.user_id": GUEST_SESSION,
      "FROM users WHERE id = ? LIMIT 1": USER,
      "SELECT reason, expires_at FROM bans WHERE user_id": null,
      "SELECT 1 FROM sessions WHERE token_hash = ? AND user_id IS NULL": GUEST_SESSION,
    },
  });
  const env = ssoEnv(db, accounts);
  const response = await call(ssoRequest(env, CODE), env);
  assert.equal(response.status, 403);
  assert.equal(response.message, BANNED);
});
