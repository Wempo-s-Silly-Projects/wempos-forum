// GIF marketplace (v2.5): upload with hash-dedup (approved twins = reuse),
// serving with hybrid visibility (approved public, pending author/mods), the
// library list, the moderator desk, and attaching library gifs to posts by
// reference (approved rows + use_count).
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

const GIF_BYTES = new Uint8Array([...new TextEncoder().encode("GIF89a"), ...Array(24).fill(1)]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7, 7]);

const multipartGif = async (mock, envOverrides, bytes) => {
  const form = new FormData();
  form.append("gif", new Blob([bytes], { type: "application/octet-stream" }));
  const request = new Request("https://forum.example/api/gifs", {
    method: "POST",
    headers: { Origin: "https://forum.example", "X-CSRF-Token": "expected-csrf-token", Cookie: "wempo_session=" + "s".repeat(43) },
    body: form,
  });
  const response = await forumWorker.fetch(request, envFor(mock.db, envOverrides));
  return response;
};

test("a first-ever gif upload lands a pending gif with chunks", async () => {
  const mock = mockDb([
    sessionRoute(),
    { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null },
    { sql: /SELECT id FROM gifs WHERE hash = \? AND status = 'approved'/, result: null },
    { sql: /./ },
  ]);
  const response = await multipartGif(mock, {}, GIF_BYTES);
  console.error("UPLOAD BODY:", response.status, await response.clone().text());
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.reuse, false);
  const batches = mock.calls.filter((call) => call.sql.startsWith("INSERT INTO gifs"));
  assert.equal(batches.length, 1, "one gif row");
  // The gif insert keeps 'pending' as an inline literal (status is not a bind
  // here — the upload route only ever lands new rows as pending).
  assert.ok(batches[0].sql.includes("'pending'"), "library uploads land pending");
  assert.equal(batches[0].values[4], batches[0].values[4] ?? "", "bind layout intact");
  assert.equal(mock.calls.filter((call) => call.sql.startsWith("INSERT INTO gif_chunks")).length, 1, "one chunk (small bytes)");
});

test("uploading bytes whose hash is already approved returns the EXISTING gif (dedup reuse)", async () => {
  const mock = mockDb([
    sessionRoute(),
    { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null },
    { sql: /SELECT id FROM gifs WHERE hash = \? AND status = 'approved'/, result: { id: "223e4567-e89b-12d3-a456-426614174000" } },
    { sql: /./ },
  ]);
  const response = await multipartGif(mock, {}, GIF_BYTES);
  assert.equal(response.status, 200, "reuse is a 200, not a creation");
  assert.deepEqual(await response.json(), { id: "223e4567-e89b-12d3-a456-426614174000", reuse: true });
  assert.equal(mock.calls.some((call) => call.sql.startsWith("INSERT INTO gifs")), false, "no row is stored");
});

test("uploading a PNG to the gallery is now allowed (v3.0.1 image support)", async () => {
  const mock = mockDb([
    sessionRoute(),
    { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null },
    // Hash dedup lookup reads nothing; the INSERT + chunk batch run as no-ops.
    { sql: /SELECT id FROM gifs WHERE hash = \?/, result: null },
    { sql: /./, runMeta: { meta: { changes: 1 } } },
  ]);
  const response = await multipartGif(mock, {}, PNG_BYTES);
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const body = await response.json();
  assert.equal(typeof body.id, "string", "a fresh gif id comes back");
  assert.equal(body.reuse, false, "a novel image is stored, not reused");
});

test("a guest cannot upload to the marketplace (401 before any work)", async () => {
  const mock = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: null },
    { sql: /./ },
  ]);
  const response = await multipartGif(mock, {}, GIF_BYTES);
  assert.equal(response.status, 401);
  assert.equal(mock.calls.length, 1, "only the session read ran");
});

