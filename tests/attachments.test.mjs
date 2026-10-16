// Unit tests for sniffImageMime (api/shared.mjs), the upload magic-byte gate.
// Later attachments tasks append to this file; keep it a plain unit test of
// the export with no worker fetch.
import test from "node:test";
import assert from "node:assert/strict";
import forumWorker from "../worker.mjs";
import { sniffImageMime } from "../api/shared.mjs";
import {
  MAX_ATTACHMENT_FILES,
  MAX_ATTACHMENT_REQUEST_BYTES,
  insertAttachments,
} from "../api/attachments.mjs";

test("accepts a GIF89a header as image/gif", () => {
  const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]);
  assert.equal(sniffImageMime(bytes), "image/gif");
});

test("accepts a GIF87a header as image/gif", () => {
  const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]);
  assert.equal(sniffImageMime(bytes), "image/gif");
});

test("rejects a header-mutated GIF signature (GIF8\\x00\\x00)", () => {
  const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]);
  assert.equal(sniffImageMime(bytes), null);
});

test("rejects a 5-byte GIF header (below the 12-byte minimum)", () => {
  const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39]);
  assert.equal(sniffImageMime(bytes), null);
});

test("keeps pinning the JPEG, PNG, and WebP happy paths", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(sniffImageMime(jpeg), "image/jpeg");
  assert.equal(sniffImageMime(png), "image/png");
  assert.equal(sniffImageMime(webp), "image/webp");
});

// ---------------------------------------------------------------------------
// Task 3: multipart attachment intake on post and reply creation, driven
// through forumWorker.fetch with the mock-Db pattern from tests/moderation-v2
// and tests/threading.
// ---------------------------------------------------------------------------

const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

function sniffedBytes(n, header) {
  const bytes = new Uint8Array(n);
  bytes.set(header);
  for (let i = 12; i < n; i++) bytes[i] = i & 0xff;
  return bytes;
}

const GIF_BYTES = sniffedBytes(64, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0]);
const PNG_BYTES = sniffedBytes(64, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG_ONE_MIB = sniffedBytes(1024 * 1024, JPEG_BYTES);
const GIF_ONE_MIB = sniffedBytes(1024 * 1024, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0]);
const GIF_OVER_ONE_MIB = sniffedBytes(1024 * 1024 + 51200, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0]);

// D1 mock: routes are { sql: RegExp, result?, rows?, runMeta? }. prepare()
// picks the first route whose regex matches the SQL (last route is the
// fallback). Copied from tests/threading.test.mjs.
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
          calls.push({ sql, values });
          return {
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
                : route.runMeta;
            },
          };
        },
      };
    },
    async batch(statements) {
      batches.push(statements);
      return statements.map((statement, index) =>
        (batchMeta && batchMeta[index]) || { meta: { changes: 1 } });
    },
  };
  return { db, calls, batches };
}

function successLimiter(counter) {
  return {
    calls: counter,
    async limit() {
      counter.count += 1;
      return { success: true };
    },
  };
}

function envFor(db, overrides = {}) {
  return {
    FORUM_DB: db,
    READ_RATE_LIMITER: successLimiter({ count: 0 }),
    WRITE_RATE_LIMITER: successLimiter({ count: 0 }),
    POST_WRITE_RATE_LIMITER: successLimiter({ count: 0 }),
    IMAGE_UPLOAD_RATE_LIMITER: successLimiter({ count: 0 }),
    TURNSTILE_SECRET: "turnstile-secret-fixture",
    TURNSTILE_HOSTNAMES: "forum.example",
    FILTERED_WORDS: "",
    ...overrides,
  };
}

