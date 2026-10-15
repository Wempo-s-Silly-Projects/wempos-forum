import test from "node:test";
import assert from "node:assert/strict";
import forumWorker, { canViewPost } from "../worker.mjs";
import { THREAD_REPLY_INSERT_SQL, REPLY_BUMP_SQL } from "../constants.mjs";
import { listRootPosts } from "../api/posts.mjs";

// D1 mock: routes are { sql: RegExp, result? , rows?, runMeta? }. prepare() picks
// the first route whose regex matches the SQL (last route is the fallback).
// `result` is a row, or a function of the bind values for value-dependent lookups
// (postById fetches different posts by bound id).
function mockDb(routes, { batchMeta = null, throwOnSql = null, batchResult = null } = {}) {
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
      if (throwOnSql && statements.some((statement) => throwOnSql.test(statement.sql))) {
        throw new Error("simulated notification batch failure");
      }
      if (batchResult) {
        return statements.map((statement, index) => batchResult(statement, index));
      }
      return statements.map((statement, index) =>
        (batchMeta && batchMeta[index]) || { meta: { changes: 1 } });
    },
  };
  return { db, calls, batches };
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

function successLimiter() {
  return { async limit() { return { success: true }; } };
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
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

async function route(request, env) {
  return forumWorker.fetch(request, env);
}

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

function assertRecentSeconds(value) {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(typeof value, "number");
  assert.ok(Math.abs(value - now) < 30, "timestamp should be seconds since epoch");
}

const sessionRoute = { sql: /FROM sessions s LEFT JOIN users u/, result: signedInSessionRow() };
const banCheckRoute = { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null };

// Threaded-reply reply-flow routes: postById binds (viewerId, postId), so the
// row is chosen by the second bound value.
function threadRoutes(rowForId) {
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

test("threaded reply insert requires a public target that is a root or has a public root parent, plus an unbanned author", () => {
  assert.ok(THREAD_REPLY_INSERT_SQL.includes(
    "INSERT INTO posts (author_id, parent_id, body, visibility, created_at, last_activity_at)",
  ));
  assert.ok(THREAD_REPLY_INSERT_SQL.includes("SELECT ?, ?, ?, 'public', ?, ? WHERE EXISTS"));
  assert.ok(THREAD_REPLY_INSERT_SQL.includes("FROM posts WHERE id = ? AND visibility = 'public' AND ("));
  assert.ok(THREAD_REPLY_INSERT_SQL.includes("parent_id IS NULL OR EXISTS"));
  assert.ok(THREAD_REPLY_INSERT_SQL.includes(
    "SELECT 1 FROM posts root WHERE root.id = posts.parent_id AND root.parent_id IS NULL " +
      "AND root.visibility = 'public'",
  ));
  assert.ok(THREAD_REPLY_INSERT_SQL.includes("NOT EXISTS (SELECT 1 FROM bans WHERE user_id = ?"));
  assert.ok(THREAD_REPLY_INSERT_SQL.includes("expires_at IS NULL OR expires_at > ?"));
  // Bind order: author, parent, body, created, last_activity, target, ban user, ban now.
  assert.equal((THREAD_REPLY_INSERT_SQL.match(/\?/g) || []).length, 8);
});

test("the reply bump updates one row's activity stamp", () => {
  assert.match(REPLY_BUMP_SQL, /^UPDATE posts SET last_activity_at = \? WHERE id = \?$/);
});

test("replies to a level-1 reply insert under the guard and bump the root, not the reply", async () => {
  // root 1 <- level-1 reply 2 (author 5). Signed-in user 7 replies to 2.
  const root = postRow({ id: "1", author_id: "3", parent_id: null });
  const level1 = postRow({
    id: "2",
    author_id: "5",
    parent_id: "1",
    body: "level one",
    parent_body: "root body",
  });
  const mock = mockDb(threadRoutes((id) => (id === 1 ? root : id === 2 ? level1 : null)), {
    batchMeta: [{ meta: { changes: 1, last_row_id: 500 } }],
  });
  const siteverify = withMockedSiteverify({ success: true, action: "reply", hostname: "forum.example" });
  let response;
  try {
    response = await route(
      requestFor("https://forum.example/api/posts/2/replies", "POST", {
        body: "a threaded reply",
        "cf-turnstile-response": "turnstile-token-fixture",
      }),
      envFor(mock.db),
    );
  } finally {
    siteverify.done();
  }

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: 500 });

  // First batch: guarded reply insert + root bump. Second batch: notifications.
  assert.equal(mock.batches.length, 2);
  const [replyInsert, bump] = mock.batches[0];
  assert.equal(replyInsert.sql, THREAD_REPLY_INSERT_SQL);
  assert.deepEqual(replyInsert.values.slice(0, 3), [7, 2, "a threaded reply"]);
  assertRecentSeconds(replyInsert.values[3]);
  assert.equal(replyInsert.values[4], replyInsert.values[3]);
  assert.equal(replyInsert.values[5], 2, "guard checks the level-1 target being replied to");
  assert.equal(replyInsert.values[6], 7);
  assert.equal(replyInsert.values[7], replyInsert.values[3]);

  assert.match(bump.sql, /^UPDATE posts SET last_activity_at = \? WHERE id = \?$/);
  assert.equal(bump.values[0], replyInsert.values[3]);
  assert.equal(bump.values[1], 1, "bump must target the root (target.parent_id), not the target reply");
  assert.notEqual(bump.values[1], 2);
  assert.notEqual(bump.values[1], 500);

  const [insert, prune] = mock.batches[1];
  assert.match(insert.sql, /INSERT INTO notifications/);
  assert.deepEqual(insert.values, [5, 2, 500, replyInsert.values[3], 5, 500]);
  assert.match(prune.sql, /DELETE FROM notifications/);
  assert.deepEqual(prune.values, [5, 5]);
});

