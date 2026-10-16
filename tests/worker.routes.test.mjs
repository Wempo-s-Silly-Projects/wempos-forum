import test from "node:test";
import assert from "node:assert/strict";
import forumWorker from "../worker.mjs";

function envWithLimiter(db) {
  return {
    FORUM_DB: db,
    READ_RATE_LIMITER: {
      async limit() {
        return { success: true };
      },
    },
    WRITE_RATE_LIMITER: {
      async limit() {
        return { success: true };
      },
    },
  };
}

function jsonPostRequest(headers = {}) {
  return new Request("https://forum.example/api/posts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ body: "A test post" }),
  });
}

test("state-changing API requests without an Origin are rejected before database access", async () => {
  const db = {
    prepare() {
      throw new Error("Database must not be queried before the origin check");
    },
  };

  const response = await forumWorker.fetch(
    jsonPostRequest(),
    envWithLimiter(db),
  );

  assert.equal(response.status, 403);
  assert.match(response.headers.get("Content-Type") || "", /application\/json/i);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match((await response.json()).error, /origin/i);
});

test("state-changing API requests reject a cross-origin Origin before database access", async () => {
  const db = {
    prepare() {
      throw new Error("Database must not be queried before the origin check");
    },
  };

  const response = await forumWorker.fetch(
    jsonPostRequest({ Origin: "https://attacker.example" }),
    envWithLimiter(db),
  );

  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /origin/i);
});

test("same-origin state-changing API requests without a session are rejected", async () => {
  const db = {
    prepare(sql) {
      assert.match(sql, /FROM sessions s LEFT JOIN users u/);
      return {
        bind() {
          return {
            async first() {
              return null;
            },
          };
        },
      };
    },
  };

  const response = await forumWorker.fetch(
    jsonPostRequest({ Origin: "https://forum.example" }),
    envWithLimiter(db),
  );

  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /session/i);
});

test("same-origin state-changing API requests reject a missing CSRF token", async () => {
  const sessionToken = "s".repeat(43);
  const db = {
    prepare(sql) {
      assert.match(sql, /FROM sessions s LEFT JOIN users u/);
      return {
        bind() {
          return {
            async first() {
              return {
                token_hash: "a".repeat(64),
                user_id: 7,
                csrf_token: "expected-csrf-token",
                expires_at: Math.floor(Date.now() / 1000) + 60,
                username: "test_user",
                role: "member",
                bio: "",
                avatar_mime: null,
                avatar_updated_at: null,
                avatar_version: null,
              };
            },
          };
        },
      };
    },
  };

  const response = await forumWorker.fetch(
    jsonPostRequest({
      Origin: "https://forum.example",
      Cookie: `wempo_session=${sessionToken}`,
    }),
    envWithLimiter(db),
  );

  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /security token/i);
});

test("GET /api/attachments/:id reaches the attachment serving route, not the worker fallback", async () => {
  const db = {
    prepare(sql) {
      assert.match(sql, /FROM attachments WHERE id = \?/);
      return {
        bind() {
          return {
            async first() {
              return null;
            },
          };
        },
      };
    },
  };

  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/attachments/3f2a7c94-9b1e-4d58-8c1a-7e0d5b9f2a41"),
    envWithLimiter(db),
  );

  // A 404 from the attachment handler (unknown id) proves the route group is
  // registered; the worker fallback would say "That API endpoint does not
  // exist." without ever querying the database.
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /attachment/i);
});
