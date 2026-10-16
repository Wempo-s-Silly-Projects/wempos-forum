import test from "node:test";
import assert from "node:assert/strict";
import { PBKDF2_ITERATIONS, RATE_LIMIT_BINDINGS, REPLY_BUMP_SQL, SEARCH_USERS_SQL, SESSION_INSERT_IF_UNBANNED_SQL, THREAD_REPLY_INSERT_SQL, TURNSTILE_SITEVERIFY_URL, UNBAN_ACTIVE_UPDATE_SQL } from "../constants.mjs";
import { blobToUint8Array, canViewPost, createAvatarVersion, createSession, createUserBan, hashPassword, isValidPassword, isValidPasswordPepper, isValidSetupSecret, isValidUsername, rateLimit, requireTurnstile, sniffImageMime, verifyPassword } from "../worker.mjs";
import worker from "../worker.mjs";

test("usernames follow the documented ASCII rules", () => {
  for (const value of ["abc", "ItsWempo", "test_user", "123456789012345678901234"]) {
    assert.equal(isValidUsername(value), true, value);
  }
  for (const value of ["ab", "has space", "with-hyphen", "a".repeat(25), "", null, 123]) {
    assert.equal(isValidUsername(value), false, String(value));
  }
});

test("password length is checked without coercing non-strings", () => {
  assert.equal(isValidPassword("0123456789ab"), true);
  assert.equal(isValidPassword("x".repeat(128)), true);
  assert.equal(isValidPassword("short"), false);
  assert.equal(isValidPassword("x".repeat(129)), false);
  assert.equal(isValidPassword(null), false);
});

test("avatar sniffing accepts supported signatures, not claimed MIME labels", () => {
  assert.equal(sniffImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])), "image/jpeg");
  assert.equal(sniffImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), "image/png");
  assert.equal(sniffImageMime(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), "image/webp");
  assert.equal(sniffImageMime(Uint8Array.from([0x3c, 0x73, 0x76, 0x67, 0x3e, 0, 0, 0, 0, 0, 0, 0])), null);
  assert.equal(sniffImageMime(new Uint8Array([0xff, 0xd8])), null);
  assert.equal(sniffImageMime("not bytes"), null);
});


test("avatar versions are unique, URL-safe cache busters", () => {
  const first = createAvatarVersion();
  const second = createAvatarVersion();
  assert.match(first, /^[A-Za-z0-9_-]{16}$/);
  assert.match(second, /^[A-Za-z0-9_-]{16}$/);
  assert.notEqual(first, second);
});

test("search user rows include avatar_version for cache-busted avatar URLs", () => {
  assert.match(SEARCH_USERS_SQL, /avatar_version/);
  assert.match(SEARCH_USERS_SQL, /LIMIT 20$/);
});


const BAN_CHECK_SQL = /SELECT 1 FROM bans b WHERE b\.user_id = \?/;

function envWithParent(parent) {
  return {
    FORUM_DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              first: async () =>
                // canViewPost's active-ban check (v2.4.1) binds the author id;
                // these fixtures have no ban table, so the check reads "no
                // active ban" instead of returning the ancestor row.
                BAN_CHECK_SQL.test(sql) ? null : parent,
            };
          },
        };
      },
    },
  };
}

test("hidden root posts are visible only to their author and an administrator", async () => {
  const hiddenRoot = { id: 1, author_id: 7, parent_id: null, visibility: "hidden" };
  assert.equal(await canViewPost({ FORUM_DB: null }, hiddenRoot, null), false);
  assert.equal(await canViewPost({ FORUM_DB: null }, hiddenRoot, { id: 8, role: "member" }), false);
  const noBan = envWithParent(undefined);
  assert.equal(await canViewPost(noBan, hiddenRoot, { id: 7, role: "member" }), true);
  assert.equal(await canViewPost(noBan, hiddenRoot, { id: 8, role: "admin" }), true);
});

test("public replies cannot reveal a hidden parent to unrelated members", async () => {
  const reply = { id: 2, author_id: 8, parent_id: 1, visibility: "public" };
  const env = envWithParent({ id: 1, author_id: 7, visibility: "hidden" });
  assert.equal(await canViewPost(env, reply, null), false);
  assert.equal(await canViewPost(env, reply, { id: 8, role: "member" }), false);
  assert.equal(await canViewPost(env, reply, { id: 7, role: "member" }), true);
  assert.equal(await canViewPost(env, reply, { id: 9, role: "admin" }), true);
});