test("replies to a root insert onto the root and notify the root author", async () => {
  const root = postRow({ id: "1", author_id: "3", parent_id: null });
  const mock = mockDb(threadRoutes((id) => (id === 1 ? root : null)), {
    batchMeta: [{ meta: { changes: 1, last_row_id: 600 } }],
  });
  const siteverify = withMockedSiteverify({ success: true, action: "reply", hostname: "forum.example" });
  let response;
  try {
    response = await route(
      requestFor("https://forum.example/api/posts/1/replies", "POST", {
        body: "a root reply",
        "cf-turnstile-response": "turnstile-token-fixture",
      }),
      envFor(mock.db),
    );
  } finally {
    siteverify.done();
  }

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: 600 });
  assert.equal(mock.batches.length, 2);
  const [replyInsert, bump] = mock.batches[0];
  assert.deepEqual(replyInsert.values.slice(0, 3), [7, 1, "a root reply"]);
  assert.equal(replyInsert.values[5], 1, "guard checks the root target itself");
  assert.equal(bump.values[1], 1, "bumping a root targets the root row itself");
  const [insert] = mock.batches[1];
  assert.deepEqual(insert.values, [3, 1, 600, replyInsert.values[3], 3, 600]);
});

test("replies to a level-2 reply are refused and never touch the database write path", async () => {
  // root 1 <- level-1 reply 2 <- level-2 reply 3 (author 8).
  const level1 = postRow({ id: "2", author_id: "5", parent_id: "1", body: "level one" });
  const level2 = postRow({
    id: "3",
    author_id: "8",
    parent_id: "2",
    body: "level two",
    parent_body: "level one",
    last_activity_at: null,
  });
  const mock = mockDb(threadRoutes((id) => (id === 2 ? level1 : id === 3 ? level2 : null)));
  const siteverify = withMockedSiteverify({ success: true, action: "reply", hostname: "forum.example" });
  let response;
  try {
    response = await route(
      requestFor("https://forum.example/api/posts/3/replies", "POST", {
        body: "too deep",
        "cf-turnstile-response": "turnstile-token-fixture",
      }),
      envFor(mock.db),
    );
  } finally {
    siteverify.done();
  }

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Replies only go one level deep." });
  assert.equal(mock.batches.length, 0);
  assert.equal(siteverify.seen.length, 0, "the depth guard must reject before Turnstile redeems a token");
});

