// View counter (v2.4.3, raw impressions): one view per detail read by a
// NON-author; author's own reads don't count; counts never affect sorting;
// the returned payload reads the FRESH total via UPDATE ... RETURNING so a
// view isn't lost between the read and the increment.
import test from "node:test";
import assert from "node:assert/strict";
import forumWorker from "../worker.mjs";
import { POST_SELECT } from "../api/posts.mjs";

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

const sessionRow = (overrides = {}) => ({
  token_hash: "a".repeat(64),
  user_id: 7,
  csrf_token: "expected-csrf-token",
  expires_at: Math.floor(Date.now() / 1000) + 60,
  username: "test_user",
  role: "member",
  bio: "",
  ...overrides,
});
const sessionRoute = (overrides) => ({ sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow(overrides) });
const successLimiter = () => ({ async limit() { return { success: true }; } });
const envFor = (db, overrides = {}) => ({
  FORUM_DB: db,
  READ_RATE_LIMITER: successLimiter(),
  WRITE_RATE_LIMITER: successLimiter(),
  POST_WRITE_RATE_LIMITER: successLimiter(),
  GUEST_SESSION_RATE_LIMITER: successLimiter(),
  TURNSTILE_SECRET: "t", TURNSTILE_HOSTNAMES: "forum.example", FILTERED_WORDS: "",
  IMAGE_UPLOAD_RATE_LIMITER: successLimiter(),
  ...overrides,
});

const postRow = (overrides = {}) => ({
  id: "1",
  author_id: "3",
  parent_id: null,
  body: "root body",
  visibility: "public",
  created_at: 1700000000,
  last_activity_at: 1700000005,
  edited_at: null,
  board: "general",
  view_count: "4",
  author_username: "rootauthor",
  avatar_mime: null,
  avatar_updated_at: null,
  avatar_version: null,
  parent_body: null,
  like_count: 0,
  dislike_count: 0,
  viewer_reaction: null,
  ...overrides,
});

test("POST_SELECT exposes view_count so every card can show it", () => {
  assert.match(POST_SELECT, /p\.view_count/);
});

test("a member's detail read counts one view and reports the FRESH total", async () => {
  const row = postRow({ view_count: "4" });
  // The increment's RETURNING result drives the payload's count.
  const mock = mockDb([
    sessionRoute(),
    { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null },
    { sql: /WHERE p\.id = \? LIMIT 1/, result: () => row },
    { sql: /^UPDATE posts SET view_count = view_count \+ 1 WHERE id = \? RETURNING view_count$/, result: { view_count: 5 } },
    { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null },
    { sql: /SELECT 1 FROM bans b WHERE b\.user_id = \?/, result: null },
    banAncestorRoute(),
    { sql: /WHERE p\.parent_id = \?/, rows: [] },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/posts/1", {
      method: "GET",
      headers: { Cookie: "wempo_session=" + "s".repeat(43) },
    }),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.viewCount, 5, "RETURNING value, not the stale read");
  const increment = mock.calls.find((call) => call.sql.startsWith("UPDATE posts SET view_count"));
  assert.ok(increment, "a non-author view increments");
  assert.deepEqual(increment.values, [1]);
});

function banAncestorRoute() {
  return { sql: /FROM posts WHERE id = \? LIMIT 1/, result: null };
}

test("the author's own read does NOT count a view", async () => {
  const row = postRow({ author_id: "7" });
  const mock = mockDb([
    sessionRoute(),
    { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null },
    { sql: /WHERE p\.id = \? LIMIT 1/, result: () => row },
    { sql: /SELECT 1 FROM bans b WHERE b\.user_id = \?/, result: null },
    { sql: /where/i, rows: [] },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/posts/1", {
      method: "GET",
      headers: { Cookie: "wempo_session=" + "s".repeat(43) },
    }),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).viewCount, 4, "the row's own count, unchanged");
  assert.equal(
    mock.calls.some((call) => call.sql.startsWith("UPDATE posts SET view_count")),
    false,
    "self-views never increment",
  );
});

test("a guest's read counts a view", async () => {
  const row = postRow({ view_count: "0" });
  const mock = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: null },
    { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null },
    { sql: /WHERE p\.id = \? LIMIT 1/, result: () => row },
    { sql: /^UPDATE posts SET view_count = view_count \+ 1 WHERE id = \? RETURNING view_count$/, result: { view_count: 1 } },
    { sql: /SELECT 1 FROM bans b WHERE b\.user_id = \?/, result: null },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/posts/1", { method: "GET" }),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).viewCount, 1);
});

test("a failed increment never fails the read (counting is best-effort)", async () => {
  const row = postRow({ view_count: "4" });
  function throwingDb() {
    return {
      db: {
        prepare(sql) {
          if (sql.startsWith("UPDATE posts SET view_count")) {
            return {
              bind() {
                return { async first() { throw new Error("D1 hiccup"); } };
              },
            };
          }
          if (/WHERE p\.id = \? LIMIT 1/.test(sql)) {
            return {
              bind() {
                return { async first() { return postRow({ view_count: "4" }); } };
              },
            };
          }
          if (/FROM sessions s LEFT JOIN users u/.test(sql)) {
            return {
              bind() {
                return { async first() { return null; } };
              },
            };
          }
          return {
            bind(...values) {
              return {
                async first() { return null; },
                async all() { return { results: [] }; },
                async run() { return { meta: { changes: 0 } }; },
              };
            },
          };
        },
        async batch(statements) { return statements.map(() => ({ meta: { changes: 0 } })); },
      },
    };
  }
  const fixture = throwingDb();
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/posts/1", { method: "GET" }),
    envFor(fixture.db),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).viewCount, 4, "stale value survives the failed count");
});

test("feed reads never increment views", async () => {
  const mock = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow() },
    { sql: /FROM posts p JOIN users u/, rows: [postRow()] },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/posts", { method: "GET" }),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  assert.equal(
    mock.calls.some((call) => call.sql.startsWith("UPDATE posts SET view_count")),
    false,
    "only detail reads count",
  );
});
