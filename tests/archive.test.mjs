// Accountability archive (v2.4.1): public serving of post_archive. Anyone can
// read what was deleted — no auth, read-limiter only. Rows carry who wrote
// them, why they're gone, and when; pagination walks the id DESC keyset.
import test from "node:test";
import assert from "node:assert/strict";
import forumWorker from "../worker.mjs";

function mockDb(routes, { batchMeta = null } = {}) {
  const calls = [];
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
            async all() {
              return { results: route.rows === undefined ? [] : route.rows };
            },
            async first() {
              return typeof route.result === "function" ? route.result(values) : (route.result ?? null);
            },
            async run() {
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
    async batch(statements) { return statements.map((_s, i) => (batchMeta && batchMeta[i]) || { meta: { changes: 1 } }); },
  };
  return { db, calls };
}

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

function archiveRoute(rows) {
  return { sql: /^SELECT id, original_post_id, author_id, author_name, body, board, created_at, deleted_at, deleted_because FROM post_archive WHERE id < \? ORDER BY id DESC LIMIT 51$/, rows };
}

test("GET /api/archive is public, newest-first, and ISO-serialized", async () => {
  const rows = [
    { id: 5, original_post_id: 90, author_id: 7, author_name: "scrubber", body: "words to hide", board: "general", created_at: 1700000000, deleted_at: 1700001234, deleted_because: "post-delete" },
    { id: 4, original_post_id: 91, author_id: 7, author_name: "scrubber", body: "mass-wiped", board: "suggestions", created_at: 1700000001, deleted_at: 1700001234, deleted_because: "account-delete" },
  ];
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/archive", { method: "GET" }),
    envFor(mockDb([archiveRoute(rows)]).db),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.archive.length, 2);
  assert.equal(payload.archive[0].authorName, "scrubber");
  assert.equal(payload.archive[0].deletedBecause, "post-delete");
  assert.equal(payload.archive[0].body, "words to hide");
  assert.equal(payload.archive[0].deletedAt, new Date(1700001234 * 1000).toISOString());
  assert.equal(payload.nextBefore, null, "no cursor until a full page (51 rows)");
});

test("a full page emits the id cursor from the last shown row", async () => {
  const rows = Array.from({ length: 51 }, (_val, index) => ({
    id: 100 - index, original_post_id: 1000 - index, author_id: null, author_name: "gone",
    body: "v" + index, board: "general", created_at: 1700000000, deleted_at: 1700001234,
    deleted_because: "account-delete",
  }));
  const response2 = await forumWorker.fetch(
    new Request("https://forum.example/api/archive", { method: "GET" }),
    envFor(mockDb([archiveRoute(rows)]).db),
  );
  assert.equal(response2.status, 200);
  const payload2 = await response2.json();
  assert.equal(payload2.archive.length, 51);
  assert.equal(payload2.nextBefore, 50, "id of the last shown row");
});

test("an empty or exhausted archive renders with no cursor", async () => {
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/archive", { method: "GET" }),
    envFor(mockDb([archiveRoute([])]).db),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.archive, []);
  assert.equal(payload.nextBefore, null);
});

test("a malformed before cursor is a 400 without reading the archive", async () => {
  const mock = mockDb([{ sql: /./ }]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/archive?before=oops", { method: "GET" }),
    envFor(mock.db),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "A before cursor must be a positive id.");
  assert.equal(mock.calls.length, 0, "no archive query runs");
});

test("the before cursor reaches the bind (newest-id keyset)", async () => {
  const mock = mockDb([archiveRoute([{ id: 3, original_post_id: 1, author_id: null, author_name: "removed", body: "b", board: "general", created_at: 1, deleted_at: 2, deleted_because: "account-delete" }])]);
  await forumWorker.fetch(
    new Request("https://forum.example/api/archive?before=4", { method: "GET" }),
    envFor(mock.db),
  );
  assert.deepEqual(mock.calls[0].values, [4]);
});