function sessionRow(overrides = {}) {
  return {
    token_hash: "a".repeat(64),
    user_id: 7,
    csrf_token: "expected-csrf-token",
    expires_at: Math.floor(Date.now() / 1000) + 60,
    username: "test_user",
    role: "member",
    bio: "",
    avatar_status: null,
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

const sessionRoute = { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow() };
const banCheckRoute = { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null };
const postInsertRoute = {
  sql: /INSERT INTO posts \(author_id, parent_id, body, visibility, created_at, last_activity_at\)/,
  runMeta: { meta: { changes: 1, last_row_id: 42 } },
};

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

async function multipartPost(routes, env, files, fields = {}) {
  const form = new FormData();
  form.append("body", "a post with pictures");
  form.append("cf-turnstile-response", "turnstile-token-fixture");
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  for (const file of files) {
    form.append("images", new File([file.bytes], file.name, { type: "application/octet-stream" }));
  }
  const request = new Request("https://forum.example/api/posts", {
    method: "POST",
    headers: {
      Origin: "https://forum.example",
      "X-CSRF-Token": "expected-csrf-token",
      Cookie: "wempo_session=" + "s".repeat(43),
    },
    body: form,
  });
  const response = await forumWorker.fetch(request, env);
  return { response, calls: routes.calls };
}

async function multipartReply(routes, env, files) {
  const form = new FormData();
  form.append("body", "a reply with pictures");
  form.append("cf-turnstile-response", "turnstile-token-fixture");
  for (const file of files) {
    form.append("images", new File([file.bytes], file.name, { type: "application/octet-stream" }));
  }
  const request = new Request("https://forum.example/api/posts/2/replies", {
    method: "POST",
    headers: {
      Origin: "https://forum.example",
      "X-CSRF-Token": "expected-csrf-token",
      Cookie: "wempo_session=" + "s".repeat(43),
    },
    body: form,
  });
  const response = await forumWorker.fetch(request, env);
  return { response, calls: routes.calls };
}

function attachmentCalls(calls) {
  return calls.filter((entry) => entry.sql.startsWith("INSERT INTO attachments"));
}

test("a multipart post with one GIF file creates the post and one pending attachment row", async () => {
  const mock = mockDb([sessionRoute, banCheckRoute, postInsertRoute, { sql: /./ }]);
  const siteverify = withMockedSiteverify({ success: true, action: "post", hostname: "forum.example" });
  let response;
  try {
    ({ response } = await multipartPost(
      mock,
      envFor(mock.db),
      [{ bytes: GIF_BYTES, name: "funny.gif" }],
    ));
  } finally {
    siteverify.done();
  }

  assert.equal(response.status, 201);
  const postInsert = mock.calls.find((entry) => entry.sql.startsWith("INSERT INTO posts"));
  assert.ok(postInsert, "the post must be inserted");
  const inserts = attachmentCalls(mock.calls);
  assert.equal(inserts.length, 1, "one attachment row must be inserted");
  // Mime must come from sniffImageMime, not the client's declared type.
  assert.equal(inserts[0].values[5], "image/gif");
  assert.ok(inserts[0].sql.includes("status, version"), "attachment insert sets the schema columns");
  assert.ok(inserts[0].sql.includes("'pending'"), "new attachments are always pending");
  assert.equal(inserts[0].values[1], 42, "attachment binds the inserted post's row id");
  assert.equal(inserts[0].values[2], 7, "attachment records the uploading account");
});

test("a .png-named JPEG binds image/jpeg — the sniff decides, not the filename", async () => {
  const mock = mockDb([sessionRoute, banCheckRoute, postInsertRoute, { sql: /./ }]);
  const siteverify = withMockedSiteverify({ success: true, action: "post", hostname: "forum.example" });
  let response;
  try {
    ({ response } = await multipartPost(
      mock,
      envFor(mock.db),
      [{ bytes: JPEG_BYTES, name: "actually-a-jpeg.png" }],
    ));
  } finally {
    siteverify.done();
  }

  assert.equal(response.status, 201);
  const inserts = attachmentCalls(mock.calls);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].values[5], "image/jpeg");
});

test("non-image bytes are refused with 400 and never insert anything", async () => {
  const mock = mockDb([sessionRoute, banCheckRoute, postInsertRoute, { sql: /./ }]);
  const siteverify = withMockedSiteverify({ success: true, action: "post", hostname: "forum.example" });
  let response;
  try {
    ({ response } = await multipartPost(
      mock,
      envFor(mock.db),
      [{ bytes: new TextEncoder().encode("definitely not an image at all"), name: "notes.txt" }],
    ));
  } finally {
    siteverify.done();
  }

  assert.equal(response.status, 400);
  assert.equal(attachmentCalls(mock.calls).length, 0);
  assert.equal(mock.calls.filter((entry) => entry.sql.startsWith("INSERT INTO posts")).length, 0);
});

test("more than MAX_ATTACHMENT_FILES files is a 400 before any insert", async () => {
  const files = [];
  for (let i = 0; i < MAX_ATTACHMENT_FILES + 1; i++) {
    files.push({ bytes: GIF_BYTES, name: "pic" + i + ".gif" });
  }
  const mock = mockDb([sessionRoute, banCheckRoute, postInsertRoute, { sql: /./ }]);
  const siteverify = withMockedSiteverify({ success: true, action: "post", hostname: "forum.example" });
  let response;
  try {
    ({ response } = await multipartPost(mock, envFor(mock.db), files));
  } finally {
    siteverify.done();
  }

  assert.equal(response.status, 400);
  assert.equal(mock.calls.filter((entry) => entry.sql.startsWith("INSERT INTO posts")).length, 0);
  assert.equal(attachmentCalls(mock.calls).length, 0);
});

