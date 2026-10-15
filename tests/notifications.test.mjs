import test from "node:test";
import assert from "node:assert/strict";
import forumWorker, { notificationBatchStatements, unreadCount } from "../worker.mjs";

function envWithLimiters(db, extras = {}) {
  return {
    FORUM_DB: db,
    READ_RATE_LIMITER: { async limit() { return { success: true }; } },
    WRITE_RATE_LIMITER: { async limit() { return { success: true }; } },
    ...extras,
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

// D1 mock: each route is { sql: RegExp, ...responder }. prepare() picks the
// first route whose regex matches the SQL; the last route acts as a fallback.
// Responders: result (first()), rows (all()), changes (run()).
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
          calls.push({ sql, values });
          return {
            async first() {
              return route.result === undefined ? null : route.result;
            },
            async all() {
              return { results: route.rows === undefined ? [] : route.rows };
            },
            async run() {
              return { meta: { changes: route.changes === undefined ? 0 : route.changes } };
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

test("notification batch statements are skipped for missing or self-directed replies", () => {
  const db = { prepare() { throw new Error("must not prepare statements"); } };
  assert.deepEqual(notificationBatchStatements(db, null, 5, 1, 2, 1000), []);
  assert.deepEqual(notificationBatchStatements(db, 5, 5, 1, 2, 1000), []);
});

test("notification inserts target the recipient and never duplicate a reply", () => {
  const statements = notificationBatchStatements({ prepare: (sql) => ({ sql, bind: (...v) => ({ sql, values: v }) }) }, 5, 9, 100, 200, 1700000000);
  assert.equal(statements.length, 2);
  const [insert, prune] = statements;
  assert.match(insert.sql, /INSERT INTO notifications/);
  assert.match(insert.sql, /user_id, target_post_id, reply_id, created_at/);
  assert.match(insert.sql, /WHERE NOT EXISTS/);
  assert.match(insert.sql, /FROM notifications WHERE user_id = \? AND reply_id = \?/);
  assert.deepEqual(insert.values, [5, 100, 200, 1700000000, 5, 200]);
});

test("notification cap prunes to the newest 50", () => {
  const statements = notificationBatchStatements({ prepare: (sql) => ({ sql, bind: (...v) => ({ sql, values: v }) }) }, 5, 9, 100, 200, 1700000000);
  const prune = statements[1];
  assert.match(prune.sql, /DELETE FROM notifications/);
  assert.match(prune.sql, /WHERE user_id = \? AND id NOT IN/);
  assert.match(prune.sql, /SELECT id FROM notifications WHERE user_id = \? ORDER BY id DESC LIMIT 50\)/);
  assert.deepEqual(prune.values, [5, 5]);
});

test("unreadCount counts only unread rows for the user", async () => {
  const read = mockDb([{ sql: /FROM notifications WHERE user_id = \? AND read_at IS NULL/, result: { unread: 3 } }]);
  assert.equal(await unreadCount({ FORUM_DB: read.db }, 7), 3);
  assert.equal(read.calls.length, 1);
  assert.deepEqual(read.calls[0].values, [7]);

  const none = mockDb([{ sql: /./ }]);
  assert.equal(await unreadCount({ FORUM_DB: none.db }, 7), 0);
});

async function signedInHandler(requestUrl, method, routes, body = "") {
  const { handleNotificationsRoutes } = await import("../api/notifications.mjs");
  const request = new Request(requestUrl, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "https://forum.example",
      "X-CSRF-Token": "expected-csrf-token",
      Cookie: "wempo_session=" + "s".repeat(43),
    },
    body: method === "GET" ? undefined : body || "{}",
  });
  const url = new URL(requestUrl);
  return handleNotificationsRoutes(request, envWithLimiters(routes.db), url, url.pathname, method);
}

test("notification lists are newest-first, recipient-only, and carry an 80-char preview", async () => {
  const longBody = "x".repeat(120);
  const routes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: signedInSessionRow() },
    {
      sql: /FROM notifications n WHERE n\.user_id = \?/,
      rows: [
        { id: "20", target_post_id: "2", reply_id: "11", created_at: 1700000200, read_at: null, reply_body: longBody },
        { id: "10", target_post_id: "1", reply_id: "9", created_at: 1700000100, read_at: 1700000500, reply_body: null },
      ],
    },
    { sql: /./ },
  ]);
  const response = await signedInHandler("https://forum.example/api/me/notifications", "GET", routes);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.notifications.length, 2);
  assert.deepEqual(body.notifications, [
    {
      id: 20,
      targetPostId: 2,
      replyId: 11,
      createdAt: new Date(1700000200 * 1000).toISOString(),
      read: false,
      postPreview: "x".repeat(80),
    },
    {
      id: 10,
      targetPostId: 1,
      replyId: 9,
      createdAt: new Date(1700000100 * 1000).toISOString(),
      read: true,
      postPreview: "",
    },
  ]);
  assert.match(routes.calls[1].sql, /FROM notifications n WHERE n\.user_id = \? ORDER BY n\.id DESC LIMIT 50/);
  assert.deepEqual(routes.calls[1].values, [7]);
});

