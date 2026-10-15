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