test("a single file above MAX_ATTACHMENT_BYTES is a 413", async () => {
  const mock = mockDb([sessionRoute, banCheckRoute, postInsertRoute, { sql: /./ }]);
  const siteverify = withMockedSiteverify({ success: true, action: "post", hostname: "forum.example" });
  let response;
  try {
    ({ response } = await multipartPost(
      mock,
      envFor(mock.db),
      [{ bytes: GIF_OVER_ONE_MIB, name: "huge.gif" }],
    ));
  } finally {
    siteverify.done();
  }

  assert.equal(response.status, 413);
  assert.equal(mock.calls.filter((entry) => entry.sql.startsWith("INSERT INTO posts")).length, 0);
});

// Review Focus #1: the per-file gate cannot catch a request whose TOTAL body
// (files + multipart overhead) exceeds MAX_ATTACHMENT_REQUEST_BYTES, so all
// three valid 1 MiB files ride at the edge — a fourth one must trip the
// request ceiling with 413 BEFORE any post INSERT exists.
test("a request body at/above the attachment ceiling is a 413 with no posts INSERT", async () => {
  const files = [
    { bytes: JPEG_ONE_MIB, name: "one.jpg" },
    { bytes: JPEG_ONE_MIB, name: "two.jpg" },
    { bytes: JPEG_ONE_MIB, name: "three.jpg" },
    { bytes: GIF_ONE_MIB, name: "four.gif" },
  ];
  const mock = mockDb([sessionRoute, banCheckRoute, postInsertRoute, { sql: /./ }]);
  const siteverify = withMockedSiteverify({ success: true, action: "post", hostname: "forum.example" });
  let response;
  try {
    ({ response } = await multipartPost(mock, envFor(mock.db), files));
  } finally {
    siteverify.done();
  }

  assert.equal(response.status, 413);
  assert.equal(
    mock.calls.filter((entry) => entry.sql.startsWith("INSERT INTO posts")).length,
    0,
    "no posts INSERT may run when the request body exceeds the ceiling",
  );
  assert.equal(attachmentCalls(mock.calls).length, 0);
  assert.ok(MAX_ATTACHMENT_REQUEST_BYTES >= 3 * 1024 * 1024);
});

test("a JSON post body without files still creates a post (backward compat)", async () => {
  const mock = mockDb([sessionRoute, banCheckRoute, postInsertRoute, { sql: /./ }]);
  const siteverify = withMockedSiteverify({ success: true, action: "post", hostname: "forum.example" });
  let response;
  try {
    response = await forumWorker.fetch(
      new Request("https://forum.example/api/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://forum.example",
          "X-CSRF-Token": "expected-csrf-token",
          Cookie: "wempo_session=" + "s".repeat(43),
        },
        body: JSON.stringify({
          body: "plain json post",
          "cf-turnstile-response": "turnstile-token-fixture",
        }),
      }),
      envFor(mock.db),
    );
  } finally {
    siteverify.done();
  }

  assert.equal(response.status, 201);
  const postInsert = mock.calls.find((entry) => entry.sql.startsWith("INSERT INTO posts"));
  assert.ok(postInsert);
  assert.equal(attachmentCalls(mock.calls).length, 0);
});

test("multipart reply creation attaches to the REPLY's own row id", async () => {
  const root = postRow();
  const mock = mockDb([
    sessionRoute,
    banCheckRoute,
    { sql: /WHERE p\.id = \? LIMIT 1/, result: (values) => (values[1] === 2 ? root : null) },
    { sql: /./ },
  ], { batchMeta: [{ meta: { changes: 1, last_row_id: 500 } }] });
  const siteverify = withMockedSiteverify({ success: true, action: "reply", hostname: "forum.example" });
  let response;
  try {
    ({ response } = await multipartReply(
      mock,
      envFor(mock.db),
      [{ bytes: PNG_BYTES, name: "shot.png" }],
    ));
  } finally {
    siteverify.done();
  }

  assert.equal(response.status, 201);
  const inserts = attachmentCalls(mock.calls);
  assert.equal(inserts.length, 1, "one attachment row must be inserted for the reply");
  assert.equal(inserts[0].values[1], 500, "post_id must be the reply's own row id, not the bump target");
  assert.equal(inserts[0].values[5], "image/png");
});

// ---------------------------------------------------------------------------
// Task 4: GET /api/attachments/:id serving with hybrid visibility, driven
// through forumWorker.fetch with the mock-Db pattern from Task 3 above.
// ---------------------------------------------------------------------------

