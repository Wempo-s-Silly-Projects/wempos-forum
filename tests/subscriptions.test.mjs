// Thread subscriptions (C1): POST/DELETE /api/posts/:id/subscribe (member,
// ROOT threads only, gates mirroring the reaction routes, rate limit "write"),
// the detail payload's `subscribed` flag, and the reply fan-out to subscribers
// (batched, best-effort, deduped against the ordinary reply notification).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import forumWorker from "../worker.mjs";
import {
  SUBSCRIBERS_SELECT_SQL,
  runFanOutChunks,
  subscriptionFanOutStatements,
} from "../api/subscriptions.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// D1 mock: routes are { sql: RegExp, ...responder }. prepare() picks the first
// route whose regex matches the SQL; the last route acts as a fallback.
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
const banCheckRoute = { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null };
const banViewRouteOff = { sql: /SELECT 1 FROM bans b WHERE b\.user_id = \?/, result: null };
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

function requestFor(url, method, body) {
  return new Request(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "https://forum.example",
      "X-CSRF-Token": "expected-csrf-token",
      Cookie: "wempo_session=" + "s".repeat(43),
    },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
}

const rootRoutes = (root) => [
  sessionRoute(),
  banCheckRoute,
  { sql: /WHERE p\.id = \? LIMIT 1/, result: () => root },
  banViewRouteOff,
  { sql: /FROM posts WHERE id = \? LIMIT 1/, result: () => root },
  { sql: /./ },
];

test("POST/DELETE /subscribe on a visible root round-trips idempotently", async () => {
  const root = postRow({ id: "9" });
  const insertMock = mockDb(rootRoutes(root));
  const response = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/9/subscribe", "POST"),
    envFor(insertMock.db),
  );
  assert.equal(response.status, 200);
  const insert = insertMock.calls.find((call) => /INSERT INTO thread_subscriptions/.test(call.sql));
  assert.ok(insert, "the subscribe insert runs");
  assert.match(insert.sql, /WHERE NOT EXISTS/);
  assert.deepEqual(insert.values.slice(0, 3), [7, 9, insert.values[2]], "user, thread, now");

  const deleteMock = mockDb(rootRoutes(root));
  const deleteResponse = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/9/subscribe", "DELETE"),
    envFor(deleteMock.db),
  );
  assert.equal(deleteResponse.status, 200);
  const destroy = deleteMock.calls.find((call) => /DELETE FROM thread_subscriptions/.test(call.sql));
  assert.ok(destroy, "the unsubscribe delete runs");
  assert.deepEqual(destroy.values, [7, 9], "own subscription only");
});

test("subscribing a non-root target is a 400 before any write", async () => {
  const level1 = postRow({ id: "4", parent_id: "1", body: "a reply" });
  const mock = mockDb(rootRoutes(level1));
  const response = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/4/subscribe", "POST"),
    envFor(mock.db),
  );
  assert.equal(response.status, 400);
  assert.equal(mock.calls.some((call) => /INSERT INTO thread_subscriptions/.test(call.sql)), false);
});

test("subscribe gates: guest 401, hidden post 404, wrong method 405", async () => {
  const guest = mockDb([
    { sql: /./ },
  ]);
  const guestResponse = await forumWorker.fetch(
    new Request("https://forum.example/api/posts/1/subscribe", {
      method: "POST",
      headers: { Origin: "https://forum.example", "Content-Type": "application/json" },
      body: "{}",
    }),
    envFor(guest.db),
  );
  assert.equal(guestResponse.status, 401);
  assert.equal(guest.calls.length, 0, "no database read before the gate refusals");

  const hidden = mockDb(rootRoutes(postRow({ id: "1", visibility: "hidden" })));
  const hiddenResponse = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/1/subscribe", "POST"),
    envFor(hidden.db),
  );
  assert.equal(hiddenResponse.status, 404);

  const wrong = mockDb([{ sql: /./ }]);
  const wrongResponse = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/1/subscribe", "PATCH"),
    envFor(wrong.db),
  );
  assert.equal(wrongResponse.status, 405);
  assert.equal(wrong.calls.length, 0);
});

test("an unknown post id is a 404 with no write", async () => {
  const mock = mockDb(rootRoutes(null));
  const response = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/12345/subscribe", "POST"),
    envFor(mock.db),
  );
  assert.equal(response.status, 404);
  assert.equal(mock.calls.some((call) => /INSERT INTO thread_subscriptions/.test(call.sql)), false);
});

// --- the reply fan-out to subscribers ---------------------------------------

