// My posts (v2.5): ?mine=1 on the general feed filters to the SESSION's own
// roots (identity from the session; nothing spoofable), paginates a bare id
// cursor, and refuses guests before any database work.
import test from "node:test";
import assert from "node:assert/strict";
import forumWorker from "../worker.mjs";

function mockDb(routes, { batchMeta = null } = {}) {
  const calls = [];
  const batches = [];
  const db = {
    prepare(sql) {
      const route = routes.find((candidate) => candidate.sql.test(sql)) ||
        routes[routes.length - 1];
      if (!route) throw new Error("Unexpected SQL: " + sql);
      return {
        bind(...values) {
          const bound = { sql, values };
          calls.push(bound);
          return {
            sql,
            values,
            async first() {
              return typeof route.result === "function" ? route.result(values) : (route.result ?? null);
            },
            async all() {
              return { results: route.rows === undefined ? [] : route.rows };
            },
            async run() {
              return route.runMeta === undefined ? { meta: { changes: 1 } } : route.runMeta;
            },
          };
        },
      };
    },
    async batch(statements) {
      batches.push(statements);
      return statements.map((_s, index) => (batchMeta && batchMeta[index]) || { meta: { changes: 1 } });
    },
  };
  return { db, calls, batches };
}

const sessionRow = () => ({
  token_hash: "a".repeat(64),
  user_id: 7,
  csrf_token: "expected-csrf-token",
  expires_at: Math.floor(Date.now() / 1000) + 60,
  username: "test_user",
  role: "member",
  bio: "",
});
const sessionRoute = () => ({ sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow() });
const successLimiter = () => ({ async limit() { return { success: true }; } });
const envFor = (db) => ({
  FORUM_DB: db,
  READ_RATE_LIMITER: successLimiter(),
  WRITE_RATE_LIMITER: successLimiter(),
  POST_WRITE_RATE_LIMITER: successLimiter(),
  GUEST_SESSION_RATE_LIMITER: successLimiter(),
  TURNSTILE_SECRET: "t", TURNSTILE_HOSTNAMES: "forum.example", FILTERED_WORDS: "",
  IMAGE_UPLOAD_RATE_LIMITER: successLimiter(),
});

test("mine=1 filters roots to the session's own author id", async () => {
  const mock = mockDb([
    sessionRoute(),
    { sql: /FROM posts p JOIN users u/, rows: [] },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/posts?mine=1", {
      method: "GET",
      headers: { Cookie: "wempo_session=" + "s".repeat(43) },
    }),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  const feedCall = mock.calls.find((call) => call.sql.startsWith("SELECT p.id"));
  assert.ok(feedCall, "the feed SELECT runs");
  assert.match(feedCall.sql, /p\.author_id = \?/);
  // Bind order: the viewer id, then the author filter id.
  assert.deepEqual(feedCall.values.slice(0, 2), [7, 7]);
  assert.ok(!feedCall.sql.includes("last_activity_at < ?"), "the mine feed paginates bare ids, not composites");
});

test("a guest asking for mine=1 is a 401 before any database work", async () => {
  const mock = mockDb([{ sql: /./ }]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/posts?mine=1", { method: "GET" }),
    envFor(mock.db),
  );
  assert.equal(response.status, 401);
  assert.ok(!mock.calls.some((call) => call.sql.startsWith("SELECT p.id")));
});

test("a malformed mine value is a 400", async () => {
  const mock = mockDb([{ sql: /./ }]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/posts?mine=yes", {
      method: "GET",
      headers: { Cookie: "wempo_session=" + "s".repeat(43) },
    }),
    envFor(mock.db),
  );
  assert.equal(response.status, 400);
});

test("the mine feed's cursor is a bare id", async () => {
  const mock = mockDb([
    sessionRoute(),
    { sql: /FROM posts p JOIN users u/, rows: [] },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/posts?mine=1&before=50", {
      method: "GET",
      headers: { Cookie: "wempo_session=" + "s".repeat(43) },
    }),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  const feedCall = mock.calls.find((call) => call.sql.startsWith("SELECT p.id"));
  assert.match(feedCall.sql, /p\.id < \?/);
  // Bind order in the authorId branch: viewer, then the id-cursor, then the
  // author filter.
  assert.deepEqual(feedCall.values.slice(1), [50, 7]);
});

test("the mine cursor rejects a composite format", async () => {
  const mock = mockDb([
    sessionRoute(),
    { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/posts?mine=1&before=40_50", {
      method: "GET",
      headers: { Cookie: "wempo_session=" + "s".repeat(43) },
    }),
    envFor(mock.db),
  );
  assert.equal(response.status, 400);
});
