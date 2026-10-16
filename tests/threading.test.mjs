import test from "node:test";
import assert from "node:assert/strict";
import forumWorker, { canViewPost } from "../worker.mjs";
import { THREAD_REPLY_INSERT_SQL, THREAD_REPLY_INSERT_STAGED_SQL, REPLY_BUMP_SQL, STAGED_REPLY_BUMP_SQL } from "../constants.mjs";
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
// canViewPost's active-ban check (v2.4.1) is a distinct query; tests must
// route it explicitly to "no active ban" so generic fallbacks with truthy
// results cannot masquerade as one.
const banViewRouteOff = { sql: /SELECT 1 FROM bans b WHERE b\.user_id = \?/, result: null };

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
    // canViewPost (v2.4.1) also resolves ancestors by id and checks bans.
    { sql: /FROM posts WHERE id = \? LIMIT 1/, result: (values) => rowForId(values[0]) },
    banViewRouteOff,
    { sql: /./ },
  ];
}

test("threaded reply insert requires a public target that is a root or has a public root parent, plus an unbanned author", () => {
  assert.ok(THREAD_REPLY_INSERT_SQL.includes(
    "INSERT INTO posts (author_id, parent_id, body, visibility, created_at, last_activity_at, board, idempotency_key, idempotency_fingerprint, staged_at)",
  ));
  assert.ok(THREAD_REPLY_INSERT_SQL.includes("SELECT ?, ?, ?, 'public', ?, ?, ?, ?, ?, ? WHERE EXISTS"));
  assert.ok(THREAD_REPLY_INSERT_SQL.includes("FROM posts WHERE id = ? AND visibility = 'public' AND ("));
  assert.ok(THREAD_REPLY_INSERT_SQL.includes("parent_id IS NULL OR EXISTS"));
  assert.ok(THREAD_REPLY_INSERT_SQL.includes(
    "SELECT 1 FROM posts root WHERE root.id = posts.parent_id AND root.parent_id IS NULL " +
      "AND root.visibility = 'public'",
  ));
  assert.ok(THREAD_REPLY_INSERT_SQL.includes("NOT EXISTS (SELECT 1 FROM bans WHERE user_id = ?"));
  assert.ok(THREAD_REPLY_INSERT_SQL.includes("expires_at IS NULL OR expires_at > ?"));
  // Bind order: author, parent, body, created, last_activity, root board,
  // idempotency key, fingerprint, staged_at, target, ban user, ban time.
  assert.ok(THREAD_REPLY_INSERT_SQL.includes("FROM post_archive archived"));
  assert.equal((THREAD_REPLY_INSERT_SQL.match(/\?/g) || []).length, 15);
});