const ATTACHMENT_ID = "3f2a7c94-9b1e-4d58-8c1a-7e0d5b9f2a41";

function attachmentRow(overrides = {}) {
  return {
    id: ATTACHMENT_ID,
    status: "pending",
    created_by: 7,
    mime: null,
    data: null,
    pending_mime: "image/gif",
    pending_data: GIF_BYTES,
    ...overrides,
  };
}

function attachmentRoute(row) {
  return { sql: /FROM attachments WHERE id = \?/, result: row };
}

function attachmentGetRequest(id, { cookie = false } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = "wempo_session=" + "s".repeat(43);
  return new Request("https://forum.example/api/attachments/" + id, { headers });
}

async function bodyBytes(response) {
  return new Uint8Array(await response.arrayBuffer());
}

test("an approved attachment serves its stored bytes and mime publicly with an immutable cache", async () => {
  const row = attachmentRow({
    status: "approved",
    mime: "image/png",
    data: PNG_BYTES,
    pending_mime: null,
    pending_data: null,
  });
  const mock = mockDb([sessionRoute, attachmentRoute(row), { sql: /./ }]);
  const response = await forumWorker.fetch(
    attachmentGetRequest(ATTACHMENT_ID),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await bodyBytes(response), PNG_BYTES);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("an approved attachment serves the same bytes regardless of the ?v= cache buster", async () => {
  const row = attachmentRow({
    status: "approved",
    mime: "image/png",
    data: PNG_BYTES,
    pending_mime: null,
    pending_data: null,
  });
  const mock = mockDb([sessionRoute, attachmentRoute(row), { sql: /./ }]);
  const response = await forumWorker.fetch(
    attachmentGetRequest(ATTACHMENT_ID + "?v=version-stale-or-absent"),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await bodyBytes(response), PNG_BYTES);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
});

test("an author can read their own pending attachment with the pending pair and private cache", async () => {
  const mock = mockDb([
    sessionRoute, // sessionRow() is user_id 7 / member — the attachment's author
    attachmentRoute(attachmentRow()),
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    attachmentGetRequest(ATTACHMENT_ID, { cookie: true }),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await bodyBytes(response), GIF_BYTES);
  assert.equal(response.headers.get("Content-Type"), "image/gif", "the pending pair's sniffed mime is served");
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=300");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("a second member gets a 404 for someone else's pending attachment", async () => {
  const mock = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ user_id: 8, role: "member" }) },
    attachmentRoute(attachmentRow()),
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    attachmentGetRequest(ATTACHMENT_ID, { cookie: true }),
    envFor(mock.db),
  );

  assert.equal(response.status, 404);
});

test("a guest gets a 404 for a pending attachment", async () => {
  const mock = mockDb([sessionRoute, attachmentRoute(attachmentRow()), { sql: /./ }]);
  const response = await forumWorker.fetch(
    attachmentGetRequest(ATTACHMENT_ID),
    envFor(mock.db),
  );

  assert.equal(response.status, 404);
});

test("a moderator can read a pending attachment", async () => {
  const mock = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ user_id: 8, role: "moderator" }) },
    attachmentRoute(attachmentRow()),
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    attachmentGetRequest(ATTACHMENT_ID, { cookie: true }),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await bodyBytes(response), GIF_BYTES);
  assert.equal(response.headers.get("Content-Type"), "image/gif");
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=300");
});

