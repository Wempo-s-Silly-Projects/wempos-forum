// Profile accent themes (v2.5): PATCH /api/me accepts a whitelisted palette
// KEY ("clears"), never raw CSS; the profile payload carries the key for the
// frontend's per-key CSS class application.
import test from "node:test";
import assert from "node:assert/strict";
import forumWorker from "../worker.mjs";
import { PROFILE_ACCENTS, isValidProfileAccent } from "../api/shared.mjs";

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
  profile_accent: "violet",
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

const patchRequest = (payload) => new Request("https://forum.example/api/me", {
  method: "PATCH",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://forum.example",
    "X-CSRF-Token": "expected-csrf-token",
    Cookie: "wempo_session=" + "s".repeat(43),
  },
  body: JSON.stringify(payload),
});

test("the palette whitelist and its validator", () => {
  assert.ok(isValidProfileAccent("") && isValidProfileAccent("forest") && isValidProfileAccent("teal"));
  assert.equal(isValidProfileAccent("background: red"), false, "raw CSS is never a key");
  assert.equal(isValidProfileAccent(undefined), false);
  for (const color of Object.values(PROFILE_ACCENTS)) {
    assert.ok(color === null || /^#[0-9a-f]{6}$/.test(color), "values are palette hexes");
  }
});

test("PATCH /api/me stores the accent key and echoes it", async () => {
  const mock = mockDb([
    sessionRoute(),
    { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(patchRequest({ profileAccent: "rose" }), envFor(mock.db));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).profileAccent, "rose");
  const update = mock.calls.find((call) => call.sql.startsWith("UPDATE users SET"));
  assert.ok(update, "an accent-only PATCH still updates");
  assert.ok(update.sql.includes("profile_accent = ?"));
  assert.deepEqual(update.values.slice(0, 3), ["rose", 7, 7],
    "accent key bound, then the ownership + ban-guard ids");
  assert.ok(Math.abs(Number(update.values[3]) - Math.floor(Date.now() / 1000)) < 30,
    "the last bind is the ban-guard's now stamp");
});

test("PATCH with an off-whitelist accent is a 400 before any write", async () => {
  const mock = mockDb([
    sessionRoute(),
    { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(patchRequest({ profileAccent: "position:fixed" }), envFor(mock.db));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /not available/);
  assert.ok(!mock.calls.some((call) => call.sql.startsWith("UPDATE users")), "no write runs");
});

test('the empty key clears the theme', async () => {
  const mock = mockDb([
    sessionRoute(),
    { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(patchRequest({ profileAccent: "" }), envFor(mock.db));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).profileAccent, "");
  const update = mock.calls.find((call) => call.sql.startsWith("UPDATE users SET"));
  assert.deepEqual(update.values[0], "");
});

test("the profile payload carries the accent key from the row", async () => {
  const profileRow = {
    id: 7, username: "test_user", role: "member", bio: "", profile_accent: "sky",
  };
  const mock = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow() },
    { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null },
    { sql: /FROM users WHERE username_key = \? LIMIT 1/, result: profileRow },
    { sql: /FROM posts p JOIN users u/, rows: [] },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/users/test_user", { method: "GET" }),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).profileAccent, "sky");
});
test("the profile payload carries the post counter (threads vs replies)", async () => {
  const profileRow = {
    id: 7, username: "test_user", role: "member", bio: "", profile_accent: "",
  };
  const calls = [];
  const batches = [];
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql: sql.slice(0, 220), values });
          return {
            async first() {
              if (/posts_count/.test(sql)) return { posts_count: "10", replies_count: "31" };
              if (/FROM users/.test(sql)) return profileRow;
              return null;
            },
            async all() { return { results: [] }; },
          };
        },
      };
    },
    async batch(statements) { batches.push(statements); return statements.map(() => ({ meta: { changes: 1 } })); },
  };
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/users/test_user", { method: "GET" }),
    envFor(db),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.postsCount, 10, "threads STARTED — replies excluded (parent_id IS NULL)");
  assert.deepEqual(payload.repliesCount, 31);
  const countCall = calls.find((call) => call.sql.includes("posts_count"));
  assert.ok(countCall.sql.includes("parent_id IS NULL"), "the counter separates threads from replies");
  assert.deepEqual(countCall.values.slice(0, 2), [7, 7], "the profile member's id, bound server-side");
});
