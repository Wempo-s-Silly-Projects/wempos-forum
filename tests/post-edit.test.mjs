// Author post editing (v2.4): PATCH /api/posts/:id route tests. Follows the
// threading.test.mjs patterns — the same mockDb route-matching D1 mock, the
// same fixture shapes, the same worker.fetch entrypoint.
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
      return statements.map((_statement, index) =>
        (batchMeta && batchMeta[index]) || { meta: { changes: 1 } });
    },
  };
  return { db, calls, batches };
}

function successLimiter() {
  return { async limit() { return { success: true }; } };
}

function envFor(db, overrides = {}) {
  return {
    FORUM_DB: db,
    READ_RATE_LIMITER: successLimiter(),
    WRITE_RATE_LIMITER: successLimiter(),
    POST_WRITE_RATE_LIMITER: successLimiter(),
    TURNSTILE_SECRET: "turnstile-secret-fixture",
    TURNSTILE_HOSTNAMES: "forum.example",
    FILTERED_WORDS: "",
    ...overrides,
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
    author_id: "7",
    parent_id: null,
    body: "original body",
    visibility: "public",
    created_at: 1700000000,
    last_activity_at: 1700000005,
    edited_at: null,
    author_username: "test_user",
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

function requestFor(url, body, headers = {}) {
  return new Request(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://forum.example",
      "X-CSRF-Token": "expected-csrf-token",
      Cookie: "wempo_session=" + "s".repeat(43),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const sessionRoute = { sql: /FROM sessions s LEFT JOIN users u/, result: signedInSessionRow() };
const guestSessionRoute = { sql: /FROM sessions s LEFT JOIN users u/, result: null };
const banCheckRoute = { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null };
// postById binds (viewerId, postId): the row is chosen by the second bound value.
const postByIdRoute = (rowForId) => ({
  sql: /WHERE p\.id = \? LIMIT 1/,
  result: (values) => rowForId(values[1]),
});
const updateRoute = { sql: /^UPDATE posts SET body = \?, edited_at = \? WHERE id = \? AND author_id = \?$/ };
const fallbackRoute = { sql: /./ };

function editRoutes(rowForId, overrides = {}) {
  return [
    overrides.session ?? sessionRoute,
    banCheckRoute,
    postByIdRoute(rowForId),
    updateRoute,
    fallbackRoute,
  ];
}

async function route(request, env) {
  return forumWorker.fetch(request, env);
}

// --- Serialization contract ------------------------------------------------

test("POST_SELECT exposes the edit stamp so every serialized post can carry editedAt", () => {
  assert.match(POST_SELECT, /p\.edited_at/);
});

// --- Author edit happy path ---------------------------------------------------

test("the author's edit stores the masked body, stamps edited_at, and never touches last_activity_at", async () => {
  const own = postRow({ id: "1", author_id: "7" });
  const mock = mockDb(editRoutes((id) => (id === 1 ? own : null)));
  const response = await route(
    requestFor("https://forum.example/api/posts/1", { body: "I said badword today" }),
    envFor(mock.db, { FILTERED_WORDS: "badword" }),
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.id, 1);

  const update = mock.calls.find((call) => call.sql.startsWith("UPDATE posts"));
  assert.ok(update, "the edit must run one UPDATE");
  assert.match(update.sql, /^UPDATE posts SET body = \?, edited_at = \? WHERE id = \? AND author_id = \?$/);
  assert.ok(!update.sql.includes("last_activity_at"), "an edit must never bump the feed");
  assert.deepEqual(update.values.length, 4, "no last_activity_at bind, no extra columns");
  // The word filter is REAPPLIED on edit: the masked body, not the raw text,
  // is what lands in the row. Whole-word match on "badword".
  assert.equal(update.values[0], "I said ******* today");
  assertRecentSeconds(update.values[1]);
  assert.deepEqual(update.values.slice(2), [1, 7], "ownership re-checked at write time");
  // The response's editedAt is the same stamp that was written.
  assert.equal(
    payload.editedAt,
    new Date(Number(update.values[1]) * 1000).toISOString(),
  );
  assert.equal(mock.batches.length, 0, "an edit is a single UPDATE, never a batch");

  // Filter off (unset secret): the raw body passes through byte-for-byte.
  const unfiltered = mockDb(editRoutes((id) => (id === 1 ? own : null)));
  const ok = await route(
    requestFor("https://forum.example/api/posts/1", { body: "edited body" }),
    envFor(unfiltered.db, { FILTERED_WORDS: "" }),
  );
  assert.equal(ok.status, 200);
  assert.equal(
    unfiltered.calls.find((call) => call.sql.startsWith("UPDATE posts")).values[0],
    "edited body",
  );
});

function assertRecentSeconds(value) {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(typeof value, "number");
  assert.ok(Math.abs(value - now) < 30, "timestamp should be seconds since epoch");
}

// --- Access control ------------------------------------------------------------

test("a non-author member is refused with 403 and never reaches the UPDATE", async () => {
  // Session user 7 faces a post authored by 9.
  const others = postRow({ id: "4", author_id: "9" });
  const mock = mockDb(editRoutes((id) => (id === 4 ? others : null)));
  const response = await route(
    requestFor("https://forum.example/api/posts/4", { body: "hijack attempt" }),
    envFor(mock.db),
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "Only the author can edit this post.");
  // Same refusal for an administrator identity — author-only, no role path.
  const adminMock = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: signedInSessionRow({ role: "admin" }) },
    banCheckRoute,
    postByIdRoute((id) => (id === 4 ? others : null)),
    updateRoute,
    fallbackRoute,
  ]);
  const adminResponse = await route(
    requestFor("https://forum.example/api/posts/4", { body: "moderator edit" }),
    envFor(adminMock.db),
  );
  assert.equal(adminResponse.status, 403);
  assert.equal(
    mock.calls.filter((call) => call.sql.startsWith("UPDATE posts")).length +
      adminMock.calls.filter((call) => call.sql.startsWith("UPDATE posts")).length,
    0,
    "no edit UPDATE may run for a non-author",
  );
});

test("a guest is refused with 401 before any post lookup", async () => {
  const mock = mockDb([
    guestSessionRoute,
    banCheckRoute,
    postByIdRoute(() => postRow()),
    updateRoute,
    fallbackRoute,
  ]);
  const response = await route(
    requestFor("https://forum.example/api/posts/1", { body: "ghost edit" }),
    envFor(mock.db),
  );

  assert.equal(response.status, 401);
  assert.ok((await response.json()).error.length > 0);
  assert.equal(mock.batches.length, 0);
});

test("the author can edit a hidden own post, and the hidden state itself is untouched", async () => {
  const hiddenOwn = postRow({ id: "8", author_id: "7", visibility: "hidden" });
  const mock = mockDb(editRoutes((id) => (id === 8 ? hiddenOwn : null)));
  const response = await route(
    requestFor("https://forum.example/api/posts/8", { body: "still my post" }),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  const update = mock.calls.find((call) => call.sql.startsWith("UPDATE posts"));
  assert.deepEqual(update.values.slice(2), [8, 7]);
  assert.ok(!update.sql.includes("visibility"), "an edit may never flip visibility");
});

test("an unknown post id is a 404 with no UPDATE", async () => {
  const mock = mockDb(editRoutes(() => null));
  const response = await route(
    requestFor("https://forum.example/api/posts/999", { body: "nobody's post" }),
    envFor(mock.db),
  );

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "Post not found.");
  assert.equal(mock.calls.filter((call) => call.sql.startsWith("UPDATE posts")).length, 0);
});

// --- Validation -------------------------------------------------------------------

test("a 1,001-character edit body is rejected with 400 and the exact 1,000-character message", async () => {
  const own = postRow({ id: "1", author_id: "7" });
  const mock = mockDb(editRoutes((id) => (id === 1 ? own : null)));
  const response = await route(
    requestFor("https://forum.example/api/posts/1", { body: "W".repeat(1001) }),
    envFor(mock.db),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Post must be between 1 and 1000 characters.");
  assert.equal(mock.calls.filter((call) => call.sql.startsWith("UPDATE posts")).length, 0,
    "the oversized body stopped at validation");
});

test("a 1,000-character edit body is accepted", async () => {
  const own = postRow({ id: "1", author_id: "7" });
  const mock = mockDb(editRoutes((id) => (id === 1 ? own : null)));
  const response = await route(
    requestFor("https://forum.example/api/posts/1", { body: "W".repeat(1000) }),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  assert.equal(
    mock.calls.find((call) => call.sql.startsWith("UPDATE posts")).values[0],
    "W".repeat(1000),
  );
});

test("a whitespace-only or non-string edit body is rejected with 400", async () => {
  const own = postRow({ id: "1", author_id: "7" });
  for (const bad of ["   \n\t", 42, null, undefined]) {
    const mock = mockDb(editRoutes((id) => (id === 1 ? own : null)));
    const response = await route(
      requestFor("https://forum.example/api/posts/1", { body: bad }),
      envFor(mock.db),
    );
    assert.equal(response.status, 400, JSON.stringify(bad));
    assert.equal(mock.calls.filter((call) => call.sql.startsWith("UPDATE posts")).length, 0);
  }
});

// --- Read paths ----------------------------------------------------------------

test("serialized posts carry editedAt null when never edited and an ISO stamp when edited", async () => {
  const routes = (rows) => [{ sql: /FROM posts p JOIN users u/, rows }, { sql: /./ }];
  const never = mockDb(routes([postRow({ id: "1", edited_at: null })]));
  const neverResponse = await route(
    new Request("https://forum.example/api/posts", { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(never.db),
  );
  assert.equal(neverResponse.status, 200);
  assert.equal((await neverResponse.json()).posts[0].editedAt, null);

  const edited = mockDb(routes([postRow({ id: "1", edited_at: 1700000010 })]));
  const editedResponse = await route(
    new Request("https://forum.example/api/posts", { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(edited.db),
  );
  assert.equal(editedResponse.status, 200);
  assert.equal(
    (await editedResponse.json()).posts[0].editedAt,
    new Date(1700000010 * 1000).toISOString(),
  );
});

test("rate limiting gates the edit route with both the write and post-write scopes", async () => {
  const own = postRow({ id: "1", author_id: "7" });
  const scopesCalled = [];
  const env = envFor(mockDb(editRoutes((id) => (id === 1 ? own : null))).db, {
    WRITE_RATE_LIMITER: {
      async limit({ key }) {
        scopesCalled.push({ scope: "write", key });
        return { success: true };
      },
    },
    POST_WRITE_RATE_LIMITER: {
      async limit({ key }) {
        scopesCalled.push({ scope: "post-write", key });
        return { success: true };
      },
    },
  });
  // The post-write scope is account-scoped; the hashed key matches the identity
  // convention (sha256 of "post-write:7"). The write scope is IP-scoped.
  const response = await route(
    requestFor("https://forum.example/api/posts/1", { body: "third time" }, {
      "CF-Connecting-IP": "192.0.2.10",
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(scopesCalled.map((call) => call.scope), ["write", "write", "post-write"],
    "routeApi's write gate plus the handler's write and post-write gates");
  assert.match(scopesCalled[2].key, /^[a-f0-9]{64}$/);
});