test("a failing notification batch never fails the reply", async () => {
  const root = postRow({ id: "1", author_id: "3", parent_id: null });
  const level1 = postRow({ id: "2", author_id: "5", parent_id: "1", body: "level one" });
  const mock = mockDb(threadRoutes((id) => (id === 1 ? root : id === 2 ? level1 : null)), {
    batchMeta: [{ meta: { changes: 1, last_row_id: 500 } }],
    throwOnSql: /INSERT INTO notifications/,
  });
  const siteverify = withMockedSiteverify({ success: true, action: "reply", hostname: "forum.example" });
  let response;
  try {
    response = await route(
      requestFor("https://forum.example/api/posts/2/replies", "POST", {
        body: "notifications must not block replies",
        "cf-turnstile-response": "turnstile-token-fixture",
      }),
      envFor(mock.db),
    );
  } finally {
    siteverify.done();
  }

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: 500 });
  assert.equal(mock.batches.length, 2);
});

test("reply creation requires a valid reply Turnstile action", async () => {
  const root = postRow({ id: "1", author_id: "3", parent_id: null });
  const mock = mockDb(threadRoutes((id) => (id === 1 ? root : null)));
  const siteverify = withMockedSiteverify({ success: true, action: "post", hostname: "forum.example" });
  let response;
  try {
    response = await route(
      requestFor("https://forum.example/api/posts/1/replies", "POST", {
        body: "rejected action",
        "cf-turnstile-response": "turnstile-token-fixture",
      }),
      envFor(mock.db),
    );
  } finally {
    siteverify.done();
  }

  assert.equal(response.status, 403);
  assert.equal(mock.batches.length, 0);
  // Wrong action (redeemed token) or missing token both fail closed.
  const noTokenMock = mockDb([
    sessionRoute,
    banCheckRoute,
    { sql: /WHERE p\.id = \? LIMIT 1/, result: (values) => (values[1] === 1 ? root : null) },
    { sql: /./ },
  ]);
  const noTokenResponse = await route(
    requestFor("https://forum.example/api/posts/1/replies", "POST", { body: "no token" }),
    envFor(noTokenMock.db),
  );
  assert.equal(noTokenResponse.status, 403);
  assert.equal(noTokenMock.batches.length, 0);
});

test("new root posts stamp last_activity_at equal to created_at", async () => {
  const mock = mockDb([
    sessionRoute,
    banCheckRoute,
    {
      sql: /INSERT INTO posts \(author_id, parent_id, body, visibility, created_at, last_activity_at\)/,
      runMeta: { meta: { changes: 1, last_row_id: 42 } },
    },
    { sql: /./ },
  ]);
  const siteverify = withMockedSiteverify({ success: true, action: "post", hostname: "forum.example" });
  let response;
  try {
    response = await route(
      requestFor("https://forum.example/api/posts", "POST", {
        body: "a brand new root",
        "cf-turnstile-response": "turnstile-token-fixture",
      }),
      envFor(mock.db),
    );
  } finally {
    siteverify.done();
  }

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: 42 });
  const insert = mock.calls.find((call) => call.sql.startsWith("INSERT INTO posts"));
  assert.ok(insert, "post creation must run its guarded INSERT");
  assert.ok(insert.sql.includes(
    "INSERT INTO posts (author_id, parent_id, body, visibility, created_at, last_activity_at)",
  ));
  assert.ok(insert.sql.includes("SELECT ?, NULL, ?, 'public', ?, ? WHERE NOT EXISTS"));
  assert.deepEqual(insert.values.slice(0, 2), [7, "a brand new root"]);
  assertRecentSeconds(insert.values[2]);
  assert.equal(insert.values[3], insert.values[2], "last_activity_at binds the same timestamp as created_at");
});