test("a rejected attachment is a 404 even for its author", async () => {
  const mock = mockDb([
    sessionRoute,
    attachmentRoute(attachmentRow({
      status: "rejected",
      pending_mime: null,
      pending_data: null,
    })),
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    attachmentGetRequest(ATTACHMENT_ID, { cookie: true }),
    envFor(mock.db),
  );

  assert.equal(response.status, 404);
});

test("an unknown attachment id is a 404", async () => {
  const mock = mockDb([sessionRoute, attachmentRoute(null), { sql: /./ }]);
  const response = await forumWorker.fetch(
    attachmentGetRequest("0e1f2a3b-4c5d-4e6f-8a9b-1c2d3e4f5a6b"),
    envFor(mock.db),
  );

  assert.equal(response.status, 404);
});

test("non-GET methods on the attachment route are a 405 before any database read", async () => {
  const mock = mockDb([{ sql: /./ }]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/attachments/" + ATTACHMENT_ID, { method: "POST" }),
    envFor(mock.db),
  );

  assert.equal(response.status, 405);
  assert.equal(mock.calls.length, 0, "no attachment lookup may run for a non-GET method");
});

test("image-upload limiter runs once per multipart post and never for JSON posts", async () => {
  const multipartMock = mockDb([sessionRoute, banCheckRoute, postInsertRoute, { sql: /./ }]);
  const imageCounter = { count: 0 };
  const siteverify = withMockedSiteverify({ success: true, action: "post", hostname: "forum.example" });
  let multipartResponse;
  try {
    ({ response: multipartResponse } = await multipartPost(
      multipartMock,
      envFor(multipartMock.db, { IMAGE_UPLOAD_RATE_LIMITER: successLimiter(imageCounter) }),
      [{ bytes: GIF_BYTES, name: "funny.gif" }],
    ));
  } finally {
    siteverify.done();
  }
  assert.equal(multipartResponse.status, 201);
  assert.equal(imageCounter.count, 1, "attachment-bearing posts hit the image-upload limiter once");

  const jsonMock = mockDb([sessionRoute, banCheckRoute, postInsertRoute, { sql: /./ }]);
  const jsonCounter = { count: 0 };
  const jsonSiteverify = withMockedSiteverify({ success: true, action: "post", hostname: "forum.example" });
  let jsonResponse;
  try {
    jsonResponse = await forumWorker.fetch(
      new Request("https://forum.example/api/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://forum.example",
          "X-CSRF-Token": "expected-csrf-token",
          Cookie: "wempo_session=" + "s".repeat(43),
        },
        body: JSON.stringify({
          body: "no files here",
          "cf-turnstile-response": "turnstile-token-fixture",
        }),
      }),
      envFor(jsonMock.db, { IMAGE_UPLOAD_RATE_LIMITER: successLimiter(jsonCounter) }),
    );
  } finally {
    jsonSiteverify.done();
  }
  assert.equal(jsonResponse.status, 201);
  assert.equal(jsonCounter.count, 0, "file-less JSON posts must skip the image-upload limiter");
});

// ---------------------------------------------------------------------------
// Task 5: attachment metadata on post reads. Every serialized post (feed,
// replies page, detail) carries an `attachments` array — approved rows for
// everyone, pending rows ONLY for the uploading account or a moderator/admin,
// rejected rows omitted for everyone. Pending rows a viewer is allowed to see
// carry awaiting: true; approved rows always carry awaiting: false. Driven
// through forumWorker.fetch with the same mock-Db pattern as above.
// ---------------------------------------------------------------------------

const ATTACHMENT_VERSION = "abcdef123456";

function attachmentMetaRow(overrides = {}) {
  return {
    id: ATTACHMENT_ID,
    post_id: 5,
    status: "pending",
    created_by: 7,
    version: ATTACHMENT_VERSION,
    mime: null,
    pending_mime: "image/gif",
    ...overrides,
  };
}

// The read-side helper issues ONE batched lookup for the whole page.
const ATTACHMENTS_FOR_POSTS_SQL = /FROM attachments WHERE post_id IN \(/;

function postRowForDetail() {
  return postRow({ id: "5" });
}

function postReadRoutes({ session = sessionRoute, attachmentRows = [] } = {}) {
  return [
    session,
    { sql: /WHERE p\.id = \? LIMIT 1/, result: (values) => (values[1] === 5 ? postRowForDetail() : null) },
    { sql: /WHERE p\.parent_id = \?/, rows: [] },
    { sql: ATTACHMENTS_FOR_POSTS_SQL, rows: attachmentRows },
    { sql: /./ },
  ];
}

function postDetailRequest(postId, { cookie = false } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = "wempo_session=" + "s".repeat(43);
  return new Request("https://forum.example/api/posts/" + postId, { headers });
}

async function postDetailBody(routes, { signedIn = true } = {}) {
  const response = await forumWorker.fetch(
    postDetailRequest(5, { cookie: signedIn }),
    envFor(routes.db),
  );
  assert.equal(response.status, 200);
  return response.json();
}

test("a detail read as the uploader lists their pending attachment with awaiting true", async () => {
  // sessionRow() is user_id 7; the attachment's created_by is 7 too.
  const mock = mockDb(postReadRoutes({
    attachmentRows: [attachmentMetaRow({ status: "pending", created_by: 7 })],
  }));
  const body = await postDetailBody(mock);

  assert.deepEqual(body.attachments, [
    { id: ATTACHMENT_ID, status: "pending", mime: "image/gif", version: ATTACHMENT_VERSION, awaiting: true },
  ]);
});

test("the same detail read as another member shows attachments: [] — pending rows must not leak metadata", async () => {
  const mock = mockDb(postReadRoutes({
    session: { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ user_id: 8, role: "member" }) },
    attachmentRows: [attachmentMetaRow({ status: "pending", created_by: 7 })],
  }));
  const body = await postDetailBody(mock);

  assert.deepEqual(body.attachments, []);
});

