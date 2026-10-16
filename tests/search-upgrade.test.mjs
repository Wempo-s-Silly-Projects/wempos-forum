// Search upgrades (v2.5): `by=<username>` (author filter) and `in=replies`
// (deep reply-text search). Same gates/caps as search today; reply results
// carry their thread-root link + visibility/ban filtering.
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
  token_hash: "a".repeat(64), user_id: 7, csrf_token: "expected-csrf-token",
  expires_at: Math.floor(Date.now() / 1000) + 60, username: "test_user",
  role: "member", bio: "",
});
const sessionRoute = () => ({ sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow() });
const banCheckRoute = { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null };
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

test("by=<username> filters post results to that member's roots", async () => {
  const user = { id: 12, username: "wempo", username_key: "wempo", role: "member", bio: "" };
  const mock = mockDb([
    sessionRoute(),
    { sql: /SELECT id, username, username_key/, result: user },
    { sql: /FROM posts p JOIN users u/, rows: [] },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/search?q=taco&by=wempo", { method: "GET" }),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  const postCall = mock.calls.find((call) => call.sql.startsWith("SELECT p.id"));
  assert.ok(postCall, "the posts SELECT runs");
  assert.match(postCall.sql, /p\.author_id = \?/);
  // Binds: viewer id, the term, then the author id.
  assert.ok(postCall.values.includes("taco"));
  assert.ok(postCall.values.includes(12), "the author id bound");
});

test("an unknown by-name returns an EMPTY posts list (no error)", async () => {
  const mock = mockDb([
    sessionRoute(),
    { sql: /SELECT id, username, username_key/, result: null },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/search?q=taco&by=nobody", { method: "GET" }),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.posts, []);
});

test("in=replies searches reply TEXT (visibility/ban filtered, thread-linked)", async () => {
  const replyRows = [
    { id: 9, parent_id: 4, root_id: 2, author_id: 3, body: "taco tuesday", visibility: "public", created_at: 1700000005, author_username: "bob", avatar_mime: null, avatar_version: null },
  ];
  const mock = mockDb([
    sessionRoute(),
    banCheckRoute,
    { sql: /FROM posts r JOIN users u/, rows: replyRows },
    // canViewPost's chain gate + threadRootId's root lookup.
    { sql: /SELECT id, author_id, visibility, parent_id FROM posts WHERE id = \?/, result: { id: 4, author_id: 3, visibility: "public", parent_id: 2 } },
    { sql: /SELECT id, parent_id FROM posts WHERE id = \?/, result: { id: 4, parent_id: 2 } },
    { sql: /SELECT 1 FROM bans b WHERE b\.user_id = \?/, result: null },
    { sql: /./, result: null },
  ]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/search?q=taco&in=replies", { method: "GET" }),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.replies.length, 1);
  assert.deepEqual(payload.replies[0].body, "taco tuesday");
  assert.deepEqual(payload.replies[0].threadId, 2, "thread-root link rides the row");
  const replyCall = mock.calls.find((call) => call.sql.startsWith("SELECT r.id"));
  assert.ok(replyCall, "the replies SELECT runs");
  assert.match(replyCall.sql, /instr\(lower\(r\.body\), \?\) > 0/);
  assert.match(replyCall.sql, /NOT EXISTS \(SELECT 1 FROM bans/);
});

test("the plain search shape is unchanged when the new params are absent", async () => {
  const mock = mockDb([
    sessionRoute(),
    { sql: /SELECT id, username, username_key/, rows: [] },
    { sql: /FROM posts p JOIN users u/, rows: [] },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/search?q=taco", { method: "GET" }),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal("replies" in payload, false, "no replies key on the classic shape");
});

test("an unknown in= value is a 400", async () => {
  const mock = mockDb([{ sql: /./ }]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/search?q=taco&in=comments", { method: "GET" }),
    envFor(mock.db),
  );
  assert.equal(response.status, 400);
});