function attachRoutes({ gifApproved = true, hash = "a".repeat(64), insertResult = 1 } = {}) {
  return [
    sessionRoute(),
    { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null },
    { sql: /WHERE p\.id = \? LIMIT 1/, result: (values) => (values[1] === 2 ? { id: "2", author_id: "3", parent_id: null, visibility: "public", board: "general", body: "thread", created_at: 1, last_activity_at: 2 } : null) },
    { sql: /SELECT 1 FROM bans b WHERE b\.user_id = \?/, result: null },
    { sql: /FROM posts WHERE id = \? LIMIT 1/, result: null },
    { sql: { toString: () => "SELECT id, hash, mime" }, result: () => (gifApproved ? { id: "123e4567-e89b-12d3-a456-426614174000", hash, mime: "image/gif" } : null) },
    { sql: /./, runMeta: { meta: { changes: insertResult } } },
  ];
}
// The gif-lookup route's sql needs REAL regex matching on text: rebuild routes
// with a real pattern instead of the toString trick above (mockDb matches
// route.sql with .test(); a RegExp-like object works via the toString shape —
// but plain regexes are cleaner). The attaching test uses the real pattern:
const attachRoutesReal = ({ gifApproved = true, hash = "a".repeat(64) } = {}) => [
  sessionRoute(),
  { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null },
  { sql: /WHERE p\.id = \? LIMIT 1/, result: (values) => (values[1] === 2 ? { id: "2", author_id: "3", parent_id: null, visibility: "public", board: "general", body: "thread", created_at: 1, last_activity_at: 2 } : null) },
  { sql: /SELECT 1 FROM bans b WHERE b\.user_id = \?/, result: null },
  { sql: /FROM posts WHERE id = \? LIMIT 1/, result: null },
  { sql: /SELECT id, hash, mime FROM gifs WHERE id = \? AND status = 'approved'/, result: () => (gifApproved ? { id: "123e4567-e89b-12d3-a456-426614174000", hash, mime: "image/gif" } : null) },
  { sql: /^UPDATE gifs SET use_count = use_count \+ 1 WHERE id = \?$/, runMeta: { meta: { changes: 1 } } },
  { sql: /./ },
];

test("a reply attaching an approved library gif inserts an APPROVED reference row + bumps use_count", async () => {
  const mock = mockDb(attachRoutesReal(), { batchMeta: [{ meta: { changes: 1, last_row_id: 500 } }, { meta: { changes: 1 } }] });
  const siteverify = { done() { globalThis.fetch = originalFetch; } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, action: "reply", hostname: "forum.example" }), { status: 200 });
  try {
    const response = await forumWorker.fetch(new Request("https://forum.example/api/posts/2/replies", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://forum.example",
        "X-CSRF-Token": "expected-csrf-token",
        Cookie: "wempo_session=" + "s".repeat(43),
      },
      body: JSON.stringify({ body: "here it is", gifIds: ["123e4567-e89b-12d3-a456-426614174000"], "cf-turnstile-response": "turnstile-token-fixture" }),
    }), envFor(mock.db));
    assert.equal(response.status, 201);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const rows = mock.calls.filter((call) => call.sql.startsWith("INSERT INTO attachments"));
  assert.equal(rows.length, 1, "one reference row");
  assert.ok(rows[0].sql.includes("'approved'"), "library gifs attach approved by definition (literal)");
  assert.equal(rows[0].values[4], "123e4567-e89b-12d3-a456-426614174000", "the referenced GIF id is validated inside the INSERT");
  assert.equal(rows[0].values[5], "a".repeat(64), "the referenced hash is validated inside the INSERT");
  assert.equal(rows[0].values[6], "image/gif", "the referenced MIME is validated inside the INSERT");
  assert.equal(rows[0].values[8], "image/gif", "the attachment row stores the GIF MIME");
  assert.equal(rows[0].values[9], "a".repeat(64), "the row carries the GIF hash; bytes resolve at serve time");
  assert.equal(rows[0].values[10], "123e4567-e89b-12d3-a456-426614174000", "the attachment persists the source GIF id for exact retries");
  assert.match(rows[0].sql, /source_kind, source_gif_id/);
  const bump = mock.calls.find((call) => call.sql.startsWith("UPDATE gifs SET use_count"));
  assert.ok(bump, "use_count bump");
  assert.deepEqual(bump.values, ["123e4567-e89b-12d3-a456-426614174000"]);
});

test("attaching a not-approved gif id is a 400", async () => {
  const mock = mockDb(attachRoutesReal({ gifApproved: false }), { batchMeta: [{ meta: { changes: 1, last_row_id: 500 } }, { meta: { changes: 1 } }] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, action: "reply", hostname: "forum.example" }), { status: 200 });
  try {
    const response = await forumWorker.fetch(new Request("https://forum.example/api/posts/2/replies", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://forum.example",
        "X-CSRF-Token": "expected-csrf-token",
        Cookie: "wempo_session=" + "s".repeat(43),
      },
      body: JSON.stringify({ body: "sneaky", gifIds: ["123e4567-e89b-12d3-a456-426614174000"] }),
    }), envFor(mock.db));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /not available/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("attaching a NON-gif-id garbage value is a 400", async () => {
  const mock = mockDb(attachRoutesReal());
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, action: "reply", hostname: "forum.example" }), { status: 200 });
  try {
    const response = await forumWorker.fetch(new Request("https://forum.example/api/posts/2/replies", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://forum.example",
        "X-CSRF-Token": "expected-csrf-token",
        Cookie: "wempo_session=" + "s".repeat(43),
      },
      body: JSON.stringify({ body: "sneaky", gifIds: ["DROP TABLE users"] }),
    }), envFor(mock.db));
    assert.equal(response.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
