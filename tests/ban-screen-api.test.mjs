import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "../worker.mjs";
import worker from "../worker.mjs";

// Task 8: the ban-screen login payload. Verified credentials on a banned
// account surface the ban reason and expiry; wrong credentials keep the
// generic 401 with no ban information.

function envWithLimiters(db, extras = {}) {
  return {
    FORUM_DB: db,
    READ_RATE_LIMITER: { async limit() { return { success: true }; } },
    WRITE_RATE_LIMITER: { async limit() { return { success: true }; } },
    LOGIN_RATE_LIMITER: { async limit() { return { success: true }; } },
    TURNSTILE_SECRET: "turnstile-secret-fixture",
    TURNSTILE_HOSTNAMES: "forum.example",
    PASSWORD_PEPPER: "test-pepper-".repeat(4),
    ...extras,
  };
}

function sessionRow(overrides = {}) {
  return {
    token_hash: "stored-session-hash",
    user_id: 7,
    csrf_token: "expected-csrf-token",
    expires_at: Math.floor(Date.now() / 1000) + 60,
    username: null,
    role: null,
    bio: "",
    avatar_status: null,
    avatar_mime: null,
    avatar_updated_at: null,
    avatar_version: null,
    ...overrides,
  };
}

// D1 mock: routes are matched against the SQL text; the last route is the fallback.
function mockDb(routes) {
  const calls = [];
  const db = {
    prepare(sql) {
      const route = routes.find((candidate) => candidate.sql.test(sql)) ||
        routes[routes.length - 1];
      if (!route) throw new Error("Unexpected SQL: " + sql);
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            async first() {
              return route.result === undefined ? null : route.result;
            },
            async all() {
              return { results: route.rows === undefined ? [] : route.rows };
            },
            async run() {
              return { meta: { changes: route.changes === undefined ? 0 : route.changes } };
            },
          };
        },
      };
    },
    async batch() {
      return [{ meta: { changes: 1 } }];
    },
  };
  return { db, calls };
}

function withMockedSiteverify(payload) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function login(routes, password, username = "banned_user") {
  const restoreFetch = withMockedSiteverify({
    success: true,
    action: "login",
    hostname: "forum.example",
  });
  try {
    const request = new Request("https://forum.example/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://forum.example",
        "X-CSRF-Token": "expected-csrf-token",
        Cookie: "wempo_session=" + "s".repeat(43),
        "CF-Connecting-IP": "192.0.2.8",
      },
      body: JSON.stringify({
        username,
        password,
        "cf-turnstile-response": "turnstile-token-fixture",
      }),
    });
    const response = await worker.fetch(request, envWithLimiters(routes.db));
    return { response, calls: routes.calls, body: await response.json() };
  } finally {
    restoreFetch();
  }
}

// A real peppered PBKDF2 hash so password verification exercises the live path.
const credentials = await hashPassword("correct-horse-battery", "test-pepper-".repeat(4));

function userRow(overrides = {}) {
  return {
    id: "7",
    username: "banned_user",
    username_key: "banned_user",
    password_salt: credentials.salt,
    password_hash: credentials.hash,
    role: "member",
    bio: "",
    avatar_status: null,
    avatar_mime: null,
    avatar_updated_at: null,
    avatar_version: null,
    social_youtube: null,
    social_x: null,
    social_reddit: null,
    social_github: null,
    social_discord: null,
    social_gitlab: null,
    social_instagram: null,
    social_tiktok: null,
    social_twitch: null,
    polytoria_username: null,
    ...overrides,
  };
}

function bannedLoginRoutes(banResult, overrides = {}) {
  return mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow() },
    { sql: /FROM users WHERE username_key = \?/, result: userRow(overrides) },
    { sql: /SELECT reason, expires_at FROM bans/, result: banResult },
    {
      sql: /INSERT INTO sessions/,
      changes: 1,
    },
    { sql: /./ },
  ]);
}

test("correct credentials on a temporary ban return the reason and epoch expiry", async () => {
  const routes = bannedLoginRoutes({ reason: "Repeated harassment", expires_at: 1700003600 });
  const { response, body, calls } = await login(routes, "correct-horse-battery");

  assert.equal(response.status, 403);
  assert.deepEqual(body, {
    error: "This account is currently banned.",
    banned: true,
    reason: "Repeated harassment",
    expiresAt: 1700003600,
  });
  // The ban row is read strictly after the password check, so a wrong
  // password can never trigger the ban lookup.
  const banReadIndex = calls.findIndex(({ sql }) => /SELECT reason, expires_at FROM bans/.test(sql));
  const userReadIndex = calls.findIndex(({ sql }) => /FROM users WHERE username_key = \?/.test(sql));
  assert.ok(banReadIndex > userReadIndex, "ban read must follow the credential lookup");
  // The ban payload is read from a dedicated reason/expiry projection, not
  // just an existence probe.
  assert.match(calls[banReadIndex].sql, /AND \(expires_at IS NULL OR expires_at > \?\) LIMIT 1/);
});

test("correct credentials on a permanent ban report expiresAt null", async () => {
  const routes = bannedLoginRoutes({ reason: "Permanent spam", expires_at: null });
  const { response, body } = await login(routes, "correct-horse-battery");

  assert.equal(response.status, 403);
  assert.equal(body.error, "This account is currently banned.");
  assert.equal(body.banned, true);
  assert.equal(body.reason, "Permanent spam");
  assert.equal(body.expiresAt, null);
});

test("wrong credentials on a banned account keep the generic 401 with no ban payload", async () => {
  const routes = bannedLoginRoutes({ reason: "Repeated harassment", expires_at: 1700003600 });
  const { response, body, calls } = await login(routes, "not-the-password");

  assert.equal(response.status, 401);
  assert.deepEqual(body, { error: "The username or password is incorrect." });
  assert.equal("banned" in body, false, "ban details must not leak without the password");
  assert.equal("reason" in body, false);
  assert.equal("expiresAt" in body, false);
  assert.equal(
    calls.some(({ sql }) => /FROM bans/.test(sql)),
    false,
    "no ban row may be read for invalid credentials",
  );
});

test("the ban payload carries integer expiries even when D1 returns them as strings", async () => {
  const routes = bannedLoginRoutes({ reason: "Cooling off", expires_at: "1700003600" });
  const { response, body } = await login(routes, "correct-horse-battery");

  assert.equal(response.status, 403);
  assert.equal(body.expiresAt, 1700003600);
  assert.ok(Number.isInteger(body.expiresAt));
});

test("an unbanned account still signs in and its public user gains socials fields", async () => {
  const routes = bannedLoginRoutes(null, {
    username: "signed_in",
    social_youtube: "myhandle",
    polytoria_username: "PolyUser",
  });
  const { response, body } = await login(
    routes,
    "correct-horse-battery",
    "signed_in",
  );

  assert.equal(response.status, 200);
  assert.equal(body.user.username, "signed_in");
  assert.deepEqual(body.user.socials, { youtube: "myhandle", polytoria: "PolyUser" });
  assert.equal(body.user.polytoriaUsername, "PolyUser");
  assert.ok(body.csrfToken);
});