test("replies remain visible when their parent is public", async () => {
  const reply = { id: 2, author_id: 8, parent_id: 1, visibility: "public" };
  const env = envWithParent({ id: 1, author_id: 7, visibility: "public" });
  assert.equal(await canViewPost(env, reply, null), true);
  assert.equal(await canViewPost(env, reply, { id: 9, role: "member" }), true);
});

test("D1 BLOB values are converted to binary bytes before serving images", () => {
  const expected = [137, 80, 78, 71, 13, 10, 26, 10];
  assert.deepEqual(Array.from(blobToUint8Array(expected)), expected);
  assert.deepEqual(Array.from(blobToUint8Array(Uint8Array.from(expected))), expected);
  assert.deepEqual(Array.from(blobToUint8Array(Uint8Array.from(expected).buffer)), expected);
});


function mockD1Batch(changes) {
  const batches = [];
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        sql,
        bind(...values) {
          return {
            sql,
            values,
            async run() {
              calls.push({ sql, values });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
    async batch(statements) {
      batches.push(statements);
      return changes.map((count) => ({ meta: { changes: count } }));
    },
  };
  return { db, batches, calls };
}

test("login sessions are inserted only when the account is not actively banned", async () => {
  assert.match(SESSION_INSERT_IF_UNBANNED_SQL, /WHERE NOT EXISTS/);
  assert.match(SESSION_INSERT_IF_UNBANNED_SQL, /FROM bans WHERE user_id = \?/);
  assert.match(SESSION_INSERT_IF_UNBANNED_SQL, /revoked_at IS NULL/);
  assert.match(SESSION_INSERT_IF_UNBANNED_SQL, /expires_at IS NULL OR expires_at > \?/);

  const mock = mockD1Batch([0, 0]);
  const request = new Request("https://forum.example/api/auth/login");
  const session = await createSession(request, { FORUM_DB: mock.db }, 42, "old-guest-session", true);

  assert.equal(session, null);
  assert.equal(mock.batches.length, 1);
  assert.match(mock.batches[0][0].sql, /WHERE NOT EXISTS/);
  assert.match(mock.batches[0][1].sql, /DELETE FROM sessions/);
  assert.match(mock.batches[0][1].sql, /EXISTS/);
  assert.equal(mock.calls.length, 0);
});

test("a successful guarded login creates the new session and removes the guest session", async () => {
  const mock = mockD1Batch([1, 1]);
  const request = new Request("https://forum.example/api/auth/login");
  const session = await createSession(request, { FORUM_DB: mock.db }, 42, "old-guest-session", true);

  assert.ok(session);
  assert.match(session.setCookie, /HttpOnly/);
  assert.match(session.setCookie, /Secure/);
  assert.equal(mock.batches.length, 1);
  assert.equal(mock.calls.length, 1);
  assert.match(mock.calls[0].sql, /DELETE FROM sessions WHERE expires_at <= \?/);
});

test("threaded reply insertion atomically requires a viewable conversation and an unbanned author", () => {
  assert.ok(THREAD_REPLY_INSERT_SQL.includes("INSERT INTO posts (author_id, parent_id, body, visibility, created_at, last_activity_at, board, idempotency_key)"));
  assert.ok(THREAD_REPLY_INSERT_SQL.includes("SELECT ?, ?, ?, 'public', ?, ?, ?, ? WHERE EXISTS"));
  assert.ok(THREAD_REPLY_INSERT_SQL.includes("FROM posts WHERE id = ? AND visibility = 'public' AND ("));
  assert.ok(THREAD_REPLY_INSERT_SQL.includes("parent_id IS NULL OR EXISTS"));
  assert.ok(THREAD_REPLY_INSERT_SQL.includes("SELECT 1 FROM posts root WHERE root.id = posts.parent_id"));
  assert.ok(THREAD_REPLY_INSERT_SQL.includes("AND root.parent_id IS NULL AND root.visibility = 'public'"));
  assert.ok(THREAD_REPLY_INSERT_SQL.includes("NOT EXISTS (SELECT 1 FROM bans WHERE user_id = ?"));
  assert.ok(THREAD_REPLY_INSERT_SQL.includes("expires_at IS NULL OR expires_at > ?"));
  assert.match(REPLY_BUMP_SQL, /last_activity_at = MAX\(COALESCE\(last_activity_at, 0\), \?\)/);
});

test("unban updates require the selected ban to remain active and belong to the target", () => {
  assert.match(UNBAN_ACTIVE_UPDATE_SQL, /WHERE id = \? AND user_id = \?/);
  assert.match(UNBAN_ACTIVE_UPDATE_SQL, /revoked_at IS NULL/);
  assert.match(UNBAN_ACTIVE_UPDATE_SQL, /expires_at IS NULL OR expires_at > \?/);
});


test("password hashing stays within the Workers PBKDF2 iteration limit", () => {
  assert.equal(PBKDF2_ITERATIONS, 100000);
  assert.equal(isValidPasswordPepper("p".repeat(32)), true);
  assert.equal(isValidPasswordPepper("short"), false);
  assert.equal(isValidPasswordPepper("p".repeat(257)), false);
});

test("password hashes use the pepper and verify only with the matching pepper", async () => {
  const credentialFixture = "fixture-phrase-27";
  const pepper = "p".repeat(40);
  const otherPepper = "q".repeat(40);
  const stored = await hashPassword(credentialFixture, pepper);

  assert.notEqual(stored.hash, credentialFixture);
  assert.equal(await verifyPassword(credentialFixture, stored.salt, stored.hash, pepper), true);
  assert.equal(await verifyPassword(credentialFixture, stored.salt, stored.hash, otherPepper), false);
  assert.equal(await verifyPassword("different-fixture-83", stored.salt, stored.hash, pepper), false);
});


test("avatar and reaction rate limits are configured as separate account-scoped bindings", () => {
  assert.equal(RATE_LIMIT_BINDINGS["avatar-upload"], "AVATAR_UPLOAD_RATE_LIMITER");
  assert.equal(RATE_LIMIT_BINDINGS.reaction, "REACTION_RATE_LIMITER");
});

test("rate limiting fails closed when a required binding is missing", async () => {
  await assert.rejects(
    rateLimit(new Request("https://forum.example/api/me/avatar"), {}, "avatar-upload", "42"),
    (error) => error.status === 503,
  );
});

test("rate limiting rejects blocked requests and hashes actor-scoped keys", async () => {
  const receivedKeys = [];
  const env = {
    AVATAR_UPLOAD_RATE_LIMITER: {
      async limit({ key }) {
        receivedKeys.push(key);
        return { success: receivedKeys.length === 1 };
      },
    },
  };
  const request = new Request("https://forum.example/api/me/avatar", {
    headers: { "CF-Connecting-IP": "192.0.2.1" },
  });

  await rateLimit(request, env, "avatar-upload", "42");
  await assert.rejects(
    rateLimit(request, env, "avatar-upload", "42"),
    (error) => error.status === 429,
  );
  assert.equal(receivedKeys.length, 2);
  assert.match(receivedKeys[0], /^[a-f0-9]{64}$/);
  assert.equal(receivedKeys[0], receivedKeys[1]);
});

test("banning and session revocation are committed in one D1 batch", async () => {
  const mock = mockD1Batch([0, 1, 2]);
  const request = new Request("https://forum.example/api/admin/users/42/bans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "Repeated abuse" }),
  });

  const response = await createUserBan(mock.db, 42, 7, request);

  assert.equal(response.status, 201);
  assert.equal(mock.batches.length, 1);
  assert.equal(mock.batches[0].length, 3);
  assert.match(mock.batches[0][0].sql, /UPDATE bans SET revoked_at/);
  assert.match(mock.batches[0][1].sql, /INSERT INTO bans/);
  assert.match(mock.batches[0][2].sql, /DELETE FROM sessions WHERE user_id = \?/);
  assert.match(mock.batches[0][2].sql, /EXISTS \(SELECT 1 FROM bans WHERE user_id = \?/);
  assert.match(mock.batches[0][2].sql, /revoked_at IS NULL/);
});


test("first-admin setup secrets are bounded to the documented UI limit", () => {
  assert.equal(isValidSetupSecret("s".repeat(32)), true);
  assert.equal(isValidSetupSecret("s".repeat(4096)), true);
  assert.equal(isValidSetupSecret("s".repeat(31)), false);
  assert.equal(isValidSetupSecret("s".repeat(4097)), false);
  assert.equal(isValidSetupSecret(""), false);
  assert.equal(isValidSetupSecret(null), false);
});



test("API configuration errors retain security headers and are not cacheable", async () => {
  const response = await worker.fetch(new Request("https://forum.example/api/posts"), {});

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.match(response.headers.get("Content-Security-Policy"), /default-src 'self'/);
});

test("HTTPS API responses advertise HSTS", async () => {
  const response = await worker.fetch(new Request("https://forum.example/api/posts"), {});

  assert.equal(response.headers.get("Strict-Transport-Security"), "max-age=31536000");
});

test("static asset responses receive the common security headers", async () => {
  const response = await worker.fetch(new Request("https://forum.example/"), {
    ASSETS: {
      async fetch() {
        return new Response("ok", { headers: { "Content-Type": "text/plain" } });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.match(response.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
});


test("post creation remains blocked if a ban lands after the initial ban check", async () => {
  const calls = [];
  const siteverifyCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (typeof url === "string" && url.includes("challenges.cloudflare.com/turnstile/v0/siteverify")) {
      siteverifyCalls.push({
        body: String(init?.body ?? ""),
      });
      return new Response(JSON.stringify({ success: true, action: "post", hostname: "forum.example" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(url, init);
  };
  const env = {
    TURNSTILE_SECRET: "turnstile-secret-fixture",
    TURNSTILE_HOSTNAMES: "forum.example",
    WRITE_RATE_LIMITER: { async limit() { return { success: true }; } },
    POST_WRITE_RATE_LIMITER: { async limit() { return { success: true }; } },
    FORUM_DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return {
              async first() {
                calls.push({ sql, values, operation: "first" });
                if (sql.includes("FROM sessions s LEFT JOIN users u")) {
                  return {
                    token_hash: "stored-session-hash",
                    user_id: 7,
                    csrf_token: "csrf-test",
                    expires_at: 9999999999,
                    username: "member",
                    role: "member",
                    bio: "",
                    avatar_mime: null,
                    avatar_version: null,
                  };
                }
                if (sql.includes("FROM bans WHERE user_id = ?")) return null;
                return null;
              },
              async run() {
                calls.push({ sql, values, operation: "run" });
                if (sql.startsWith("INSERT INTO posts")) {
                  assert.match(sql, /WHERE NOT EXISTS/);
                  return { meta: { changes: 0, last_row_id: 0 } };
                }
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };

  const request = new Request("https://forum.example/api/posts", {
    method: "POST",
    headers: {
      "Origin": "https://forum.example",
      "Cookie": "wempo_session=" + "A".repeat(43),
      "X-CSRF-Token": "csrf-test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      body: "This should not be published after a ban.",
      "cf-turnstile-response": "turnstile-token-fixture",
    }),
  });

  let response;
  try {
    response = await worker.fetch(request, env);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(siteverifyCalls.length, 1);
  assert.match(siteverifyCalls[0].body, /secret=turnstile-secret-fixture/);
  assert.match(siteverifyCalls[0].body, /response=turnstile-token-fixture/);
  assert.match(siteverifyCalls[0].body, /remoteip=/);
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /banned/i);
  assert.ok(calls.some(({ sql, operation }) => operation === "run" && sql.startsWith("INSERT INTO posts")));
});


function originGuardTestEnv() {
  return {
    FORUM_DB: {},
    WRITE_RATE_LIMITER: { async limit() { return { success: true }; } },
  };
}

test("registration rejects an untrusted Origin before reading session state", async () => {
  const response = await worker.fetch(new Request("https://forum.example/api/auth/register", {
    method: "POST",
    headers: {
      Origin: "https://attacker.example",
      "Content-Type": "application/json",
    },
    body: "{}",
  }), originGuardTestEnv());

  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /origin/i);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("registration rejects requests without an Origin header", async () => {
  const response = await worker.fetch(new Request("https://forum.example/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }), originGuardTestEnv());

  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /origin/i);
});


// Registration with a mocked D1 store and a mocked siteverify (Task 13: the
// word filter rejects filtered usernames here).

function guestSessionRow() {
  return {
    token_hash: "a".repeat(64),
    user_id: null,
    csrf_token: "expected-csrf-token",
    expires_at: Math.floor(Date.now() / 1000) + 60,
    username: null,
    role: null,
    bio: "",
    avatar_status: null,
    avatar_mime: null,
    avatar_updated_at: null,
    avatar_version: null,
  };
}

function freshUserRow(overrides = {}) {
  return {
    id: "12",
    username: "fresh_user",
    username_key: "fresh_user",
    password_salt: "s".repeat(32),
    password_hash: "h".repeat(64),
    role: "member",
    bio: "",
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
    avatar_status: null,
    avatar_mime: null,
    avatar_updated_at: null,
    avatar_version: null,
    ...overrides,
  };
}

function registerDb() {
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            async first() {
              if (sql.includes("FROM sessions s LEFT JOIN users u")) return guestSessionRow();
              if (sql.includes("FROM users WHERE id = ?")) return freshUserRow({
                username: String(calls.find(({ sql: seen }) => seen.startsWith("INSERT INTO users"))?.values[0] ?? "fresh_user"),
              });
              return null;
            },
            async run() {
              if (sql.startsWith("INSERT INTO users")) {
                return { meta: { changes: 1, last_row_id: 12 } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
    async batch(statements) {
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return { db, calls };
}

async function registerRequest(db, overrides = {}, username = "clean_user") {
  const env = {
    FORUM_DB: db,
    WRITE_RATE_LIMITER: { async limit() { return { success: true }; } },
    REGISTER_RATE_LIMITER: { async limit() { return { success: true }; } },
    PASSWORD_PEPPER: "pepper-" + "p".repeat(32),
    TURNSTILE_SECRET: "turnstile-secret-fixture",
    TURNSTILE_HOSTNAMES: "forum.example",
    ...overrides,
  };
  const request = new Request("https://forum.example/api/auth/register", {
    method: "POST",
    headers: {
      Origin: "https://forum.example",
      Cookie: "wempo_session=" + "s".repeat(43),
      "X-CSRF-Token": "expected-csrf-token",
      "Content-Type": "application/json",
      "CF-Connecting-IP": "192.0.2.8",
    },
    body: JSON.stringify({
      username,
      password: "correct-horse-battery",
      "cf-turnstile-response": "turnstile-token-fixture",
    }),
  });
  const siteverify = withMockedSiteverify({ success: true, action: "signup", hostname: "forum.example" });
  try {
    return { response: await worker.fetch(request, env), siteverify: siteverify.seen };
  } finally {
    siteverify.done();
  }
}

test("registration rejects a username the word filter would alter", async () => {
  const { db, calls } = registerDb();
  const { response } = await registerRequest(db, {
    FILTERED_WORDS: "badword",
  }, "im_badword_here");

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "That username isn't allowed.");
  assert.ok(
    !calls.some(({ sql }) => sql.startsWith("INSERT INTO users")),
    "a filtered username must never reach the users table",
  );
});

test("the filtered-username rejection is identical for a differently cased attempt", async () => {
  const { db } = registerDb();
  // The exact same generic message, regardless of where the match lands.
  const { response } = await registerRequest(db, {
    FILTERED_WORDS: "clean",
  }, "Clean_user");

  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, "That username isn't allowed.");
  assert.ok(!("filteredWord" in payload));
  assert.ok(!("word" in payload));
  assert.ok(!("list" in payload));
});

test("registration still succeeds for a username that passes the filter", async () => {
  const { db, calls } = registerDb();
  const { response } = await registerRequest(db, {
    FILTERED_WORDS: "badword",
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.user.username, "clean_user");
  const insert = calls.find(({ sql }) => sql.startsWith("INSERT INTO users"));
  assert.ok(insert, "the user insert must run");
  assert.equal(insert.values[0], "clean_user");
});

test("registration accepts a filtered-looking username when FILTERED_WORDS is unset", async () => {
  const { db, calls } = registerDb();
  const { response } = await registerRequest(db, {}, "user_badword");
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.user.username, "user_badword");
  const insert = calls.find(({ sql }) => sql.startsWith("INSERT INTO users"));
  assert.ok(insert, "the user insert must run");
  assert.equal(insert.values[0], "user_badword");
});



function turnstileEnv(overrides = {}) {
  return {
    TURNSTILE_SECRET: "turnstile-secret-fixture",
    TURNSTILE_HOSTNAMES: "forum.example",
    ...overrides,
  };
}

const turnstileRequest = (token = "turnstile-token-fixture") => {
  const headers = { "CF-Connecting-IP": "192.0.2.8" };
  return new Request("https://forum.example/api/auth/login", {
    method: "POST",
    headers,
    body: JSON.stringify({ username: "test_user", password: "correct-horse-battery", "cf-turnstile-response": token }),
  });
};

function withMockedSiteverify(payload, status = 200) {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, body: String(init?.body ?? "") });
    return new Response(JSON.stringify(payload), { status });
  };
  return {
    seen,
    done() {
      globalThis.fetch = originalFetch;
    },
  };
}

test("human verification requires a bounded token before calling siteverify", async () => {
  for (const token of [undefined, "", "x".repeat(2049)]) {
    const request = turnstileRequest(token);
    const body = await request.json();
    const env = turnstileEnv();
    await assert.rejects(
      requireTurnstile(request, env, body, "login"),
      (error) => error.status === 403,
    );
  }
  // No local siteverify traffic should occur without a syntactically valid token.
  const siteverify = withMockedSiteverify({ success: true, action: "login", hostname: "forum.example" });
  assert.equal(siteverify.seen.length, 0);
  siteverify.done();
});

test("human verification is enforced only against configured hostnames", async () => {
  const request = turnstileRequest();
  const body = await request.json();

  await assert.rejects(
    requireTurnstile(request, turnstileEnv({ TURNSTILE_HOSTNAMES: "" }), body, "login"),
    (error) => error.status === 403,
  );
  await assert.rejects(
    requireTurnstile(request, turnstileEnv({ TURNSTILE_SECRET: "" }), body, "login"),
    (error) => error.status === 403,
  );
});

test("configured Turnstile wildcards allow only actual subdomains", async () => {
  const request = turnstileRequest();
  const body = await request.json();
  const configured = turnstileEnv({ TURNSTILE_HOSTNAMES: "*.preview.example" });
  const allowed = withMockedSiteverify({ success: true, action: "login", hostname: "branch.preview.example" });
  try {
    await requireTurnstile(request, configured, body, "login");
  } finally {
    allowed.done();
  }
  for (const hostname of [
    "preview.example",
    "branch.preview.example.attacker.test",
    "attackerpreview.example",
    "unrelated.test",
  ]) {
    const mocked = withMockedSiteverify({ success: true, action: "login", hostname });
    try {
      await assert.rejects(
        requireTurnstile(request, configured, body, "login"),
        (error) => error.status === 403,
      );
    } finally {
      mocked.done();
    }
  }
});

test("siteverify failures fail closed with a 403", async () => {
  const request = turnstileRequest();
  const body = await request.json();

  for (const payload of [
    { success: false },
    { success: true, action: "signup", hostname: "forum.example" },
    { success: true, action: "login", hostname: "attacker.example" },
  ]) {
    const siteverify = withMockedSiteverify(payload);
    try {
      await assert.rejects(
        requireTurnstile(request, turnstileEnv(), body, "login"),
        (error) => error.status === 403,
      );
      assert.equal(siteverify.seen.length, 1);
    } finally {
      siteverify.done();
    }
  }
});

test("siteverify network failures are recorded and fail closed", async () => {
  const request = turnstileRequest();
  const body = await request.json();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network unreachable");
  };
  try {
    await assert.rejects(
      requireTurnstile(request, turnstileEnv(), body, "login"),
      (error) => error.status === 403,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("human verification succeeds before the existing handler logic runs", async () => {
  const request = turnstileRequest();
  const body = await request.json();
  const siteverify = withMockedSiteverify({ success: true, action: "login", hostname: "forum.example" });
  try {
    await requireTurnstile(request, turnstileEnv(), body, "login");
    assert.equal(siteverify.seen.length, 1);
    assert.ok(siteverify.seen[0].url.includes(TURNSTILE_SITEVERIFY_URL));
    assert.match(siteverify.seen[0].body, /secret=turnstile-secret-fixture/);
    assert.match(siteverify.seen[0].body, /response=turnstile-token-fixture/);
    assert.match(siteverify.seen[0].body, /remoteip=192\.0\.2\.8/);
  } finally {
    siteverify.done();
  }
});

test("non-2xx siteverify responses fail closed instead of redeeming the handler", async () => {
  const request = turnstileRequest();
  const body = await request.json();
  const siteverify = withMockedSiteverify({ success: true, action: "login", hostname: "forum.example" }, 500);
  try {
    await assert.rejects(
      requireTurnstile(request, turnstileEnv(), body, "login"),
      (error) => error.status === 403,
    );
  } finally {
    siteverify.done();
  }
});