test("a reply on a subscribed root notifies every subscriber except the author and the target", async () => {
  const db = { prepare: (sql) => ({ sql, bind: (...v) => ({ sql, values: v }) }) };
  // Subscriber 7 == the reply author, 5 == the ordinary reply target, 9 and 8
  // subscribe from the sidelines and must be notified. 7 also appears via the
  // "subscribed by both sides" shape — the fan-out never notifies the author.
  const statements = subscriptionFanOutStatements(db, [7, 5, 9, 8], {
    replyAuthorId: 7,
    replyTargetId: 5,
    targetPostId: 1,
    replyId: 500,
    now: 1700000000,
  });
  // Four recipients minus the two exclusions = two members.
  const inserts = statements.filter((statement) => /INSERT INTO notifications/.test(statement.sql));
  const prunes = statements.filter((statement) => /DELETE FROM notifications/.test(statement.sql));
  assert.equal(inserts.length, 2, "one insert per remaining subscriber");
  assert.equal(prunes.length, 2, "one prune per notified recipient (cap mirror)");
  assert.deepEqual(inserts.map((statement) => statement.values[0]).sort(), [8, 9]);
  for (const insert of inserts) {
    assert.deepEqual(insert.values.slice(1, 4), [1, 500, 1700000000]);
    assert.match(insert.sql, /WHERE NOT EXISTS/, "the dedupe guard mirrors notificationBatchStatements");
    assert.match(insert.sql, /WHERE user_id = \? AND reply_id = \?/, "per-(recipient, reply) dedupe");
  }
});

test("with no subscribers the fan-out builds no statements", () => {
  const db = { prepare: () => { throw new Error("must not prepare"); } };
  assert.deepEqual(subscriptionFanOutStatements(db, [], {
    replyAuthorId: 7, replyTargetId: null, targetPostId: 1, replyId: 500, now: 1700000000,
  }), []);
});

test("the live reply route dedupes the subscriber fan-out into the same best-effort batch", async () => {
  const root = postRow({ id: "1", author_id: "3", parent_id: null });
  const mock = mockDb([
    sessionRoute(),
    banCheckRoute,
    { sql: /WHERE p\.id = \? LIMIT 1/, result: () => root },
    { sql: /FROM posts WHERE id = \? LIMIT 1/, result: () => root },
    banViewRouteOff,
    { sql: /SELECT user_id FROM thread_subscriptions/, rows: [{ user_id: "3" }, { user_id: "4" }] },
    { sql: /./ },
  ], {
    batchMeta: [
      { meta: { changes: 1, last_row_id: 600 } },
    ],
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, action: "reply", hostname: "forum.example" }), { status: 200 });
  let response;
  try {
    response = await forumWorker.fetch(requestFor("https://forum.example/api/posts/1/replies", "POST", {
      body: "notify the thread",
      "cf-turnstile-response": "turnstile-token-fixture",
    }), envFor(mock.db));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(response.status, 201, await response.clone().text());
  // Batch 1: reply insert + bump. Batch 2: ordinary reply notification +
  // subscriber fan-out, best-effort.
  assert.ok(mock.batches.length >= 2);
  const fanoutBatch = mock.batches[1];
  const fanoutInserts = fanoutBatch.filter((statement) => /INSERT INTO notifications/.test(statement.sql));
  // Ordinary recipient is user 3 (the root author, who is ALSO a subscriber —
  // the deduped fan-out must not insert them twice); user 4 is a subscriber.
  assert.ok(fanoutInserts.length >= 2, "the ordinary and subscriber inserts ride together");
  const recipients = fanoutInserts.map((statement) => Number(statement.values[0]));
  assert.ok(recipients.includes(3), "the ordinary reply target is notified");
  assert.ok(recipients.includes(4), "a subscriber is notified");
  // The author (7) must never appear.
  assert.ok(!recipients.includes(7), "the reply author is never notified");
  assert.equal(new Set(recipients).size, recipients.length, "no member is notified twice for one reply");
  const fanoutCall = mock.calls.find((call) => /SELECT user_id FROM thread_subscriptions/.test(call.sql));
  assert.equal(fanoutCall.values[0], 1, "the fan-out resolves subscribers of the thread ROOT");
});

