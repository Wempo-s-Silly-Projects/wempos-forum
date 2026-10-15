import test from "node:test";
import assert from "node:assert/strict";
import { blobToUint8Array, canViewPost, createAvatarVersion, createSession, createUserBan, hashPassword, isValidPassword, isValidPasswordPepper, isValidUsername, PBKDF2_ITERATIONS, RATE_LIMIT_BINDINGS, rateLimit, SEARCH_USERS_SQL, SESSION_INSERT_IF_UNBANNED_SQL, UNBAN_ACTIVE_UPDATE_SQL, sniffImageMime, verifyPassword } from "../worker.mjs";

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


function envWithParent(parent) {
  return {
    FORUM_DB: {
      prepare() {
        return {
          bind() {
            return { first: async () => parent };
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
  assert.equal(await canViewPost({ FORUM_DB: null }, hiddenRoot, { id: 7, role: "member" }), true);
  assert.equal(await canViewPost({ FORUM_DB: null }, hiddenRoot, { id: 8, role: "admin" }), true);
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