test("the activity feed uses the composite keyset and both cursor parts must be integers", async () => {
  const feedRoutes = (rows) => [
    { sql: /FROM posts p JOIN users u/, rows },
    { sql: /./ },
  ];
  const dbRows = [];
  for (let i = 0; i < 21; i++) {
    dbRows.push(postRow({
      id: String(100 - i),
      author_id: "3",
      created_at: 1700000000 + i,
      last_activity_at: 1700100100 - i,
    }));
  }
  const pageOne = mockDb(feedRoutes(dbRows));
  const pageOneResponse = await route(
    new Request("https://forum.example/api/posts", {
      headers: { "CF-Connecting-IP": "192.0.2.9" },
    }),
    envFor(pageOne.db),
  );

  assert.equal(pageOneResponse.status, 200);
  const pageOneBody = await pageOneResponse.json();
  assert.equal(pageOneBody.posts.length, 20);
  assert.equal(typeof pageOneBody.posts[0].lastActivityAt, "string");
  assert.equal(
    pageOneBody.posts[0].lastActivityAt,
    new Date(1700100100 * 1000).toISOString(),
  );
  assert.match(pageOne.calls[0].sql, /ORDER BY p\.last_activity_at DESC, p\.id DESC LIMIT 21/);
  assert.deepEqual(pageOne.calls[0].values, [-1]);
  // hasMore (21 rows) emits the 20th shown row as composite seconds_id cursor.
  assert.equal(pageOneBody.nextBefore, "1700100081_81");
});

test("cursor-driven feed pages walk the composite key", async () => {
  const feedRoutes = (rows) => [
    { sql: /FROM posts p JOIN users u/, rows },
    { sql: /./ },
  ];
  const rows = [];
  for (let i = 0; i < 4; i++) {
    rows.push(postRow({
      id: String(80 - i),
      created_at: 1700000000 + i,
      last_activity_at: 1700100080 - i,
    }));
  }
  const mock = mockDb(feedRoutes(rows));
  const response = await route(
    new Request("https://forum.example/api/posts?before=1700100080_80", {
      headers: { "CF-Connecting-IP": "192.0.2.9" },
    }),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.posts.length, 4);
  assert.match(mock.calls[0].sql,
    /AND \(p\.last_activity_at < \? OR \(p\.last_activity_at = \? AND p\.id < \?\)\) /);
  assert.match(mock.calls[0].sql, /ORDER BY p\.last_activity_at DESC, p\.id DESC LIMIT 21/);
  assert.deepEqual(mock.calls[0].values, [-1, 1700100080, 1700100080, 80]);
  assert.equal(body.nextBefore, null);

  for (const invalid of ["12", "1_2_3", "x_2", "1_x", "1_2x", "-1_2", "", "99999999999_1", "1_99999999999"]) {
    const rejected = mockDb(feedRoutes([]));
    const failResponse = await route(
      new Request("https://forum.example/api/posts?before=" + encodeURIComponent(invalid), {
        headers: { "CF-Connecting-IP": "192.0.2.9" },
      }),
      envFor(rejected.db),
    );
    assert.equal(failResponse.status, 400, "cursor " + JSON.stringify(invalid) + " must be rejected");
    assert.deepEqual(await failResponse.json(), { error: "That page cursor is invalid." });
    assert.equal(rejected.calls.filter((c) => c.sql.includes("FROM posts p JOIN")).length, 0,
      "no feed query may run for an invalid cursor");
  }
});

