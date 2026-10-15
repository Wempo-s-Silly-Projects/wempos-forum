import test from "node:test";
import assert from "node:assert/strict";
import forumWorker from "../worker.mjs";

// D1 mock: routes are { sql: RegExp, result?, rows?, runMeta? }. prepare() picks
// the first route whose regex matches the SQL (last route is the fallback).
// `result` is a row, or a function of the bind values for value-dependent lookups
// (postById fetches different posts by bound id).
function mockDb(routes) {
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
              return typeof route.result === "function"
                ? route.result(values)
                : (route.result === undefined ? null : route.result);
            },
            async all() {
              return { results: route.rows === undefined ? [] : route.rows };
            },
            async run() {
              return route.runMeta === undefined
                ? { meta: { changes: 1 } }
                : (typeof route.runMeta === "function" ? route.runMeta(values) : route.runMeta);
            },
          };
        },
      };
    },
    async batch(statements) {
      batches.push(statements);
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return { db, calls, batches };
}

function successLimiter() {
  return { async limit() { return { success: true }; } };
}

function envFor(db) {
  return {
    FORUM_DB: db,
    READ_RATE_LIMITER: successLimiter(),
    WRITE_RATE_LIMITER: successLimiter(),
    REACTION_RATE_LIMITER: successLimiter(),
  };
}

function signedInSessionRow(overrides = {}) {
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
    ...overrides,
  };
}

function postRow(overrides = {}) {
  return {
    id: "1",
    author_id: "3",
    parent_id: null,
    body: "root body",
    visibility: "public",
    created_at: 1700000000,
    last_activity_at: 1700000005,
    author_username: "rootauthor",
    avatar_mime: null,
    avatar_updated_at: null,
    avatar_version: null,
    parent_body: null,
    like_count: 0,
    dislike_count: 0,
    viewer_reaction: null,
    ...overrides,
  };
}

function requestFor(url, method, body, headers = {}) {
  return new Request(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "https://forum.example",
      "X-CSRF-Token": "expected-csrf-token",
      Cookie: "wempo_session=" + "s".repeat(43),
      ...headers,
    },
    body: method === "GET" ? undefined : body === undefined ? undefined : JSON.stringify(body),
  });
}

async function route(request, env) {
  return forumWorker.fetch(request, env);
}

const sessionRoute = { sql: /FROM sessions s LEFT JOIN users u/, result: signedInSessionRow() };
const banCheckRoute = { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null };

// postById binds (viewerId, postId), so the row is chosen by the second bound value.
function reactionRoutes(rowForId) {
  return [
    sessionRoute,
    banCheckRoute,
    {
      sql: /WHERE p\.id = \? LIMIT 1/,
      result: (values) => rowForId(values[1]),
    },
    { sql: /./ },
  ];
}

test("DELETE reaction on a visible post removes only that viewer's reaction and returns ok", async () => {
  const root = postRow({ id: "1", author_id: "3", parent_id: null });
  const mock = mockDb(reactionRoutes((id) => (id === 1 ? root : null)));
  const response = await route(
    requestFor("https://forum.example/api/posts/1/reaction", "DELETE", { value: "like" }),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const deletes = mock.calls.filter((call) => /^DELETE FROM reactions/.test(call.sql));
  assert.equal(deletes.length, 1, "exactly one DELETE statement must run");
  assert.match(
    deletes[0].sql,
    /^DELETE FROM reactions WHERE post_id = \? AND user_id = \?$/,
  );
  assert.deepEqual(deletes[0].values, [1, 7]);
  assert.equal(mock.batches.length, 0, "the reaction delete must not use a D1 batch");
});

test("DELETE reaction is idempotent: a second delete with no matching row still returns ok", async () => {
  const root = postRow({ id: "1", author_id: "3", parent_id: null });
  const mock = mockDb([
    ...reactionRoutes((id) => (id === 1 ? root : null)).slice(0, 3),
    {
      sql: /^DELETE FROM reactions WHERE post_id = \? AND user_id = \?$/,
      runMeta: { meta: { changes: 0 } },
    },
    { sql: /./ },
  ]);
  const response = await route(
    requestFor("https://forum.example/api/posts/1/reaction", "DELETE", { value: "like" }),
    envFor(mock.db),
  );

  assert.equal(response.status, 200, "0 changed rows must still be a success");
  assert.deepEqual(await response.json(), { ok: true });
});

test("DELETE reaction never reads the request body", async () => {
  const root = postRow({ id: "1", author_id: "3", parent_id: null });
  const mock = mockDb(reactionRoutes((id) => (id === 1 ? root : null)));
  const response = await route(
    new Request("https://forum.example/api/posts/1/reaction", {
      method: "DELETE",
      headers: {
        "Content-Type": "text/plain",
        Origin: "https://forum.example",
        "X-CSRF-Token": "expected-csrf-token",
        Cookie: "wempo_session=" + "s".repeat(43),
      },
      body: "not json at all",
    }),
    envFor(mock.db),
  );

  assert.equal(response.status, 200, "body parsing must be skipped for DELETE");
  assert.deepEqual(await response.json(), { ok: true });
  const deletes = mock.calls.filter((call) => /^DELETE FROM reactions/.test(call.sql));
  assert.equal(deletes.length, 1);
});

test("DELETE reaction on an invisible post is 404 and never touches the reactions table", async () => {
  const hidden = postRow({ id: "2", author_id: "3", parent_id: null, visibility: "hidden" });
  const mock = mockDb(reactionRoutes((id) => (id === 2 ? hidden : null)));
  const response = await route(
    requestFor("https://forum.example/api/posts/2/reaction", "DELETE", { value: "like" }),
    envFor(mock.db),
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Post not found." });
  assert.equal(
    mock.calls.filter((call) => /^DELETE FROM reactions/.test(call.sql)).length,
    0,
    "an invisible post must not have its reactions deleted",
  );
});

test("DELETE reaction is refused for banned accounts before any post lookup", async () => {
  const root = postRow({ id: "1", author_id: "3", parent_id: null });
  const bannedRoutes = [
    sessionRoute,
    { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: { id: 1 } },
    { sql: /WHERE p\.id = \? LIMIT 1/, result: (values) => (values[1] === 1 ? root : null) },
    { sql: /./ },
  ];
  const mock = mockDb(bannedRoutes);
  const response = await route(
    requestFor("https://forum.example/api/posts/1/reaction", "DELETE", { value: "like" }),
    envFor(mock.db),
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "This account is currently banned." });
  assert.equal(
    mock.calls.filter((call) => /^DELETE FROM reactions/.test(call.sql)).length,
    0,
  );
});

test("GET to the reaction path is a 405 method gate, not a fall-through 404", async () => {
  const mock = mockDb(reactionRoutes(() => null));
  const response = await route(
    new Request("https://forum.example/api/posts/1/reaction", {
      headers: { "CF-Connecting-IP": "192.0.2.9" },
    }),
    envFor(mock.db),
  );

  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "That method is not supported." });
  assert.equal(mock.calls.length, 0, "the method gate must reject before any SQL runs");
});