// Weekly leaderboard (v2.5): transparent score (threads×2 + replies +
// reactions received), banned members excluded, no-activity members absent,
// top-10 cap, ISO-free numeric fields.
import test from "node:test";
import assert from "node:assert/strict";
import forumWorker from "../worker.mjs";

const rows = [
  { id: 1, username: "top", threads: "3", replies: "12", reactions_received: "8" },
  { id: 2, username: "second", threads: "1", replies: "4", reactions_received: "2" },
];
function mockDb(routes) {
  const calls = [];
  const db = {
    prepare(sql) {
      const route = routes.find((c) => c.sql.test(sql)) || routes[routes.length - 1];
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            async first() { return route.result ?? null; },
            async all() { return { results: route.rows ?? [] }; },
          };
        },
      };
    },
    async batch(statements) { return statements.map(() => ({ meta: { changes: 1 } })); },
  };
  return { db, calls };
}
const successLimiter = () => ({ async limit() { return { success: true }; } });

test("the leaderboard returns the scored rows newest-week, banned excluded", async () => {
  const mock = mockDb([{ sql: /FROM users u WHERE/, rows }]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/leaderboard", { method: "GET" }),
    { FORUM_DB: mock.db, READ_RATE_LIMITER: successLimiter() },
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.week.leaderboard[0], {
    userId: 1, username: "top", threads: 3, replies: 12, reactionsReceived: 8,
    score: 2 * 3 + 12 + 8,
  });
  const call = mock.calls[0];
  // Banned members excluded; the 7 binds all carry the same week start.
  assert.match(call.sql, /NOT EXISTS \(SELECT 1 FROM bans/);
  assert.equal(new Set(call.values).size === 1, true, "one weekStart value, bound for every subselect");
  assert.ok(Math.abs(Number(call.values[0]) - (Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60)) < 30);
  // Score arithmetic in the ORDER BY matches the payload's formula.
  assert.match(call.sql, /2 \* \(SELECT COUNT/);
});

test("an empty week renders an empty leaderboard without error", async () => {
  const mock = mockDb([{ sql: /FROM users u WHERE/, rows: [] }]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/leaderboard", { method: "GET" }),
    { FORUM_DB: mock.db, READ_RATE_LIMITER: successLimiter() },
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).week.leaderboard, []);
});