test("marking one notification read only touches own rows and stays idempotent", async () => {
  const routes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: signedInSessionRow() },
    { sql: /UPDATE notifications SET read_at = \? WHERE id = \? AND user_id = \? AND read_at IS NULL/, changes: 0 },
    { sql: /./ },
  ]);
  const response = await signedInHandler("https://forum.example/api/me/notifications/11/read", "POST", routes);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(routes.calls.length, 2);
  assert.match(routes.calls[1].sql, /WHERE id = \? AND user_id = \? AND read_at IS NULL/);
  assert.equal(routes.calls[1].values[1], 11);
  assert.equal(routes.calls[1].values[2], 7);
});

test("marking all read stamps only the signed-in user's unread rows", async () => {
  const routes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: signedInSessionRow() },
    { sql: /UPDATE notifications SET read_at = \? WHERE user_id = \? AND read_at IS NULL/, changes: 4 },
    { sql: /./ },
  ]);
  const response = await signedInHandler("https://forum.example/api/me/notifications/read-all", "POST", routes);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(routes.calls.length, 2);
  assert.equal(routes.calls[1].values[1], 7);
});

test("GET /api/session exposes unreadNotifications only for signed-in users", async () => {
  const signedIn = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: signedInSessionRow() },
    { sql: /FROM notifications WHERE user_id = \? AND read_at IS NULL/, result: { unread: 2 } },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/session", {
      headers: { Cookie: "wempo_session=" + "s".repeat(43) },
    }),
    envWithLimiters(signedIn.db),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.username, "test_user");
  assert.equal(body.unreadNotifications, 2);

  const guest = mockDb([{ sql: /./, changes: 1 }]);
  const guestResponse = await forumWorker.fetch(
    new Request("https://forum.example/api/session"),
    envWithLimiters(guest.db, { GUEST_SESSION_RATE_LIMITER: { async limit() { return { success: true }; } } }),
  );
  assert.equal(guestResponse.status, 200);
  const guestBody = await guestResponse.json();
  assert.equal(guestBody.user, null);
  assert.equal("unreadNotifications" in guestBody, false);
});

test("notification routes are registered behind the worker's rate limiter", async () => {
  let limiterSeen = false;
  const db = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: signedInSessionRow() },
    { sql: /FROM notifications n WHERE n\.user_id = \?/, rows: [] },
    { sql: /./ },
  ]).db;
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/me/notifications", {
      headers: { Cookie: "wempo_session=" + "s".repeat(43) },
    }),
    {
      FORUM_DB: db,
      READ_RATE_LIMITER: {
        async limit() {
          limiterSeen = true;
          return { success: true };
        },
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(limiterSeen, true);

  // POSTs reach the same handler group and fail closed on origin checks
  // (origin is enforced before any database access), so no 404.
  const postDb = {
    prepare() {
      throw new Error("Database must not be queried before the origin check");
    },
  };
  const postResponse = await forumWorker.fetch(
    new Request("https://forum.example/api/me/notifications/read-all", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }),
    envWithLimiters(postDb),
  );
  assert.equal(postResponse.status, 403);
});