test("after approval a non-author sees the row with awaiting false", async () => {
  const mock = mockDb(postReadRoutes({
    session: { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ user_id: 8, role: "member" }) },
    attachmentRows: [attachmentMetaRow({
      status: "approved",
      created_by: 7,
      mime: "image/png",
      pending_mime: null,
    })],
  }));
  const body = await postDetailBody(mock);

  assert.deepEqual(body.attachments, [
    { id: ATTACHMENT_ID, status: "approved", mime: "image/png", version: ATTACHMENT_VERSION, awaiting: false },
  ]);
});

test("a guest detail read never sees pending metadata", async () => {
  const mock = mockDb(postReadRoutes({
    session: { sql: /FROM sessions s LEFT JOIN users u/, result: null },
    attachmentRows: [attachmentMetaRow({ status: "pending", created_by: 7 })],
  }));
  const response = await forumWorker.fetch(postDetailRequest(5), envFor(mock.db));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.attachments, []);
});

test("a moderator sees someone else's pending attachment with awaiting true", async () => {
  const mock = mockDb(postReadRoutes({
    session: { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ user_id: 8, role: "moderator" }) },
    attachmentRows: [attachmentMetaRow({ status: "pending", created_by: 7 })],
  }));
  const body = await postDetailBody(mock);

  assert.deepEqual(body.attachments, [
    { id: ATTACHMENT_ID, status: "pending", mime: "image/gif", version: ATTACHMENT_VERSION, awaiting: true },
  ]);
});

test("rejected attachments are omitted from metadata even for their author", async () => {
  const mock = mockDb(postReadRoutes({
    session: { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ user_id: 7, role: "admin" }) },
    attachmentRows: [attachmentMetaRow({
      status: "rejected",
      created_by: 7,
      pending_mime: null,
    })],
  }));
  const body = await postDetailBody(mock);

  assert.deepEqual(body.attachments, []);
});

test("feed rows carry an approved attachment's id, version, and awaiting flag", async () => {
  const feedPost = postRow({ id: "9" });
  const mock = mockDb([
    sessionRoute, // never read: the feed request is a guest read
    { sql: /FROM posts p JOIN users u/, rows: [feedPost] },
    { sql: ATTACHMENTS_FOR_POSTS_SQL, rows: [attachmentMetaRow({
      id: ATTACHMENT_ID,
      post_id: "9",
      status: "approved",
      mime: "image/gif",
      pending_mime: null,
    })] },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/posts"),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.posts.length, 1);
  assert.deepEqual(body.posts[0].attachments, [
    { id: ATTACHMENT_ID, status: "approved", mime: "image/gif", version: ATTACHMENT_VERSION, awaiting: false },
  ]);
  // One batched attachments lookup for the whole feed page — never per post.
  assert.equal(
    mock.calls.filter((call) => ATTACHMENTS_FOR_POSTS_SQL.test(call.sql)).length,
    1,
  );
  assert.ok(
    mock.calls.filter((call) => ATTACHMENTS_FOR_POSTS_SQL.test(call.sql))[0].sql.includes("(?)"),
    "the IN list has one placeholder per shown post id",
  );
});

// ---------------------------------------------------------------------------
// Task 6: the moderator queue — GET /api/admin/attachments, then POST
// /api/admin/attachments/:id/approve and .../reject. Same mock-Db pattern as
// above; role gates mirror the avatar moderation routes in api/moderation.mjs.
// ---------------------------------------------------------------------------

function moderatorRow(overrides = {}) {
  return sessionRow({ user_id: 8, role: "moderator", ...overrides });
}

const moderatorSessionRoute = {
  sql: /FROM sessions s LEFT JOIN users u/,
  result: moderatorRow(),
};

function adminActionRequest(id, action) {
  return new Request("https://forum.example/api/admin/attachments/" + id + "/" + action, {
    method: "POST",
    headers: {
      Origin: "https://forum.example",
      "X-CSRF-Token": "expected-csrf-token",
      Cookie: "wempo_session=" + "s".repeat(43),
    },
  });
}

// Queue row shape: size has NO column — the controller ruling is that
// sizeBytes comes from length(pending_data), computed in SQL.
const QUEUE_ROW = {
  id: ATTACHMENT_ID,
  post_id: 5,
  pending_mime: "image/gif",
  pending_updated_at: 1700000000,
  uploader: "uploader_one",
  size_bytes: GIF_BYTES.length,
};

const ATTACHMENT_QUEUE_SQL =
  /FROM attachments a JOIN users u .* WHERE a\.status = 'pending'/s;

test(
  "the moderation queue lists pending attachments oldest-first with uploader, mime, and blob size",
  async () => {
    const mock = mockDb([moderatorSessionRoute, { sql: ATTACHMENT_QUEUE_SQL, rows: [QUEUE_ROW] }, { sql: /./ }]);
    const response = await forumWorker.fetch(
      new Request("https://forum.example/api/admin/attachments", {
        headers: { Cookie: "wempo_session=" + "s".repeat(43) },
      }),
      envFor(mock.db),
    );

    assert.equal(response.status, 200);
    const queueCall = mock.calls.find((call) => ATTACHMENT_QUEUE_SQL.test(call.sql));
    assert.ok(queueCall, "the queue lookup must run");
    // Oldest first, capped at 100, size computed from the pending blob.
    assert.ok(queueCall.sql.includes("ORDER BY a.pending_updated_at ASC"));
    assert.ok(queueCall.sql.includes("LIMIT 100"));
    assert.ok(queueCall.sql.includes("length(a.pending_data) AS size_bytes"));
    assert.ok(queueCall.values.length === 0, "the queue lookup binds no values");
    const body = await response.json();
    assert.deepEqual(body.attachments, [
      {
        id: ATTACHMENT_ID,
        postId: 5,
        uploader: "uploader_one",
        mime: "image/gif",
        sizeBytes: GIF_BYTES.length,
        createdAt: new Date(1700000000 * 1000).toISOString(),
      },
    ]);
  },
);

test("a member gets a 403 from the moderation queue", async () => {
  const mock = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ user_id: 8, role: "member" }) },
    { sql: ATTACHMENT_QUEUE_SQL, rows: [QUEUE_ROW] },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/admin/attachments", {
      headers: { Cookie: "wempo_session=" + "s".repeat(43) },
    }),
    envFor(mock.db),
  );
  assert.equal(response.status, 403);
});