test("a failing subscriber fan-out never fails the reply", async () => {
  const root = postRow({ id: "1", author_id: "3", parent_id: null });
  const mock = mockDb([
    sessionRoute(),
    banCheckRoute,
    { sql: /WHERE p\.id = \? LIMIT 1/, result: () => root },
    { sql: /FROM posts WHERE id = \? LIMIT 1/, result: () => root },
    banViewRouteOff,
    { sql: /SELECT user_id FROM thread_subscriptions/, rows: [{ user_id: "4" }] },
    { sql: /./ },
  ], {
    batchMeta: [{ meta: { changes: 1, last_row_id: 600 } }],
  });
  const batches = mock.db.batch;
  mock.db.batch = async (statements) => {
    const result = await batches(statements);
    if (statements.some((statement) => /INSERT INTO notifications/.test(statement.sql))) {
      throw new Error("simulated fan-out failure");
    }
    return result;
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, action: "reply", hostname: "forum.example" }), { status: 200 });
  try {
    const response = await forumWorker.fetch(requestFor("https://forum.example/api/posts/1/replies", "POST", {
      body: "still lands",
      "cf-turnstile-response": "turnstile-token-fixture",
    }), envFor(mock.db));
    assert.equal(response.status, 201);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- the detail payload's subscribed flag ------------------------------------

test("the detail payload carries subscribed=true for a subscribed member and false otherwise", async () => {
  const root = postRow({ id: "1" });
  const detailRoutes = (exists) => [
    sessionRoute(),
    banCheckRoute,
    { sql: /WHERE p\.id = \? LIMIT 1/, result: () => root },
    { sql: /SELECT 1 FROM bans b WHERE b\.user_id = \?/, result: null },
    { sql: /SELECT 1 AS subscribed FROM thread_subscriptions WHERE user_id = \? AND post_id = \?/, result: exists },
    { sql: /./ },
  ];
  const subscribed = mockDb(detailRoutes({ subscribed: 1 }));
  const detail = await forumWorker.fetch(
    new Request("https://forum.example/api/posts/1", {
      headers: { Cookie: "wempo_session=" + "s".repeat(43), "CF-Connecting-IP": "192.0.2.7" },
    }),
    envFor(subscribed.db),
  );
  assert.equal(detail.status, 200);
  const detailBody = await detail.json();
  assert.equal(detailBody.subscribed, true);
  const flagCall = subscribed.calls.find((call) => /FROM thread_subscriptions WHERE user_id/.test(call.sql));
  assert.deepEqual(flagCall.values, [7, 1], "the flag reads (member, root)");

  const unsubscribed = mockDb(detailRoutes(null));
  const plain = await forumWorker.fetch(
    new Request("https://forum.example/api/posts/1"),
    envFor(unsubscribed.db),
  );
  assert.equal(plain.status, 200);
  assert.equal((await plain.json()).subscribed, false);
});

test("a guest detail payload reads subscribed=false without the subscription query", async () => {
  const root = postRow({ id: "1" });
  const mock = mockDb([
    { sql: /WHERE p\.id = \? LIMIT 1/, result: () => root },
    { sql: /SELECT 1 FROM bans b WHERE b\.user_id = \?/, result: null },
    { sql: /./ },
  ]);
  const detail = await forumWorker.fetch(
    new Request("https://forum.example/api/posts/1"),
    envFor(mock.db),
  );
  assert.equal(detail.status, 200);
  const body = await detail.json();
  assert.equal(body.subscribed, false, "guests read unsubscribed");
  assert.equal(
    mock.calls.some((call) => /FROM thread_subscriptions/.test(call.sql)),
    false,
    "no subscription read for a session-less viewer",
  );
});

test("the subscriber SELECT resolves the thread root's readers, oldest-first, capped", () => {
  assert.equal(
    SUBSCRIBERS_SELECT_SQL,
    "SELECT user_id FROM thread_subscriptions WHERE post_id = ? ORDER BY created_at ASC LIMIT 100",
  );
});

// --- fix round 1: the fan-out cap + chunked batches -----------------------------

test("a 150-subscriber thread fans out to exactly 100 recipients (cap after exclusions)", async () => {
  const db = { prepare: (sql) => ({ sql, bind: (...v) => ({ sql, values: v }) }) };
  const ids = Array.from({ length: 150 }, (_v, i) => i + 1);
  const statements = subscriptionFanOutStatements(db, ids, {
    replyAuthorId: 900, replyTargetId: 901, targetPostId: 1, replyId: 500, now: 1700000000,
  });
  const inserts = statements.filter((statement) => /INSERT INTO notifications/.test(statement.sql));
  assert.equal(inserts.length, 100, "capped at MAX_SUBSCRIPTION_FANOUT recipients");
  assert.equal(statements.length, 200, "one prune per recipient rides along");
  const recipients = inserts.map((statement) => Number(statement.values[0]));
  assert.equal(new Set(recipients).size, 100, "recipients stay unique");
  assert.deepEqual(recipients, ids.slice(0, 100), "oldest subscriptions first");
  // Exclusions never displace the next subscriber in line (cap runs AFTER
  // the exclusions are removed).
  const withExclusions = subscriptionFanOutStatements(db, [900, 901, ...ids], {
    replyAuthorId: 900, replyTargetId: 901, targetPostId: 1, replyId: 500, now: 1700000000,
  });
  assert.equal(
    withExclusions.filter((statement) => /INSERT INTO/.test(statement.sql)).length,
    100,
    "the two excluded members do not consume fan-out slots",
  );
});

test("runFanOutChunks splits large fan-outs into ≤50-statement best-effort chunks", async () => {
  const db = { prepare: (sql) => ({ sql, bind: (...v) => ({ sql, values: v }) }) };
  const statements = subscriptionFanOutStatements(db, Array.from({ length: 150 }, (_v, i) => i + 1), {
    replyAuthorId: 0, replyTargetId: 0, targetPostId: 1, replyId: 500, now: 1700000000,
  });
  const chunks = [];
  const chunkDb = {
    async batch(chunk) { chunks.push(chunk); return chunk.map(() => ({ meta: { changes: 1 } })); },
  };
  const delivered = await runFanOutChunks(chunkDb, statements);
  assert.equal(chunks.length, 4, "150 recipients = 300 statements = 4 chunks");
  for (const chunk of chunks) assert.ok(chunk.length <= 50, "no chunk exceeds 50 statements");
  assert.equal(delivered, 4);
  // Statements keep their order across the chunks (a chunk is a contiguous slice).
  assert.deepEqual(chunks.flat(), statements);
});

test("a mid-chunk failure does not prevent the later chunks' notifications", async () => {
  const db = { prepare: (sql) => ({ sql, bind: (...v) => ({ sql, values: v }) }) };
  const statements = subscriptionFanOutStatements(db, Array.from({ length: 40 }, (_v, i) => i + 1), {
    replyAuthorId: 0, replyTargetId: 0, targetPostId: 1, replyId: 500, now: 1700000000,
  });
  const attempted = [];
  const failingDb = {
    async batch(chunk) {
      attempted.push(chunk);
      // The FIRST chunk fails outright; every later chunk succeeds.
      if (attempted.length === 1) throw new Error("simulated chunk failure");
      return chunk.map(() => ({ meta: { changes: 1 } }));
    },
  };
  const delivered = await runFanOutChunks(failingDb, statements);
  assert.equal(attempted.length, 2, "40 recipients = 80 statements = 2 chunks attempted");
  assert.equal(delivered, 1, "the failure is contained: one chunk delivered");
  assert.deepEqual(attempted[1], statements.slice(50), "the second chunk still ran after the first failed");
});

// --- app.js source pins (node-unimportable) -----------------------------------

test("app.js wires the toggle-subscribe handler behind the shared click delegation", () => {
  const appJs = readFileSync(path.join(repoRoot, "public", "js", "app.js"), "utf8");
  // The click-delegation handler sends POST (subscribe) or DELETE keyed off
  // the payload flag, then re-renders the route so the state reloads.
  assert.match(appJs, /"toggle-subscribe": async \(\) => \{/);
  assert.match(appJs, /\/api\/posts\/" \+ button\.dataset\.postId \+ "\/subscribe", \{\s*method: subscribed \? "DELETE" : "POST",\s*\}\);/);
  assert.match(appJs, /await renderRoute\(activeRoute\);/);
});

test("the detail card renders the subscribe toggle for signed-in members only", async () => {
  const { createPostCard } = await import("../public/js/render.js");
  const mockDocument = {
    createElement: (tag) => makeMock(tag),
    createElementNS: (_ns, tag) => makeMock(tag),
    createTextNode: (text) => { const node = makeMock("#text"); node.textContent = text; return node; },
  };
  function makeMock(tag) {
    class MockElement2 {}
    const node = {
      tagName: tag.toUpperCase(), children: [], className: "", textContent: "",
      dataset: {}, attributes: {},
      append(...nodes) { for (const child of nodes) this.children.push(child); },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; },
      replaceChildren(...kept) { for (const child of kept) if (child) this.children.push(child); },
      get classList() {
        const self = this;
        return { add(name) { self.className = (self.className + " " + name).trim(); } };
      },
    };
    return node;
  }
  const detailRoot = {
    id: 1, publicLevel: 0, author: { username: "alice" },
    createdAt: "2026-10-16T00:00:00.000Z", body: "hi", subscribed: false,
  };
  const guest = createPostCard(detailRoot, mockDocument, null);
  assert.equal(
    [...walk(guest)].some((node) => node.dataset?.action === "toggle-subscribe"),
    false, "guests never get the button",
  );
  const subscribed = createPostCard({ ...detailRoot, subscribed: true }, mockDocument, { id: 7 });
  const button = [...walk(subscribed)].find((node) => node.dataset?.action === "toggle-subscribe");
  assert.ok(button, "signed-in members get the button");
  assert.equal(button.dataset.subscribed, "1");
  assert.match([...walk(button)].map((node) => node.textContent ?? "").join(""), /Subscribed/);
  assert.equal(button.getAttribute("aria-pressed"), "true");
  const unsubscribed = createPostCard({ ...detailRoot, subscribed: false }, mockDocument, { id: 7 });
  const off = [...walk(unsubscribed)].find((node) => node.dataset?.action === "toggle-subscribe");
  assert.equal(off.dataset.subscribed, "0");
  assert.equal(off.getAttribute("aria-pressed"), "false");
  // A feed card (no subscribed field) never shows the toggle.
  const feedCard = createPostCard({ ...detailRoot, subscribed: undefined }, mockDocument, { id: 7 });
  assert.equal([...walk(feedCard)].some((node) => node.dataset?.action === "toggle-subscribe"), false);

  function* walk(node) {
    yield node;
    for (const child of node.children ?? []) yield* walk(child);
  }
});
// --- fix round 1: the banned-member gate ----------------------------------------

test("a banned member cannot subscribe (403 before any read or write)", async () => {
  const mock = mockDb([
    sessionRoute(),
    { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: { id: 2 } },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/1/subscribe", "POST"),
    envFor(mock.db),
  );
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /banned/);
  // Gate order: the post read (and any INSERT) never runs for a banned member.
  assert.equal(mock.calls.some((call) => /FROM posts p/.test(call.sql)), false);
  assert.equal(mock.calls.some((call) => /INSERT INTO thread_subscriptions/.test(call.sql)), false);
});

test("the live reply route chunks a 150-subscriber fan-out (≤50 statements per batch)", async () => {
  const root = postRow({ id: "1", author_id: "3", parent_id: null });
  const subscribers = Array.from({ length: 150 }, (_v, i) => ({ user_id: String(10 + i) }));
  const mock = mockDb([
    sessionRoute(),
    banCheckRoute,
    { sql: /WHERE p\.id = \? LIMIT 1/, result: () => root },
    { sql: /FROM posts WHERE id = \? LIMIT 1/, result: () => root },
    banViewRouteOff,
    { sql: /SELECT user_id FROM thread_subscriptions/, rows: subscribers },
    { sql: /./ },
  ], { batchMeta: [{ meta: { changes: 1, last_row_id: 600 } }] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, action: "reply", hostname: "forum.example" }), { status: 200 });
  try {
    const response = await forumWorker.fetch(requestFor("https://forum.example/api/posts/1/replies", "POST", {
      body: "big thread",
      "cf-turnstile-response": "turnstile-token-fixture",
    }), envFor(mock.db));
    assert.equal(response.status, 201);
  } finally {
    globalThis.fetch = originalFetch;
  }
  // Batch 1: reply insert + bump. Then the fan-out runs as its OWN ≤50-statement
  // chunks: the author (7) and target (3) are excluded from the 150, leaving 100
  // capped recipients = 200 statements = 4 chunks (one of which may fail without
  // killing the rest — see the chunk tests above).
  assert.equal(mock.batches.length, 6);
  const fanoutChunks = mock.batches.slice(1);
  for (const chunk of fanoutChunks) assert.ok(chunk.length <= 50, "every route-level chunk ≤ 50 statements");
  // 2 (ordinary insert+prune) + 200 (100 capped recipients × 2) = 202 statements.
  assert.deepEqual(
    fanoutChunks.map((chunk) => chunk.length), [50, 50, 50, 50, 2],
  );
  const recipients = fanoutChunks.flat()
    .filter((statement) => /INSERT INTO notifications/.test(statement.sql))
    .map((statement) => Number(statement.values[0]));
  // 1 ordinary (the root author, id 3, not in the subscriber set) + 100 capped subscribers.
  assert.equal(recipients.length, 101);
  assert.equal(recipients.filter((id) => id === 3).length, 1, "the ordinary target notified once");
  assert.equal(new Set(recipients.filter((id) => id !== 3)).size, 100, "the subscriber cap applies at the route too");
  assert.ok(!recipients.includes(7), "the author stays excluded");
});