test("equal last_activity_at across a page boundary skips or duplicates no rows", async () => {
  // Every root shares one activity second: the id half of the composite key is
  // the only tiebreaker, so the cursor must carry the last shown row's id.
  const tiedRows = [];
  for (let i = 0; i < 21; i++) {
    tiedRows.push(postRow({
      id: String(100 - i),
      created_at: 1700000000 + i,
      last_activity_at: 1700100090,
    }));
  }
  const pageOne = mockDb([{ sql: /FROM posts p JOIN users u/, rows: tiedRows }, { sql: /./ }]);
  const pageOneResponse = await route(
    new Request("https://forum.example/api/posts", { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(pageOne.db),
  );
  assert.equal(pageOneResponse.status, 200);
  const pageOneBody = await pageOneResponse.json();
  assert.equal(pageOneBody.posts.length, 20);
  assert.equal(pageOneBody.nextBefore, "1700100090_81",
    "the cursor must carry the last SHOWN row's id at a shared timestamp");

  // Page two starts strictly below (activity, id) = (1700100090, 81): the
  // boundary rows 81+ can neither repeat (keyset excludes them) nor hide the
  // tie-break continuation (id < 81 at the same second is still matched).
  const pageTwo = mockDb([{ sql: /FROM posts p JOIN users u/, rows: tiedRows.slice(20) }, { sql: /./ }]);
  const pageTwoResponse = await route(
    new Request("https://forum.example/api/posts?before=" + pageOneBody.nextBefore, {
      headers: { "CF-Connecting-IP": "192.0.2.9" },
    }),
    envFor(pageTwo.db),
  );
  assert.equal(pageTwoResponse.status, 200);
  const pageTwoBody = await pageTwoResponse.json();
  assert.match(pageTwo.calls[0].sql,
    /AND \(p\.last_activity_at < \? OR \(p\.last_activity_at = \? AND p\.id < \?\)\) /);
  assert.deepEqual(pageTwo.calls[0].values, [-1, 1700100090, 1700100090, 81]);
  const pageTwoIds = pageTwoBody.posts.map((post) => post.id);
  assert.deepEqual(pageTwoIds, [80]);
  assert.deepEqual(
    pageOneBody.posts.map((post) => post.id).filter((id) => pageTwoIds.includes(id)),
    [],
    "no row may repeat across the page turn",
  );
});

test("search keeps id-DESC ordering and never orders by activity by default", async () => {
  const checks = [
    [{}, {}],
    [{ searchTerm: "wempo" }, { rows: [] }],
    [{ authorId: 5 }, { rows: [] }],
  ];
  for (const [options, extra] of checks) {
    const mock = mockDb([{ sql: /FROM posts p JOIN users u/, rows: [] }, { sql: /./, rows: [] }, { sql: /./ }]);
    await listRootPosts({ FORUM_DB: mock.db }, null, options);
    assert.match(mock.calls[0].sql, /ORDER BY p\.id DESC LIMIT 21/);
    assert.equal(mock.calls[0].sql.includes("ORDER BY p.last_activity_at"), false);
  }
  const rows = Array.from({ length: 21 }, (_, i) => postRow({
    id: String(900 - i),
    created_at: 1700000000 + i,
    last_activity_at: 1700000000 + i,
  }));
  const mock = mockDb([{ sql: /FROM posts p JOIN users u/, rows }, { sql: /./ }]);
  const feed = await listRootPosts({ FORUM_DB: mock.db }, null, {
    byActivity: true,
    before: { seconds: 1700000000, id: 1 },
  });
  assert.match(mock.calls[0].sql, /ORDER BY p\.last_activity_at DESC, p\.id DESC LIMIT 21/);
  assert.match(mock.calls[0].sql, /AND \(p\.last_activity_at < \? OR \(p\.last_activity_at = \? AND p\.id < \?\)\)/);
  assert.deepEqual(mock.calls[0].values, [-1, 1700000000, 1700000000, 1]);
  assert.equal(feed.nextBefore, "1700000019_881", "activity cursors are composite seconds_id strings");
});

test("post detail exposes subReplyCount per level-1 reply obeying viewer visibility", async () => {
  // Guest viewer: only public sub-replies are counted.
  const root = postRow({ id: "1", last_activity_at: 1700000005 });
  const reply10 = postRow({ id: "10", author_id: "5", parent_id: "1", body: "first reply", last_activity_at: null });
  const reply11 = postRow({ id: "11", author_id: "9", parent_id: "1", body: "second reply", last_activity_at: null });
  const mock = mockDb([
    {
      sql: /WHERE p\.id = \? LIMIT 1/,
      result: (values) => (values[1] === 1 ? root : null),
    },
    {
      sql: /WHERE p\.parent_id = \?/,
      // listReplies reverses what D1 returns (ORDER BY p.id DESC), so supply
      // fixture rows in D1's descending order.
      rows: [reply11, reply10],
    },
    { sql: /./ },
  ], {
    batchResult: (statement) => ({
      results: [{ sub_reply_count: statement.values[0] === 10 ? 3 : 0 }],
    }),
  });
  const response = await route(
    new Request("https://forum.example/api/posts/1", { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.lastActivityAt, new Date(1700000005 * 1000).toISOString());
  assert.equal(body.replies.length, 2);
  assert.equal(body.replies[0].subReplyCount, 3);
  assert.equal(body.replies[1].subReplyCount, 0);
  // All per-reply counts go out as ONE batched subrequest, nothing separately.
  assert.equal(mock.batches.length, 1, "sub-reply counts must use exactly one D1 batch");
  assert.equal(mock.batches[0].length, 2);
  assert.deepEqual(mock.batches[0].map((statement) => statement.values), [[10, -1], [11, -1]]);
  const asCall = (statement) => ({ sql: statement.sql, values: statement.values });
  assert.deepEqual(
    mock.calls.filter((call) => call.sql.includes("AS sub_reply_count")).map(asCall),
    mock.batches[0].map(asCall),
    "no count may run outside the single batch",
  );
});

test("a level-1 reply's detail has no activity stamp and the same visibility machinery", async () => {
  const level1 = postRow({
    id: "10",
    author_id: "5",
    parent_id: "1",
    body: "level one",
    parent_body: "root body",
    last_activity_at: null,
  });
  const mock = mockDb([
    { sql: /WHERE p\.id = \? LIMIT 1/, result: (values) => (values[1] === 10 ? level1 : null) },
    {
      sql: /FROM posts WHERE id = \? LIMIT 1/,
      result: { id: 1, author_id: 3, visibility: "public", parent_id: null },
    },
    { sql: /WHERE p\.parent_id = \?/, rows: [] },
    { sql: /./, result: { sub_reply_count: 0 } },
  ]);
  const response = await route(
    new Request("https://forum.example/api/posts/10", { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.lastActivityAt, null);
  assert.deepEqual(body.replies, []);
  assert.equal(mock.batches.length, 0, "no count batch may run when there are no replies");
});

function ancestorEnv(rowsById) {
  return {
    FORUM_DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return {
              async first() {
                return rowsById[values[0]] === undefined ? null : rowsById[values[0]];
              },
            };
          },
        };
      },
    },
  };
}

test("level-2 replies are visible only when their parent and root are viewable", async () => {
  const hiddenRoot = ancestorEnv({
    2: { id: 2, author_id: 9, visibility: "public", parent_id: 1 },
    1: { id: 1, author_id: 7, visibility: "hidden", parent_id: null },
  });
  const level2 = { id: 3, author_id: 8, parent_id: 2, visibility: "public" };
  // Ancestor author/admin rules are unchanged: the reply's own author (8) is
  // not exempt from a hidden ancestor, mirroring the level-1 parent rule.
  assert.equal(await canViewPost(hiddenRoot, level2, { id: 44, role: "member" }), false);
  assert.equal(await canViewPost(hiddenRoot, level2, { id: 8, role: "member" }), false);
  assert.equal(await canViewPost(hiddenRoot, level2, { id: 7, role: "member" }), true);
  assert.equal(await canViewPost(hiddenRoot, level2, { id: 44, role: "admin" }), true);

  const visibleChain = ancestorEnv({
    2: { id: 2, author_id: 9, visibility: "public", parent_id: 1 },
    1: { id: 1, author_id: 7, visibility: "public", parent_id: null },
  });
  assert.equal(await canViewPost(visibleChain, level2, null), true);
  assert.equal(await canViewPost(visibleChain, level2, { id: 44, role: "member" }), true);
});

test("level-2 replies never reveal a hidden parent to unrelated members", async () => {
  const hiddenParent = ancestorEnv({
    2: { id: 2, author_id: 9, visibility: "hidden", parent_id: 1 },
    1: { id: 1, author_id: 7, visibility: "public", parent_id: null },
  });
  const level2 = { id: 3, author_id: 8, parent_id: 2, visibility: "public" };
  assert.equal(await canViewPost(hiddenParent, level2, null), false);
  assert.equal(await canViewPost(hiddenParent, level2, { id: 44, role: "member" }), false);
  assert.equal(await canViewPost(hiddenParent, level2, { id: 9, role: "member" }), true);
  assert.equal(await canViewPost(hiddenParent, level2, { id: 44, role: "admin" }), true);
});

test("missing ancestors make a reply invisible", async () => {
  const orphan = ancestorEnv({});
  const level2 = { id: 3, author_id: 8, parent_id: 2, visibility: "public" };
  assert.equal(await canViewPost(orphan, level2, null), false);
  assert.equal(await canViewPost(orphan, level2, { id: 44, role: "admin" }), false);
});