test("a guest gets a 401 from the moderation queue", async () => {
  const mock = mockDb([{ sql: ATTACHMENT_QUEUE_SQL, rows: [QUEUE_ROW] }, { sql: /./ }]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/admin/attachments"),
    envFor(mock.db),
  );
  assert.equal(response.status, 401);
});

test("a member gets a 403 from attachment approve and no UPDATE runs", async () => {
  const mock = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ user_id: 8, role: "member" }) },
    { sql: /^UPDATE attachments SET/, runMeta: { meta: { changes: 1 } } },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    adminActionRequest(ATTACHMENT_ID, "approve"),
    envFor(mock.db),
  );
  assert.equal(response.status, 403);
  assert.equal(mock.calls.filter((call) => call.sql.startsWith("UPDATE attachments")).length, 0);
});

test("a guest gets a 401 from attachment approve", async () => {
  const mock = mockDb([
    { sql: /^UPDATE attachments SET/, runMeta: { meta: { changes: 1 } } },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    adminActionRequest(ATTACHMENT_ID, "approve"),
    envFor(mock.db),
  );
  assert.equal(response.status, 401);
});

const OLD_VERSION = ATTACHMENT_VERSION;

test("approving copies the pending pair into the approved pair, clears pending, and bumps the version", async () => {
  const mock = mockDb([
    moderatorSessionRoute,
    banCheckRoute,
    { sql: /^UPDATE attachments SET/, runMeta: { meta: { changes: 1 } } },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    adminActionRequest(ATTACHMENT_ID, "approve"),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { approved: true, id: ATTACHMENT_ID });
  const approveCall = mock.calls.find((call) => call.sql.startsWith("UPDATE attachments"));
  assert.ok(approveCall, "the approve UPDATE must run");
  // Mirrors the avatar approve: pending pair copies into the approved pair and
  // pending clears in ONE statement evaluated against the pre-update row.
  assert.ok(approveCall.sql.includes("mime = pending_mime"));
  assert.ok(approveCall.sql.includes("data = pending_data"));
  assert.ok(approveCall.sql.includes("updated_at = pending_updated_at"));
  assert.ok(approveCall.sql.includes("pending_mime = NULL"));
  assert.ok(approveCall.sql.includes("pending_data = NULL"));
  assert.ok(approveCall.sql.includes("pending_updated_at = NULL"));
  assert.ok(approveCall.sql.includes("status = 'approved'"));
  // Guarded so a non-pending id can never be double-approved.
  assert.ok(approveCall.sql.includes("WHERE id = ? AND status = 'pending'"));
  // Unlike the avatar approve (which keeps the pending version), attachments
  // bump to a fresh random version — the approved URL's cache buster moves.
  const [newVersion, boundId] = approveCall.values;
  assert.notEqual(newVersion, OLD_VERSION, "approval must bump the version");
  assert.match(newVersion, /^[A-Za-z0-9_-]{16}$/, "the new version is a random 12-byte token");
  assert.equal(boundId, ATTACHMENT_ID);
  // A moderator action must be gated against active bans, like the avatar desk.
  assert.ok(mock.calls.some((call) => /^SELECT id FROM bans WHERE user_id = \?/.test(call.sql)));
});

test("rejecting clears the pending bytes and marks the row rejected", async () => {
  const mock = mockDb([
    moderatorSessionRoute,
    banCheckRoute,
    { sql: /^UPDATE attachments SET/, runMeta: { meta: { changes: 1 } } },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    adminActionRequest(ATTACHMENT_ID, "reject"),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { rejected: true, id: ATTACHMENT_ID });
  const rejectCall = mock.calls.find((call) => call.sql.startsWith("UPDATE attachments"));
  assert.ok(rejectCall, "the reject UPDATE must run");
  assert.ok(rejectCall.sql.includes("pending_mime = NULL"));
  assert.ok(rejectCall.sql.includes("pending_data = NULL"));
  assert.ok(rejectCall.sql.includes("pending_updated_at = NULL"));
  assert.ok(rejectCall.sql.includes("status = 'rejected'"));
  assert.ok(rejectCall.sql.includes("WHERE id = ? AND status = 'pending'"));
  assert.deepEqual(rejectCall.values, [ATTACHMENT_ID]);
});

test("after approval the row is gone from the queue on re-listing", async () => {
  let pendingQueueRows = [QUEUE_ROW];
  const queueRoute = {
    sql: ATTACHMENT_QUEUE_SQL,
    get rows() {
      return pendingQueueRows;
    },
  };
  const mock = mockDb([
    moderatorSessionRoute,
    banCheckRoute,
    { sql: /^UPDATE attachments SET/, runMeta: { meta: { changes: 1 } } },
    queueRoute,
    { sql: /./ },
  ]);

  const approveResponse = await forumWorker.fetch(
    adminActionRequest(ATTACHMENT_ID, "approve"),
    envFor(mock.db),
  );
  assert.equal(approveResponse.status, 200);
  pendingQueueRows = [];

  const listResponse = await forumWorker.fetch(
    new Request("https://forum.example/api/admin/attachments", {
      headers: { Cookie: "wempo_session=" + "s".repeat(43) },
    }),
    envFor(mock.db),
  );
  assert.equal(listResponse.status, 200);
  const body = await listResponse.json();
  assert.deepEqual(body.attachments, []);
});

const NOT_PENDING_META = { meta: { changes: 0 } };

test("rejecting an already-rejected (non-pending) attachment id is a 404", async () => {
  const mock = mockDb([
    moderatorSessionRoute,
    banCheckRoute,
    { sql: /^UPDATE attachments SET/, runMeta: NOT_PENDING_META },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    adminActionRequest(ATTACHMENT_ID, "reject"),
    envFor(mock.db),
  );
  assert.equal(response.status, 404);
});

test("approving an unknown attachment id is a 404", async () => {
  const mock = mockDb([
    moderatorSessionRoute,
    banCheckRoute,
    { sql: /^UPDATE attachments SET/, runMeta: NOT_PENDING_META },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    adminActionRequest("0e1f2a3b-4c5d-4e6f-8a9b-1c2d3e4f5a6b", "approve"),
    envFor(mock.db),
  );
  assert.equal(response.status, 404);
});

test("insertAttachments persists all files in ONE all-or-nothing batch", async () => {
  const files = [
    { mime: "image/gif", bytes: GIF_BYTES },
    { mime: "image/jpeg", bytes: JPEG_BYTES },
    { mime: "image/png", bytes: PNG_BYTES },
  ];
  const mock = mockDb([{ sql: /INSERT INTO attachments/, runMeta: { meta: { changes: 1 } } }]);
  const ids = await insertAttachments(mock.db, 42, 7, files);

  assert.equal(ids.length, 3);
  for (const id of ids) assert.match(id, /^[0-9a-f-]{36}$/, "ids are UUID-shaped");
  assert.equal(mock.batches.length, 1, "all inserts ride in one db.batch call");
  assert.equal(mock.batches[0].length, 3, "the batch carries one INSERT per file");
  const inserts = attachmentCalls(mock.calls);
  assert.equal(inserts.length, 3);
  assert.ok(inserts.every((insert) => insert.values[1] === 42 && insert.values[2] === 7));
});