test("the reply bump updates one row's activity stamp", () => {
  assert.match(REPLY_BUMP_SQL, /last_activity_at = MAX\(COALESCE\(last_activity_at, 0\), \?\)/);
  assert.match(STAGED_REPLY_BUMP_SQL, /reply\.id = \? AND reply\.visibility = 'public'/);
  assert.match(STAGED_REPLY_BUMP_SQL, /reply\.parent_id = posts\.id OR target\.parent_id = posts\.id/);
});
test("staged reply insertion accepts a bound hidden visibility without weakening the thread guard", () => {
  assert.match(THREAD_REPLY_INSERT_STAGED_SQL, /SELECT \?, \?, \?, \?, \?, \?, \?, \?, \?, \? WHERE EXISTS/);
  assert.match(THREAD_REPLY_INSERT_STAGED_SQL, /FROM posts WHERE id = \? AND visibility = 'public'/);
  assert.match(THREAD_REPLY_INSERT_STAGED_SQL, /parent_id IS NULL OR EXISTS/);
  assert.match(THREAD_REPLY_INSERT_STAGED_SQL, /NOT EXISTS \(SELECT 1 FROM bans WHERE user_id = \?/);
  assert.equal((THREAD_REPLY_INSERT_STAGED_SQL.match(/\?/g) || []).length, 16);
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
  // Board and shifted guard binds are pinned below, after the bump assertions.

  assert.match(bump.sql, /last_activity_at = MAX\(COALESCE\(last_activity_at, 0\), \?\)/);
  assert.match(bump.sql, /reply\.visibility = 'public'/);
  assert.equal(bump.values[0], replyInsert.values[3]);
  assert.equal(bump.values[1], 1, "bump must target the root (target.parent_id), not the target reply");
  assert.notEqual(bump.values[1], 2);
  assert.notEqual(bump.values[1], 500);

  // Board inherits the thread root's board (v2.4.1): the root is 'general'
  // here, and the shifted guard binds follow it (target 2, user 7, now).
  assert.equal(replyInsert.values[5], "general", "replies carry their root's board");
  assert.equal(replyInsert.values[6], null, "idempotency key is null when a client does not supply one");
  assert.equal(replyInsert.values[7], null, "fingerprint is null without an idempotency key");
  assert.equal(replyInsert.values[8], null, "ordinary replies are not marked as staged");
  assert.equal(replyInsert.values[9], 2, "guard checks the level-1 target being replied to");
  assert.equal(replyInsert.values[10], 7);
  assert.equal(replyInsert.values[11], replyInsert.values[3]);

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
  assert.equal(replyInsert.values[9], 1, "guard checks the root target itself");
  assert.equal(replyInsert.values[5], "general", "a root replying target carries the general board");
  assert.equal(bump.values[1], 1, "bumping a root targets the root row itself");
  const [insert] = mock.batches[1];
  assert.deepEqual(insert.values, [3, 1, 600, replyInsert.values[3], 3, 600]);
});

test("replies to a level-2 reply are refused and never touch the database write path", async () => {
  // root 1 <- level-1 reply 2 <- level-2 reply 3 (author 8).
  const root = postRow({ id: "1", author_id: "3", parent_id: null });
  const level1 = postRow({ id: "2", author_id: "5", parent_id: "1", body: "level one" });
  const level2 = postRow({
    id: "3",
    author_id: "8",
    parent_id: "2",
    body: "level two",
    parent_body: "level one",
    last_activity_at: null,
  });
  const mock = mockDb(threadRoutes((id) => (id === 1 ? root : id === 2 ? level1 : id === 3 ? level2 : null)));
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
      sql: /INSERT INTO posts \(author_id, parent_id, body, visibility, created_at, last_activity_at, board, idempotency_key, idempotency_fingerprint, staged_at\)/,
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
    "INSERT INTO posts (author_id, parent_id, body, visibility, created_at, last_activity_at, board, idempotency_key, idempotency_fingerprint, staged_at)",
  ));
  assert.ok(insert.sql.includes("SELECT ?, NULL, ?, 'public', ?, ?, ?, ?, ?, ? WHERE NOT EXISTS"));
  assert.ok(insert.sql.includes("FROM post_archive archived"), "root creation is fenced by the archive at insert time");
  assert.deepEqual(insert.values.slice(0, 2), [7, "a brand new root"]);
  assertRecentSeconds(insert.values[2]);
  assert.equal(insert.values[3], insert.values[2], "last_activity_at binds the same timestamp as created_at");
  // No board field submitted: the root defaults to the general board.
  assert.equal(insert.values[4], "general");
  assert.deepEqual(insert.values.slice(5), [null, null, null, 7, insert.values[2], null, 7, null],
    "the ban guard and null-key archive guard bind after the idempotency fields");
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
  assert.match(pageOne.calls[0].sql, /ORDER BY \(p\.pinned_at IS NULL\) ASC, p\.last_activity_at DESC, p\.id DESC LIMIT 21/);
  assert.deepEqual(pageOne.calls[0].values, [-1]);
  // hasMore (21 rows) emits the 20th shown row as composite seconds_id cursor.
  assert.equal(pageOneBody.nextBefore, "1_1700100081_81");
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
  assert.match(mock.calls[0].sql, /ORDER BY \(p\.pinned_at IS NULL\) ASC, p\.last_activity_at DESC, p\.id DESC LIMIT 21/);
  assert.deepEqual(mock.calls[0].values, [-1, 1700100080, 1700100080, 80]);
  assert.equal(body.nextBefore, null);

  for (const invalid of ["12", "2_2_3", "1_2_3_4", "x_2", "1_x", "1_2x", "-1_2", "", "99999999999_1", "1_99999999999"]) {
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
  assert.equal(pageOneBody.nextBefore, "1_1700100090_81",
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
  assert.match(mock.calls[0].sql, /ORDER BY \(p\.pinned_at IS NULL\) ASC, p\.last_activity_at DESC, p\.id DESC LIMIT 21/);
  assert.match(mock.calls[0].sql, /AND \(p\.last_activity_at < \? OR \(p\.last_activity_at = \? AND p\.id < \?\)\)/);
  assert.deepEqual(mock.calls[0].values, [-1, 1700000000, 1700000000, 1]);
  assert.equal(feed.nextBefore, "1_1700000019_881", "activity cursors are composite seconds_id strings");
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
    banViewRouteOff,
    {
      sql: /FROM posts WHERE id = \? LIMIT 1/,
      result: { id: 1, author_id: 3, visibility: "public", parent_id: null },
    },
    banViewRouteOff,
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
                // canViewPost's active-ban check (v2.4.1) binds an author id;
                // these unit tests don't fixture bans, so it always reads
                // "no active ban" here rather than colliding with ancestor
                // rows keyed by the same numeric ids.
                if (/SELECT 1 FROM bans b WHERE b\.user_id = \?/.test(sql)) return null;
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

// publicLevel depth annotation: every publicPost payload carries publicLevel
// (0 = root, 1 = level-1 reply, 2 = level-2 reply) so the renderer can offer
// reply affordances only on explicitly level-1 rows — JSON-only, no SQL change.
test("feed, search, and profile post lists annotate roots with publicLevel 0", async () => {
  const rootRows = [postRow({ id: "1", created_at: 1700000000, last_activity_at: 1700000005 })];
  const feed = mockDb([{ sql: /FROM posts p JOIN users u/, rows: rootRows }, { sql: /./ }]);
  const feedResponse = await route(
    new Request("https://forum.example/api/posts", { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(feed.db),
  );
  assert.equal(feedResponse.status, 200);
  const feedBody = await feedResponse.json();
  assert.equal(feedBody.posts.length, 1);
  assert.equal(feedBody.posts[0].publicLevel, 0, "feed posts are roots");

  const search = mockDb([
    { sql: /FROM posts p JOIN users u/, rows: rootRows },
    { sql: /FROM users u/, rows: [] },
    { sql: /./ },
  ]);
  const searchResponse = await route(
    new Request("https://forum.example/api/search?q=wempo", {
      headers: { "CF-Connecting-IP": "192.0.2.9" },
    }),
    envFor(search.db),
  );
  assert.equal(searchResponse.status, 200);
  const searchBody = await searchResponse.json();
  assert.equal(searchBody.posts.length, 1);
  assert.equal(searchBody.posts[0].publicLevel, 0, "search results are roots");

  // profiles.mjs reuses listRootPosts for an author's post list; the shared
  // annotation must already mark those rows as roots too.
  const profile = [];
  for (let i = 0; i < 3; i++) profile.push(postRow({ id: String(9 - i), parent_id: null }));
  const profileMock = mockDb([{ sql: /FROM posts p JOIN users u/, rows: profile }, { sql: /./ }]);
  const profileList = await listRootPosts({ FORUM_DB: profileMock.db }, null, { authorId: 5 });
  assert.deepEqual(
    profileList.posts.map((post) => post.publicLevel),
    [0, 0, 0],
    "profile post lists are roots",
  );
});

test("detail replies carry publicLevel 1 and level-1 children carry publicLevel 2", async () => {
  // root 1 <- level-1 reply 10 <- level-2 reply 20.
  const root = postRow({ id: "1", parent_id: null, created_at: 1700000000, last_activity_at: 1700000005 });
  const level1 = postRow({
    id: "10",
    author_id: "5",
    parent_id: "1",
    body: "level one",
    parent_body: "root body",
    last_activity_at: null,
  });
  const level2 = postRow({
    id: "20",
    author_id: "8",
    parent_id: "10",
    body: "level two",
    parent_body: "level one",
    last_activity_at: null,
  });

  // Detail of the root: each direct reply is a level-1 row.
  const detailMock = mockDb([
    { sql: /WHERE p\.id = \? LIMIT 1/, result: (values) => (values[1] === 1 ? root : null) },
    { sql: /WHERE p\.parent_id = \?/, rows: [level1] },
    { sql: /./ },
  ], { batchResult: () => ({ results: [{ sub_reply_count: 1 }] }) });
  const detailResponse = await route(
    new Request("https://forum.example/api/posts/1", { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(detailMock.db),
  );
  assert.equal(detailResponse.status, 200);
  const detailBody = await detailResponse.json();
  assert.equal(detailBody.publicLevel, 0, "the detail post itself is a root here");
  assert.equal(detailBody.replies[0].id, 10);
  assert.equal(detailBody.replies[0].publicLevel, 1, "direct replies of a root are level-1");

  // GET /api/posts/:level1Id/replies returns the level-2 children of reply 10.
  const childMock = mockDb([
    { sql: /WHERE p\.id = \? LIMIT 1/, result: (values) => (values[1] === 10 ? level1 : null) },
    { sql: /FROM posts WHERE id = \? LIMIT 1/, result: { id: 1, author_id: 3, visibility: "public", parent_id: null } },
    { sql: /WHERE p\.parent_id = \?/, rows: [level2] },
    { sql: /./ },
  ]);
  const childResponse = await route(
    new Request("https://forum.example/api/posts/10/replies", {
      headers: { "CF-Connecting-IP": "192.0.2.9" },
    }),
    envFor(childMock.db),
  );
  assert.equal(childResponse.status, 200);
  const childBody = await childResponse.json();
  assert.equal(childBody.replies.length, 1);
  assert.equal(childBody.replies[0].id, 20);
  assert.equal(childBody.replies[0].publicLevel, 2, "children of a level-1 reply are level-2");
});

test("the replies page carries batched subReplyCounts per level-1 reply like the detail route", async () => {
  // Guest viewer of GET /api/posts/1/replies where 1 is a root: its direct
  // replies (10, 11) are level-1 rows and need counts; only public sub-replies
  // count for guests.
  const root = postRow({ id: "1", parent_id: null, last_activity_at: 1700000005 });
  const reply10 = postRow({
    id: "10", author_id: "5", parent_id: "1", body: "first",
    parent_body: "root body", last_activity_at: null,
  });
  const reply11 = postRow({ id: "11", author_id: "9", parent_id: "1", body: "second", last_activity_at: null });
  const mock = mockDb([
    { sql: /WHERE p\.id = \? LIMIT 1/, result: (values) => (values[1] === 1 ? root : null) },
    { sql: /WHERE p\.parent_id = \?/, rows: [reply11, reply10] },
    { sql: /./ },
  ], {
    batchResult: (statement) => ({
      results: [{ sub_reply_count: statement.values[0] === 10 ? 2 : 0 }],
    }),
  });
  const response = await route(
    new Request("https://forum.example/api/posts/1/replies", {
      headers: { "CF-Connecting-IP": "192.0.2.9" },
    }),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.replies.length, 2);
  assert.deepEqual(
    body.replies.map((reply) => [reply.id, reply.publicLevel, reply.subReplyCount]),
    [[10, 1, 2], [11, 1, 0]],
  );
  assert.equal(body.nextBefore, null);
  // One batched subrequest; per-row guest visibility semantics match detail.
  assert.equal(mock.batches.length, 1, "sub-reply counts must use exactly one D1 batch");
  assert.equal(mock.batches[0].length, 2);
  assert.deepEqual(mock.batches[0].map((statement) => statement.values), [[10, -1], [11, -1]]);
  const asCall = (statement) => ({ sql: statement.sql, values: statement.values });
  assert.deepEqual(
    mock.calls.filter((call) => call.sql.includes("AS sub_reply_count")).map(asCall),
    mock.batches[0].map(asCall),
    "no count may run outside the single batch",
  );
  // Shapes match the detail route's rows: spread preserves publicLevel/parent.
  assert.equal(body.replies[0].parent.body, "root body");
});

test("the replies page skips count batches entirely for level-2 rows", async () => {
  // Target 10 is itself a level-1 reply: its children are level-2 rows that
  // can never be replied to, so no counts (and no batch) may run.
  const level1 = postRow({
    id: "10", author_id: "5", parent_id: "1",
    body: "level one", parent_body: "root body", last_activity_at: null,
  });
  const level2 = postRow({
    id: "20", author_id: "8", parent_id: "10",
    body: "level two", parent_body: "level one", last_activity_at: null,
  });
  const mock = mockDb([
    { sql: /WHERE p\.id = \? LIMIT 1/, result: (values) => (values[1] === 10 ? level1 : null) },
    { sql: /FROM posts WHERE id = \? LIMIT 1/, result: { id: 1, author_id: 3, visibility: "public", parent_id: null } },
    { sql: /WHERE p\.parent_id = \?/, rows: [level2] },
    { sql: /./ },
  ]);
  const response = await route(
    new Request("https://forum.example/api/posts/10/replies", {
      headers: { "CF-Connecting-IP": "192.0.2.9" },
    }),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.replies.length, 1);
  assert.equal(body.replies[0].publicLevel, 2);
  assert.equal("subReplyCount" in body.replies[0], false, "level-2 rows need no counts");
  assert.equal(mock.batches.length, 0, "no count batch may run for level-2 rows");
});

// ---------------------------------------------------------------------------
// v2.3 feed thread presentation: batched replyCount + latestReplies decoration.
// Mirrors the withAttachments discipline — the feed SELECT and its cursor
// clauses are untouched; the two decoration queries attach after rows return,
// and the row-matching routes below key on their distinctive SQL fragments.
// ---------------------------------------------------------------------------

function feedRoutesWithReplyData({ feedRows, countRows = [], latestRows = [], session = sessionRoute }) {
  return [
    session,
    { sql: /FROM posts p JOIN users u/, rows: feedRows },
    { sql: /AS reply_count/, rows: countRows },
    { sql: /ROW_NUMBER/, rows: latestRows },
    { sql: /./ },
  ];
}

function latestRowFixture(overrides = {}) {
  return {
    id: "10",
    thread_root: "1",
    body: "level one",
    created_at: 1700000010,
    author_id: "5",
    author_username: "replyer",
    author_avatar_mime: null,
    author_avatar_version: null,
    sub_reply_count: 0,
    rn: 1,
    ...overrides,
  };
}

test("feed posts carry replyCount and the 3 most-recent latestReplies, root posts only", async () => {
  // Two roots: root 1 has 3 comments (2 level-1 replies + 1 sub-reply); root 2
  // has none. The counts/latest mocks carry what the batched queries return.
  const root1 = postRow({ id: "1", created_at: 1700000000, last_activity_at: 1700100100 });
  const root2 = postRow({ id: "2", created_at: 1700000000, last_activity_at: 1700100099 });
  const mock = mockDb(feedRoutesWithReplyData({
    feedRows: [root1, root2],
    countRows: [
      { thread_root: "1", reply_count: "3" },
      { thread_root: "2", reply_count: "0" },
    ],
    latestRows: [
      // Most recent first, as SELECTed (created_at DESC in the SQL, test-pinned
      // below together with the window ordering clause).
      latestRowFixture({
        id: "13", thread_root: "1", body: "newest reply", created_at: 1700000050,
        author_id: "5", author_username: "new_replyer", sub_reply_count: 1, rn: 1,
      }),
      latestRowFixture({
        id: "10", thread_root: "1", body: "older reply", created_at: 1700000010,
        author_id: "6", author_username: "old_replyer", author_avatar_mime: "image/png",
        author_avatar_version: "avv1", sub_reply_count: 0, rn: 2,
      }),
    ],
  }));
  const response = await route(
    new Request("https://forum.example/api/posts", { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.posts.length, 2);

  const tagged = body.posts[0];
  assert.equal(tagged.id, 1);
  assert.equal(tagged.replyCount, 3, "2 level-1 replies plus 1 sub-reply = 3 comments");
  assert.deepEqual(tagged.latestReplies.map((reply) => reply.id), [13, 10],
    "previews arrive most recent first, exactly as the SELECT returned them");
  assert.deepEqual(tagged.latestReplies[0], {
    id: 13,
    authorUsername: "new_replyer",
    avatarUrl: null,
    snippet: "newest reply",
    createdAt: new Date(1700000050 * 1000).toISOString(),
    subReplyCount: 1,
  });
  // Avatar URL convention mirrors publicPost's author fields (POST_SELECT).
  assert.equal(
    tagged.latestReplies[1].avatarUrl,
    "/api/avatars/6?v=avv1",
  );
  assert.equal(tagged.latestReplies[1].authorUsername, "old_replyer");

  // Zero-reply roots stay typed: never null, never absent.
  assert.equal(body.posts[1].replyCount, 0);
  assert.deepEqual(body.posts[1].latestReplies, []);
  assert.equal(typeof body.posts[1].replyCount, "number");
});

test("a zero-reply feed page still types replyCount 0 and latestReplies []", async () => {
  const mock = mockDb(feedRoutesWithReplyData({
    feedRows: [postRow({ id: "1", created_at: 1700000000, last_activity_at: 1700100100 })],
  }));
  const response = await route(
    new Request("https://forum.example/api/posts", { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.posts[0].replyCount, 0, "no counts row means zero, not missing");
  assert.deepEqual(body.posts[0].latestReplies, []);
  assert.ok(Array.isArray(body.posts[0].latestReplies));
});

test("hidden replies are excluded from the count and previews per viewer visibility", async () => {
  // Signed-in member 7 mirrors listReplies' guest/member visibility: only
  // public replies count, plus their own hidden ones; a level-2 reply under a
  // hidden level-1 parent is invisible too (canViewPost on the parent chain).
  // The mock returns only what a SQL obeying those rules would return; the
  // binding SQL shape is asserted below so the mock cannot mask a regression.
  const mock = mockDb(feedRoutesWithReplyData({
    feedRows: [postRow({ id: "1", created_at: 1700000000, last_activity_at: 1700100100 })],
    countRows: [{ thread_root: "1", reply_count: "2" }],
    latestRows: [
      latestRowFixture({ id: "10", author_id: "5", author_username: "visible_author" }),
    ],
  }));
  const response = await route(
    new Request("https://forum.example/api/posts", {
      headers: { "CF-Connecting-IP": "192.0.2.9", Cookie: "wempo_session=" + "s".repeat(43) },
    }),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.posts[0].replyCount, 2, "the hidden reply does not count");
  assert.deepEqual(
    body.posts[0].latestReplies.map((reply) => reply.id),
    [10],
    "the hidden reply is not previewed",
  );

  const countsCall = mock.calls.find((call) => call.sql.includes("AS reply_count"));
  assert.ok(countsCall);
  // Level-1 + level-2 both gated by the same member visibility clause listReplies
  // uses, and the level-2 rows additionally require a viewable level-1 parent.
  assert.ok(countsCall.sql.includes("((r.visibility = 'public' AND NOT EXISTS (SELECT 1 FROM bans"));
  assert.ok(countsCall.sql.includes("l1.parent_id IS NULL OR (l1.visibility = 'public' AND NOT EXISTS (SELECT 1 FROM bans"));
  assert.ok(countsCall.sql.includes("JOIN posts l1 ON l1.id = r.parent_id"), "level-2 rows resolve their thread through the level-1 parent");
  assert.deepEqual(countsCall.values, [1, 7, 7], "root ids bound for the IN list, then the viewer id twice");
  assert.deepEqual(countsCall.values.slice(0, 1), [1], "only this page's root ids bound");

  const latestCall = mock.calls.find((call) => call.sql.includes("ROW_NUMBER"));
  assert.ok(latestCall);
  assert.ok(latestCall.sql.includes("((r.visibility = 'public' AND NOT EXISTS (SELECT 1 FROM bans"),
    "previews obey the same visibility clause as the replies page");
  assert.ok(latestCall.sql.includes("((c.visibility = 'public' AND NOT EXISTS (SELECT 1 FROM bans"),
    "preview subReplyCount respects viewer visibility like the replies page");
  assert.deepEqual(latestCall.values, [7, 1, 7],
    "bind order follows SQL text: sub-count viewer, root ids, level-1 viewer");
});

test("more than 3 replies caps latestReplies at the 3 most recent while replyCount stays full", async () => {
  const mock = mockDb(feedRoutesWithReplyData({
    feedRows: [postRow({ id: "1", created_at: 1700000000, last_activity_at: 1700100100 })],
    countRows: [{ thread_root: "1", reply_count: "4" }],
    latestRows: [
      latestRowFixture({ id: "40", created_at: 1700000040, sub_reply_count: 0, rn: 1 }),
      latestRowFixture({ id: "30", created_at: 1700000030, sub_reply_count: 0, rn: 2 }),
      latestRowFixture({ id: "20", created_at: 1700000020, sub_reply_count: 0, rn: 3 }),
    ],
  }));
  const response = await route(
    new Request("https://forum.example/api/posts", { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.posts[0].replyCount, 4, "the count is the full comment total");
  assert.equal(body.posts[0].latestReplies.length, 3);
  assert.deepEqual(body.posts[0].latestReplies.map((reply) => reply.id), [40, 30, 20]);

  // The cap is enforced in the ranked query itself, most recent per thread root.
  const latestCall = mock.calls.find((call) => call.sql.includes("ROW_NUMBER"));
  assert.match(
    latestCall.sql, /ROW_NUMBER\(\) OVER \(PARTITION BY r\.parent_id ORDER BY r\.created_at DESC, r\.id DESC\) AS rn/,
  );
  assert.ok(latestCall.sql.includes("WHERE rn <= 3"));
  assert.deepEqual(latestCall.values.slice(1, 2), [1], "the IN list carries this page's root ids once");
});

test("preview snippets truncate the reply body text at 80 characters with an ellipsis", async () => {
  const longBody = "b".repeat(100);
  const mock = mockDb(feedRoutesWithReplyData({
    feedRows: [postRow({ id: "1", created_at: 1700000000, last_activity_at: 1700100100 })],
    latestRows: [
      latestRowFixture({ id: "10", body: longBody }),
      latestRowFixture({ id: "11", body: "short but fine", rn: 2 }),
    ],
  }));
  const response = await route(
    new Request("https://forum.example/api/posts", { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  const [long, short] = body.posts[0].latestReplies;
  assert.equal(long.snippet, "b".repeat(80) + "…");
  assert.equal(long.snippet.length, 81, "80 characters plus the ellipsis character");
  assert.equal(short.snippet, "short but fine", "bodies at or under 80 characters pass through uncut");
});

test("each feed page pays exactly one counts query and one latest-replies query, and the cursor SQL is untouched", async () => {
  const feedRows = [];
  for (let i = 0; i < 3; i++) {
    feedRows.push(postRow({
      id: String(9 - i),
      created_at: 1700000000 + i,
      last_activity_at: 1700100100 - i,
    }));
  }
  const mock = mockDb(feedRoutesWithReplyData({ feedRows }));
  const response = await route(
    new Request("https://forum.example/api/posts", { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  for (const post of body.posts) {
    assert.equal(post.replyCount, 0);
    assert.deepEqual(post.latestReplies, []);
  }
  const countsCalls = mock.calls.filter((call) => call.sql.includes("AS reply_count"));
  const latestCalls = mock.calls.filter((call) => call.sql.includes("ROW_NUMBER"));
  assert.equal(countsCalls.length, 1, "one reply-counts query per feed page");
  assert.equal(latestCalls.length, 1, "one latest-replies query per feed page");
  assert.equal(mock.batches.length, 0, "decoration is two plain reads, never a D1 batch");
  assert.ok(countsCalls[0].sql.includes("IN (?, ?, ?)"), "one placeholder per root id, deduplicated");
  assert.deepEqual(countsCalls[0].values.slice(0, 3), [9, 8, 7]);

  // The feed SELECT itself still owns its cursor clauses: no decoration SQL may
  // leak into it (Review Focus 1), and the composite keyset is exactly as v2.2.
  const feedCall = mock.calls[0];
  assert.equal(feedCall.sql.includes("ROW_NUMBER"), false);
  assert.equal(feedCall.sql.includes("reply_count"), false);
  assert.equal(feedCall.sql.includes("latest"), false);
  assert.match(feedCall.sql, /WHERE p\.parent_id IS NULL AND p\.visibility = 'public' /);
  assert.match(feedCall.sql, /ORDER BY \(p\.pinned_at IS NULL\) ASC, p\.last_activity_at DESC, p\.id DESC LIMIT 21/);
  assert.equal(feedCall.values.length, 1);

  // Detail and replies read paths gain nothing (unchanged payloads).
  const root = postRow({ id: "1", created_at: 1700000000, last_activity_at: 1700000005 });
  const detailMock = mockDb([
    { sql: /WHERE p\.id = \? LIMIT 1/, result: (values) => (values[1] === 1 ? root : null) },
    { sql: /WHERE p\.parent_id = \?/, rows: [] },
    { sql: /./ },
  ]);
  const detailResponse = await route(
    new Request("https://forum.example/api/posts/1", { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(detailMock.db),
  );
  assert.equal(detailResponse.status, 200);
  const detailBody = await detailResponse.json();
  assert.equal("replyCount" in detailBody, false, "the detail payload is unchanged");
  assert.equal("latestReplies" in detailBody, false, "the detail payload is unchanged");
});

test("admin feed viewers count and preview without visibility binds, mirroring the replies page", async () => {
  const mock = mockDb(feedRoutesWithReplyData({
    feedRows: [postRow({ id: "1", created_at: 1700000000, last_activity_at: 1700100100 })],
    countRows: [{ thread_root: "1", reply_count: "5" }],
    latestRows: [latestRowFixture({ id: "10", sub_reply_count: 2 })],
  }));
  const feed = await listRootPosts(
    { FORUM_DB: mock.db },
    { id: 7, role: "admin", username: "admin_user" },
    { byActivity: true },
  );

  assert.equal(feed.posts[0].replyCount, 5);
  assert.deepEqual(feed.posts[0].latestReplies.map((reply) => reply.id), [10]);
  const countsCall = mock.calls.find((call) => call.sql.includes("AS reply_count"));
  assert.equal(
    countsCall.sql.includes("l1.parent_id IS NULL OR l1.visibility = 'public' OR l1.author_id = ?"),
    false,
    "admins drop the member visibility clauses like attachSubReplyCounts' showAll",
  );
  assert.equal(countsCall.sql.includes("r.author_id = ?"), false);
  assert.deepEqual(countsCall.values, [1], "root ids only, no viewer binds");
  const latestCall = mock.calls.find((call) => call.sql.includes("ROW_NUMBER"));
  assert.equal(
    latestCall.sql.includes("c.visibility = 'public' OR c.author_id = ?"),
    false,
    "preview subReplyCounts also drop the member clause for admins",
  );
  assert.deepEqual(latestCall.values, [1]);
});

test("admin viewers get counts without the visibility clause on the replies page", async () => {
  const root = postRow({ id: "1", parent_id: null, last_activity_at: 1700000005 });
  const reply10 = postRow({ id: "10", author_id: "5", parent_id: "1", body: "first", last_activity_at: null });
  const adminMock = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: signedInSessionRow({ role: "admin" }) },
    banCheckRoute,
    { sql: /WHERE p\.id = \? LIMIT 1/, result: (values) => (values[1] === 1 ? root : null) },
    { sql: /WHERE p\.parent_id = \?/, rows: [reply10] },
    { sql: /./ },
  ], {
    batchResult: () => ({ results: [{ sub_reply_count: 4 }] }),
  });
  const response = await route(
    new Request("https://forum.example/api/posts/1/replies", {
      headers: { "CF-Connecting-IP": "192.0.2.9", Cookie: "wempo_session=" + "s".repeat(43) },
    }),
    envFor(adminMock.db),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.replies[0].subReplyCount, 4);
  assert.equal(adminMock.batches.length, 1);
  // Admin sees every child: parent_id = ? alone, no visibility bind.
  assert.deepEqual(adminMock.batches[0].map((statement) => statement.values), [[10]]);
});

// --- Composer body limit (owner-set): post and reply bodies cap at 1,000 ----
// characters. requiredText keeps its "between 1 and N characters" wording with
// the new number; exactly-at-limit values still create.

const postInsertRoute = {
  sql: /INSERT INTO posts/,
  runMeta: { meta: { changes: 1, last_row_id: 900 } },
};
const postCreateRoutes = [sessionRoute, banCheckRoute, postInsertRoute, { sql: /./ }];

test("a 1,001-character post body is rejected with 400 and the 1,000-character message", async () => {
  const mock = mockDb(postCreateRoutes);
  const siteverify = withMockedSiteverify({ success: true, action: "post", hostname: "forum.example" });
  let response;
  try {
    response = await route(
      requestFor("https://forum.example/api/posts", "POST", {
        body: "W".repeat(1001),
        "cf-turnstile-response": "turnstile-token-fixture",
      }),
      envFor(mock.db),
    );
  } finally {
    siteverify.done();
  }
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Post must be between 1 and 1000 characters.");
  // No insert ever ran: the oversized body stopped at validation.
  assert.equal(mock.batches.length, 0);
  assert.equal(mock.calls.filter((call) => /INSERT INTO posts/.test(call.sql)).length, 0);
});

test("a 1,000-character post body is accepted with 201", async () => {
  const mock = mockDb(postCreateRoutes);
  const siteverify = withMockedSiteverify({ success: true, action: "post", hostname: "forum.example" });
  let response;
  try {
    response = await route(
      requestFor("https://forum.example/api/posts", "POST", {
        body: "W".repeat(1000),
        "cf-turnstile-response": "turnstile-token-fixture",
      }),
      envFor(mock.db),
    );
  } finally {
    siteverify.done();
  }
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: 900 });
  const insert = mock.calls.find((call) => /INSERT INTO posts/.test(call.sql));
  // Root insert binds (author_id, body, created_at, ...), so the body is values[1].
  assert.equal(insert.values[1], "W".repeat(1000));
});

test("a 1,001-character reply body is rejected with 400 and the 1,000-character message", async () => {
  const root = postRow({ id: "1", author_id: "3", parent_id: null });
  const mock = mockDb(threadRoutes((id) => (id === 1 ? root : null)));
  const siteverify = withMockedSiteverify({ success: true, action: "reply", hostname: "forum.example" });
  let response;
  try {
    response = await route(
      requestFor("https://forum.example/api/posts/1/replies", "POST", {
        body: "W".repeat(1001),
        "cf-turnstile-response": "turnstile-token-fixture",
      }),
      envFor(mock.db),
    );
  } finally {
    siteverify.done();
  }
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Reply must be between 1 and 1000 characters.");
  assert.equal(mock.batches.length, 0);
});

test("a 1,000-character reply body is accepted with 201", async () => {
  const root = postRow({ id: "1", author_id: "3", parent_id: null });
  const mock = mockDb(threadRoutes((id) => (id === 1 ? root : null)), {
    batchMeta: [{ meta: { changes: 1, last_row_id: 500 } }],
  });
  const siteverify = withMockedSiteverify({ success: true, action: "reply", hostname: "forum.example" });
  let response;
  try {
    response = await route(
      requestFor("https://forum.example/api/posts/1/replies", "POST", {
        body: "W".repeat(1000),
        "cf-turnstile-response": "turnstile-token-fixture",
      }),
      envFor(mock.db),
    );
  } finally {
    siteverify.done();
  }
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: 500 });
  const [replyInsert] = mock.batches[0];
  assert.equal(replyInsert.values[2], "W".repeat(1000));
});