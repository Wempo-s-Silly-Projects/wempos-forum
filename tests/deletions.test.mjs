// Author post deletion and account deletion (v2.4.1 feature tests). Two test
// layers live here, mirroring the two layers the repo already uses:
// - worker route behavior through forumWorker.fetch with the route-matching D1
//   mock from threading/post-edit (SQL shape, bind order, access gates);
// - REAL FK semantics against node:sqlite with every migration applied
//   (tests/migration.test.mjs's harness): the exact SQL strings the handlers'
//   exported statement builders produce are executed with foreign keys ON, so
//   the cascade/reparent/no-orphan claims are pinned against the schema itself,
//   not against mock assumptions.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import forumWorker from "../worker.mjs";
import {
  POST_DELETE_SQL,
  REPLY_REPARENT_SQL,
  postDeletionStatements,
} from "../api/posts.mjs";
import { accountDeletionStatements } from "../api/profiles.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = [
  "0001_initial.sql",
  "0002_forum_v2.sql",
  "0003_attachments.sql",
  "0004_attachment_chunks.sql",
  "0005_edit_at.sql",
  "0006_add_board.sql",
  "0007_post_edits.sql",
  "0008_post_archive.sql",
  "0021_post_creation_idempotency.sql",
  "0022_revoked_attachment_hashes.sql",
  "0023_post_archive_deleted_by.sql",
  "0024_idempotency_fingerprints_and_attachment_sources.sql",
  "0025_attachment_gif_identity.sql",
].map((name) => readFileSync(path.join(repoRoot, "migrations", name), "utf8"));

// --- Worker-route layer (mockDb, post-edit.test.mjs idioms) -------------------

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
      return statements.map((_statement, index) =>
        (batchMeta && batchMeta[index]) || { meta: { changes: 1 } });
    },
  };
  return { db, calls, batches };
}

function successLimiter() {
  return { async limit() { return { success: true }; } };
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
    author_id: "7",
    parent_id: null,
    body: "original body",
    visibility: "public",
    created_at: 1700000000,
    last_activity_at: 1700000005,
    edited_at: null,
    board: "general",
    author_username: "test_user",
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

function requestFor(url, { method = "DELETE", body, headers = {} } = {}) {
  return new Request(url, {
    method,
    headers: {
      Origin: "https://forum.example",
      "X-CSRF-Token": "expected-csrf-token",
      Cookie: "wempo_session=" + "s".repeat(43),
      ...(body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...headers,
    },
    body,
  });
}

const sessionRoute = { sql: /FROM sessions s LEFT JOIN users u/, result: signedInSessionRow() };
const guestSessionRoute = { sql: /FROM sessions s LEFT JOIN users u/, result: null };
const banCheckRoute = { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null };
// postById binds (viewerId, postId): the row is chosen by the second bound value.
const postByIdRoute = (rowForId) => ({
  sql: /WHERE p\.id = \? LIMIT 1/,
  result: (values) => rowForId(values[1]),
});
const reparentRoute = { sql: /^UPDATE posts SET parent_id = \? WHERE parent_id = \?$/ };
const deletePostRoute = { sql: /^DELETE FROM posts WHERE id = \? AND author_id = \?$/ };
const fallbackRoute = { sql: /./ };
// Archive route (v2.4.1): the archival INSERT..SELECT rides the deletion batch
// FIRST; its binds are [deletedAt, reason, ...deletionSelectors]. The tests
// below match it by sql text and verify binds shape/leniency (deletedAt is
// "recent seconds", reason and selector list are exact).
const archiveRoute = { sql: /^INSERT INTO post_archive \(original_post_id, author_id, author_name, body, board, created_at, deleted_at, deleted_because, deleted_by_user_id, deleted_by_name, idempotency_key, idempotency_fingerprint\)/ };
const ARCHIVE_BATCH_META = { meta: { changes: 1 } };


// --- Author root deletion: one guarded DELETE takes the whole thread ----------

test("the author deletes a root post with ONE author-guarded DELETE, no reparent", async () => {
  const root = postRow({ id: 50, author_id: "7", parent_id: null, board: "general" });
  const mock = mockDb([
    sessionRoute,
    banCheckRoute,
    postByIdRoute((id) => (id === 50 ? root : null)),
    archiveRoute,
    reparentRoute,
    deletePostRoute,
    fallbackRoute,
  ]);
  const response = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/50"),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
  // The root path never reparents (cascades own the children) and the DELETE
  // re-checks ownership at write time.
  const deleteCall = mock.calls.find((call) => call.sql === POST_DELETE_SQL);
  assert.ok(deleteCall, "the root delete runs the guarded DELETE");
  assert.deepEqual(deleteCall.values, [50, 7]);
  assert.equal(
    mock.calls.some((call) => call.sql === REPLY_REPARENT_SQL),
    false,
    "no reparent may run for a root post",
  );
  assert.equal(mock.batches.length, 1, "the delete runs as one atomic batch");
  // Archival rides the same batch FIRST (rooman98's accountability ask): the
  // whole thread's rows are copied to post_archive before the cascade.
  assert.deepEqual(
    mock.batches[0].map((statement) => statement.sql.startsWith("INSERT INTO post_archive")),
    [true, false],
  );
  assert.equal(mock.batches[0][1].sql, POST_DELETE_SQL);
  const archiveCall = mock.calls.find((call) => call.sql.startsWith("INSERT INTO post_archive"));
  assert.ok(archiveCall, "the archive INSERT runs");
  assert.equal(archiveCall.values[1], "post-delete");
  assert.equal(archiveCall.values[2], 7, "deleting user id is snapshotted");
  assert.equal(archiveCall.values[3], "test_user", "deleting username is snapshotted");
  assert.deepEqual(archiveCall.values.slice(4), [50, 50, 50],
    "root delete archives the root, its replies, and its sub-replies");
  assert.ok(Math.abs(Number(archiveCall.values[0]) - Math.floor(Date.now() / 1000)) < 30,
    "deletedAt is epoch seconds");
  // The SELECT body excludes the board column from the pinned statement list.
  for (const statement of mock.batches[0].slice(1)) {
    assert.equal(statement.sql.includes("board"), false, statement.sql);
  }
});

test("a Suggestions-board root deletes through the identical board-blind SQL", async () => {
  const root = postRow({ id: 60, author_id: "7", board: "suggestions" });
  const mock = mockDb([
    sessionRoute,
    banCheckRoute,
    postByIdRoute((id) => (id === 60 ? root : null)),
    archiveRoute,
    reparentRoute,
    deletePostRoute,
    fallbackRoute,
  ]);
  const response = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/60"),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  // Deletion is board-agnostic: the deletion statements themselves never
  // mention the board column (the read path's POST_SELECT legitimately
  // projects p.board), so the Suggestions feed loses threads exactly like the
  // general one.
  for (const statement of mock.batches[0].slice(1)) {
    assert.equal(statement.sql.includes("board"), false, statement.sql);
  }
  const archiveForBoard = mock.calls.find((call) => call.sql.startsWith("INSERT INTO post_archive"));
  assert.equal(archiveForBoard.values[1], "post-delete");
  const deleteCall = mock.calls.find((call) => call.sql === POST_DELETE_SQL);
  assert.deepEqual(deleteCall.values, [60, 7]);
});

// --- Author reply deletion: sub-replies reparent to the root FIRST ------------

test("the author deletes a reply: sub-replies reparent to the thread root before the DELETE", async () => {
  // Reply 51 (author 7) hangs off root 40; a sub-reply hangs off 51.
  const reply = postRow({ id: 51, author_id: "7", parent_id: "40" });
  const mock = mockDb([
    sessionRoute,
    banCheckRoute,
    postByIdRoute((id) => (id === 51 ? reply : null)),
    archiveRoute,
    reparentRoute,
    deletePostRoute,
    fallbackRoute,
  ]);
  const response = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/51"),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  const batch = mock.batches[0];
  const reparentIndex = batch.findIndex((statement) => statement.sql === REPLY_REPARENT_SQL);
  const deleteIndex = batch.findIndex((statement) => statement.sql === POST_DELETE_SQL);
  assert.ok(reparentIndex === 1 && deleteIndex === 2,
    "the archive copy is statement 0, the reparent statement 1, the delete statement 2");
  const batchArchive = batch[0];
  assert.ok(batchArchive.sql.startsWith("INSERT INTO post_archive"));
  assert.equal(batchArchive.values[1], "post-delete");
  assert.deepEqual(batchArchive.values.slice(4), [51],
    "a reply delete archives just the reply (sub-replies reparent, staying live)");
  // The reparent binds (root id, deleted reply id): the deleted reply's
  // children are re-pointed at the THREAD ROOT, not at the reply itself.
  assert.deepEqual(batch[reparentIndex].values, [40, 51]);
  assert.deepEqual(batch[deleteIndex].values, [51, 7]);
});

test("a reply with no sub-replies still deletes (a 0-change reparent is not an error)", async () => {
  const reply = postRow({ id: 52, author_id: "7", parent_id: "40" });
  const mock = mockDb([
    sessionRoute,
    banCheckRoute,
    postByIdRoute((id) => (id === 52 ? reply : null)),
    archiveRoute,
    reparentRoute,
    deletePostRoute,
    fallbackRoute,
  ], { batchMeta: [ARCHIVE_BATCH_META, { meta: { changes: 0 } }, { meta: { changes: 1 } }] });
  const response = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/52"),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
});

test("an already-gone post reports 404 off the guarded DELETE's 0-change write", async () => {
  const reply = postRow({ id: 53, author_id: "7", parent_id: "40" });
  const mock = mockDb([
    sessionRoute,
    banCheckRoute,
    postByIdRoute((id) => (id === 53 ? reply : null)), // still visible on read
    reparentRoute,
    deletePostRoute,
    fallbackRoute,
  ], { batchMeta: [ARCHIVE_BATCH_META, { meta: { changes: 1 } }, { meta: { changes: 0 } }] });
  const response = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/53"),
    envFor(mock.db),
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "Post not found.");
});

// --- Access control ------------------------------------------------------------

test("a non-author member is refused with 403 and never reaches the DELETE", async () => {
  const others = postRow({ id: 54, author_id: "9" });
  const mock = mockDb([
    sessionRoute,
    banCheckRoute,
    postByIdRoute((id) => (id === 54 ? others : null)),
    reparentRoute,
    deletePostRoute,
    fallbackRoute,
  ]);
  const response = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/54"),
    envFor(mock.db),
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "Only the author can delete this post.");
  assert.equal(
    mock.calls.some((call) => call.sql === POST_DELETE_SQL || call.sql === REPLY_REPARENT_SQL),
    false,
    "no delete or reparent may run for a non-author",
  );
  // Author-only means NO role path: an administrator deleting someone else's
  // post gets the same refusal.
  const adminMock = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: signedInSessionRow({ role: "admin" }) },
    banCheckRoute,
    postByIdRoute((id) => (id === 54 ? others : null)),
    reparentRoute,
    deletePostRoute,
    fallbackRoute,
  ]);
  const adminResponse = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/54"),
    envFor(adminMock.db),
  );
  assert.equal(adminResponse.status, 403);
});

test("a guest is refused with 401 before any post lookup", async () => {
  const mock = mockDb([
    guestSessionRoute,
    banCheckRoute,
    postByIdRoute(() => postRow()),
    reparentRoute,
    deletePostRoute,
    fallbackRoute,
  ]);
  const response = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/1"),
    envFor(mock.db),
  );
  assert.equal(response.status, 401);
  assert.ok((await response.json()).error.length > 0);
  assert.equal(mock.batches.length, 0);
});

test("an unknown or already-gone post id is a 404 with no DELETE", async () => {
  const mock = mockDb([
    sessionRoute,
    banCheckRoute,
    postByIdRoute(() => null),
    reparentRoute,
    deletePostRoute,
    fallbackRoute,
  ]);
  const response = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/999"),
    envFor(mock.db),
  );
  assert.equal(response.status, 404);
  assert.equal(mock.calls.some((call) => call.sql === POST_DELETE_SQL), false);
});

test("rate limiting gates the post delete with the write and post-write scopes", async () => {
  const root = postRow({ id: 50, author_id: "7" });
  const scopesCalled = [];
  const env = envFor(mockDb([
    sessionRoute,
    banCheckRoute,
    postByIdRoute((id) => (id === 50 ? root : null)),
    archiveRoute,
    reparentRoute,
    deletePostRoute,
    fallbackRoute,
  ]).db, {
    WRITE_RATE_LIMITER: {
      async limit({ key }) {
        scopesCalled.push({ scope: "write", key });
        return { success: true };
      },
    },
    POST_WRITE_RATE_LIMITER: {
      async limit({ key }) {
        scopesCalled.push({ scope: "post-write", key });
        return { success: true };
      },
    },
  });
  const response = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/50", {
      headers: { "CF-Connecting-IP": "192.0.2.10" },
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(scopesCalled.map((call) => call.scope), ["write", "write", "post-write"],
    "routeApi's write gate plus the handler's write and post-write gates");
  assert.match(scopesCalled[2].key, /^[a-f0-9]{64}$/);
});

// --- Account deletion routes -----------------------------------------------------

test("account deletion removes owned child rows explicitly, then the user row, in one batch", async () => {
  const mock = mockDb([sessionRoute, banCheckRoute, archiveRoute, fallbackRoute]);
  const response = await forumWorker.fetch(
    requestFor("https://forum.example/api/me/delete", { method: "POST" }),
    envFor(mock.db),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
  assert.equal(mock.batches.length, 1, "the wipe runs as one atomic batch");
  const batch = mock.batches[0];
  // The accountability archive rides FIRST (rooman98's ask): every doomed row
  // — the account's own posts and the child rows the CASCADE will take — is
  // copied before the wipe. attachments THEN (the only users FK without an ON
  // DELETE action), then the owned children, then the user row LAST.
  assert.equal(batch[0].sql.startsWith("INSERT INTO post_archive"), true);
  assert.equal(batch[0].values[1], "account-delete");
  assert.equal(batch[0].values[2], 7, "account deletion actor id is recorded");
  assert.equal(batch[0].values[3], "test_user", "account deletion actor name is recorded");
  assert.deepEqual(batch[0].values.slice(4), [7, 7, 7]);
  assert.ok(Math.abs(Number(batch[0].values[0]) - Math.floor(Date.now() / 1000)) < 30);
  assert.deepEqual(
    batch.slice(1).map((statement) => statement.sql),
    [
      "DELETE FROM attachments WHERE created_by = ?",
      "DELETE FROM notifications WHERE user_id = ?",
      "DELETE FROM reactions WHERE user_id = ?",
      "DELETE FROM reports WHERE reporter_id = ?",
      "DELETE FROM bans WHERE user_id = ?",
      "DELETE FROM sessions WHERE user_id = ?",
      "DELETE FROM users WHERE id = ?",
    ],
  );
  for (const statement of batch.slice(1)) assert.deepEqual(statement.values, [7]);
});

test("account deletion is a guest 401 before any write", async () => {
  const mock = mockDb([guestSessionRoute, banCheckRoute, fallbackRoute]);
  const response = await forumWorker.fetch(
    requestFor("https://forum.example/api/me/delete", { method: "POST" }),
    envFor(mock.db),
  );
  assert.equal(response.status, 401);
  assert.equal(mock.batches.length, 0);
});

test("account deletion whose user row already vanished reports 404", async () => {
  const mock = mockDb([sessionRoute, banCheckRoute, archiveRoute, fallbackRoute], {
    batchMeta: [
      ARCHIVE_BATCH_META,
      { meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } },
      { meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } },
      { meta: { changes: 0 } },
    ],
  });
  const response = await forumWorker.fetch(
    requestFor("https://forum.example/api/me/delete", { method: "POST" }),
    envFor(mock.db),
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "Account not found.");
});

test("account deletion pays the write rate limiter in the handler too", async () => {
  const scopesCalled = [];
  const mock = mockDb([sessionRoute, banCheckRoute, fallbackRoute]);
  const env = envFor(mock.db, {
    WRITE_RATE_LIMITER: {
      async limit({ key }) {
        scopesCalled.push({ scope: "write", key });
        return { success: true };
      },
    },
  });
  const response = await forumWorker.fetch(
    requestFor("https://forum.example/api/me/delete", { method: "POST" }, {
      "CF-Connecting-IP": "192.0.2.11",
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(scopesCalled.length, 2, "routeApi's write gate plus the handler's write gate");
  assert.match(scopesCalled[1].key, /^[a-f0-9]{64}$/);
});

// --- FK semantics against the REAL schema (every migration applied) ----------

const sqliteAdapter = (db) => ({
  prepare(sql) {
    return { bind: (...values) => ({ sql, values }) };
  },
});

function runStatements(db, statements) {
  for (const statement of statements) {
    db.prepare(statement.sql).run(...statement.values);
  }
}

function countWhere(db, sql, ...values) {
  return Number(db.prepare(sql).get(...values).n);
}

function openForumDb() {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  db.exec(MIGRATIONS.join("\n"));
  return db;
}

const T = 1_700_000_000;

function insertFixture(db) {
  const user = (username) => Number(
    db.prepare(
      "INSERT INTO users (username, username_key, password_salt, password_hash, bio, created_at) VALUES (?, ?, ?, ?, '', ?)",
    ).run(username, username, "salt", "hash", T).lastInsertRowid,
  );
  const alice = user("alice");
  const bob = user("bob");
  const cara = user("cara");
  const post = (authorId, parentId, body, board = "general", seconds = 10) => Number(
    db.prepare(
      "INSERT INTO posts (author_id, parent_id, body, visibility, created_at, last_activity_at, board) " +
        "VALUES (?, ?, ?, 'public', ?, ?, ?)",
    ).run(authorId, parentId, body, T + seconds, T + seconds, board).lastInsertRowid,
  );
  const reaction = (postId, userId, value) => Number(
    db.prepare("INSERT INTO reactions (post_id, user_id, value, created_at) VALUES (?, ?, ?, ?)")
      .run(postId, userId, value, T + 20).lastInsertRowid,
  );
  const notification = (userId, targetPostId, replyId) => Number(
    db.prepare("INSERT INTO notifications (user_id, target_post_id, reply_id, created_at) VALUES (?, ?, ?, ?)")
      .run(userId, targetPostId, replyId, T + 25).lastInsertRowid,
  );
  const report = (postId, reporterId, reason) => Number(
    db.prepare("INSERT INTO reports (post_id, reporter_id, reason, status, created_at) VALUES (?, ?, ?, 'open', ?)")
      .run(postId, reporterId, reason, T + 30).lastInsertRowid,
  );
  const attachmentWithChunk = (postId, createdBy) => {
    const id = "att-" + postId + "-" + createdBy;
    db.prepare(
      "INSERT INTO attachments (id, post_id, created_by, created_at, mime, version, status) " +
        "VALUES (?, ?, ?, ?, 'image/png', 'ver', 'approved')",
    ).run(id, postId, createdBy, T + 35);
    db.prepare(
      "INSERT INTO attachment_chunks (attachment_id, kind, seq, data) VALUES (?, 'approved', 0, ?)",
    ).run(id, new Uint8Array([1, 2, 3]));
    return id;
  };
  const session = (userId) => Number(
    db.prepare("INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run("tok-" + userId, userId, "csrf", T + 40, T + 1_000_000).lastInsertRowid,
  );
  return {
    alice, bob, cara, post, reaction, notification, report, attachmentWithChunk, session,
  };
}

// Fixture topology (threads are the unit of loss):
//   alice's root aRoot (=100) ← bob reply bRep; bRep ← cara sub cSub
//   alice's root aRootB ← bob reply bRepB
//   bob's root bRoot (untouched thread)
test("deleting a ROOT post removes the whole thread — other users' replies and all child rows — and nothing else", () => {
  const db = openForumDb();
  const fx = insertFixture(db);
  const aRoot = fx.post(fx.alice, null, "alice root", "suggestions", 10);
  const bRep = fx.post(fx.bob, aRoot, "bob replies to alice", "suggestions", 20);
  const cSub = fx.post(fx.cara, bRep, "cara replies to bob", "suggestions", 30);
  const aRootB = fx.post(fx.alice, null, "alice second thread", "general", 40);
  const bRepB = fx.post(fx.bob, aRootB, "bob replies again", "general", 50);
  const bRoot = fx.post(fx.bob, null, "bob's own thread", "general", 60);
  fx.reaction(aRoot, fx.bob, "like");
  fx.reaction(bRep, fx.alice, "like");
  fx.reaction(bRoot, fx.cara, "dislike");
  fx.notification(fx.bob, aRoot, bRep);
  fx.notification(fx.cara, bRoot, bRoot); // cara's untouched-thread notification
  fx.report(aRoot, fx.cara, "report on the doomed thread");
  fx.report(bRoot, fx.alice, "alice's report on bob's thread");
  fx.attachmentWithChunk(bRep, fx.cara);
  fx.attachmentWithChunk(bRoot, fx.bob);

  const postsBefore = countWhere(db, "SELECT COUNT(*) AS n FROM posts");
  assert.equal(postsBefore, 6);

  runStatements(db, postDeletionStatements(sqliteAdapter(db), fx.alice, aRoot, null));

  // The thread is gone whole: alice's root, bob's reply INTO it, cara's
  // sub-reply INTO that reply.
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM posts"), postsBefore - 3);
  for (const gone of [aRoot, bRep, cSub]) {
    assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM posts WHERE id = ?", gone), 0, "post " + gone);
  }
  // Everything outside the thread survives untouched.
  for (const kept of [aRootB, bRepB, bRoot]) {
    assert.ok(countWhere(db, "SELECT COUNT(*) AS n FROM posts WHERE id = ?", kept), "post " + kept);
  }
  // No orphans: each deleted post's reactions, reports, notifications and
  // attachments (+chunks) cascaded away.
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM reactions WHERE post_id IN (?, ?, ?)", aRoot, bRep, cSub), 0);
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM reports WHERE post_id IN (?, ?, ?)", aRoot, bRep, cSub), 0);
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM notifications WHERE reply_id IN (?, ?, ?)", aRoot, bRep, cSub), 0);
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM attachments WHERE post_id IN (?, ?, ?)", aRoot, bRep, cSub), 0);
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM attachment_chunks WHERE attachment_id LIKE 'att-" + bRep + "-%'"), 0);
  // The surviving thread's data is untouched.
  assert.ok(countWhere(db, "SELECT COUNT(*) AS n FROM reactions WHERE post_id = ?", bRoot));
  assert.ok(countWhere(db, "SELECT COUNT(*) AS n FROM attachments WHERE post_id = ?", bRoot));
  assert.ok(countWhere(db, "SELECT COUNT(*) AS n FROM notifications WHERE reply_id = ?", bRoot));
  // No dangling child rows anywhere (every FK child of the deleted posts).
  assert.equal(countWhere(
    db,
    "SELECT COUNT(*) AS n FROM notifications WHERE target_post_id IN (?, ?, ?)",
    aRoot, bRep, cSub,
  ), 0);
});

test("deleting a REPLY reparents its sub-replies to the thread root before it goes", () => {
  const db = openForumDb();
  const fx = insertFixture(db);
  const aRoot = fx.post(fx.alice, null, "alice root");
  const bRep = fx.post(fx.bob, aRoot, "bob's reply");
  const cSub = fx.post(fx.cara, bRep, "cara's sub-reply");
  fx.reaction(bRep, fx.alice, "like");
  fx.notification(fx.alice, aRoot, bRep); // bob's reply notified alice
  fx.attachmentWithChunk(bRep, fx.bob);

  // bob deletes his own level-1 reply; cara's sub-reply must survive under the
  // thread root.
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM posts"), 3);
  runStatements(db, postDeletionStatements(sqliteAdapter(db), fx.bob, bRep, aRoot));

  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM posts WHERE id = ?", bRep), 0);
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM posts WHERE id = ?", aRoot), 1);
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM posts WHERE id = ?", cSub), 1);
  // THE reparent pin: the sub-replies are now bound to the thread ROOT.
  assert.equal(
    Number(db.prepare("SELECT parent_id FROM posts WHERE id = ?").get(cSub).parent_id),
    aRoot,
    "cara's sub-reply is reparented to the thread root, not lost",
  );
  // The deleted reply's own children data cascades: its reactions, its
  // notification row (reply_id FK), its attachment and chunks.
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM reactions WHERE post_id = ?", bRep), 0);
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM notifications WHERE reply_id = ?", bRep), 0);
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM attachments WHERE post_id = ?", bRep), 0);
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM attachment_chunks WHERE attachment_id = 'att-" + bRep + "-" + fx.bob + "'"), 0);
});

test("account deletion removes the user and everything they own, keeping other users' own content", () => {
  const db = openForumDb();
  const fx = insertFixture(db);
  // alice's thread (with bob's + cara's replies inside it), alice's reply into
  // BOB's thread, and bob's own untouched thread.
  const aRoot = fx.post(fx.alice, null, "alice root");
  const bRep = fx.post(fx.bob, aRoot, "bob replies into alice's thread");
  const cSub = fx.post(fx.cara, bRep, "cara sub-reply inside alice's thread");
  const bRoot = fx.post(fx.bob, null, "bob's own thread");
  const aRep = fx.post(fx.alice, bRoot, "alice replies into bob's thread");
  fx.reaction(aRoot, fx.bob, "like");
  fx.reaction(bRoot, fx.alice, "like");
  fx.reaction(bRoot, fx.cara, "dislike");
  fx.notification(fx.alice, bRoot, aRep); // alice's own notification about her reply
  fx.notification(fx.cara, bRoot, aRep); // cara notified about alice's reply
  fx.notification(fx.cara, aRoot, bRep); // cara's notification in alice's thread
  fx.report(aRoot, fx.cara, "cara reports alice's thread");
  fx.report(bRoot, fx.alice, "alice reports bob's thread");
  fx.attachmentWithChunk(aRoot, fx.alice); // attachments she created herself
  fx.attachmentWithChunk(bRoot, fx.bob);
  fx.session(fx.alice);
  fx.session(fx.bob);
  db.prepare("INSERT INTO bans (user_id, reason, created_at, created_by) VALUES (?, ?, ?, ?)")
    .run(fx.cara, "cara banned", T + 50, fx.alice);

  runStatements(db, accountDeletionStatements(sqliteAdapter(db), fx.alice));

  // The user row is gone; the other accounts are not.
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM users WHERE id IN (?, ?)", fx.bob, fx.cara), 2);
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM users WHERE id = ?", fx.alice), 0);
  // alice's posts are gone whole — including OTHER users' replies inside her
  // threads (owner-accepted blast radius), while bob's own thread (minus
  // alice's reply in it) survives.
  for (const gone of [aRoot, bRep, cSub, aRep]) {
    assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM posts WHERE id = ?", gone), 0, "post " + gone);
  }
  assert.ok(countWhere(db, "SELECT COUNT(*) AS n FROM posts WHERE id = ?", bRoot));
  // No orphaned child rows anywhere: reactions on her posts (by anyone) and by
  // her (on anyone's posts) are gone; bob's reaction from cara on bob's thread stays.
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM reactions WHERE post_id = ?", aRoot), 0);
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM reactions WHERE user_id = ?", fx.alice), 0);
  assert.ok(countWhere(db, "SELECT COUNT(*) AS n FROM reactions WHERE post_id = ? AND user_id = ?", bRoot, fx.cara));
  // Reports authored by alice are gone; cara's report on alice's thread
  // cascaded with the post; every remaining report/resolution references live users.
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ?", fx.alice), 0);
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM reports WHERE post_id = ?", aRoot), 0);
  // Notifications about her account or posts are gone: her own row cascades on
  // the user delete, and the rows ABOUT her posts (cara's, in both threads)
  // cascade on the post/reply deletes. Every notification row is gone.
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM notifications"), 0);
  assert.equal(
    countWhere(db, "SELECT COUNT(*) AS n FROM notifications WHERE reply_id IN (?, ?)", aRep, bRep),
    0,
  );
  // Her attachments (and their chunks) were deleted explicitly; bob's stay.
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM attachments WHERE created_by = ?", fx.alice), 0);
  assert.ok(countWhere(db, "SELECT COUNT(*) AS n FROM attachments WHERE created_by = ?", fx.bob));
  assert.ok(countWhere(db, "SELECT COUNT(*) AS n FROM attachment_chunks WHERE attachment_id = 'att-" + bRoot + "-" + fx.bob + "'"));
  // Her sessions are gone; bob's survive.
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", fx.alice), 0);
  assert.ok(countWhere(db, "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", fx.bob));
  // Bans target-owned go; the ban SHE created (on cara) survives with its
  // actor NULLed by ON DELETE SET NULL.
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM bans WHERE user_id = ?", fx.alice), 0);
  const caraBan = db.prepare("SELECT user_id, created_by FROM bans WHERE created_by IS NULL").get();
  assert.ok(caraBan, "cara's ban survives with its created_by actor NULLed");
});

test("account deletion throws no FK error even with the pathological created_by attachment", () => {
  // attachments.created_by has NO ON DELETE action; intake never attaches
  // someone's image to another user's post, but the explicit created_by
  // delete must keep the wipe from failing even if such a row existed.
  const db = openForumDb();
  const fx = insertFixture(db);
  const bRoot = fx.post(fx.bob, null, "bob's thread");
  db.prepare(
    "INSERT INTO attachments (id, post_id, created_by, created_at, mime, version, status) " +
      "VALUES ('weird', ?, ?, ?, 'image/png', 'ver', 'approved')",
  ).run(bRoot, fx.alice, T + 35);
  runStatements(db, accountDeletionStatements(sqliteAdapter(db), fx.alice));
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM users WHERE id = ?", fx.alice), 0);
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM attachments WHERE id = 'weird'"), 0);
  assert.ok(countWhere(db, "SELECT COUNT(*) AS n FROM posts WHERE id = ?", bRoot));
});
// Archival execution test (v2.4.1, review follow-up): the archival
// INSERT..SELECT is the feature's core invariant — run it against real
// SQLite with the archived flag ON and pin that the archived row set equals
// exactly the set that vanishes (and only that set).

test("the archiving root delete copies the whole thread — and only the thread — to post_archive", () => {
  const db = openForumDb();
  const fx = insertFixture(db);
  const aRoot = fx.post(fx.alice, null, "alice root", "suggestions", 10);
  const bRep = fx.post(fx.bob, aRoot, "bob replies to alice", "suggestions", 20);
  const cSub = fx.post(fx.cara, bRep, "cara replies to bob", "suggestions", 30);
  const bRoot = fx.post(fx.bob, null, "bob's own thread", "general", 60);

  runStatements(db, postDeletionStatements(sqliteAdapter(db), fx.alice, aRoot, null,
    { archiveReason: "post-delete", deletedAt: 1_770_000_000, deletedByUserId: fx.alice, deletedByName: "alice" }));

  const archived = db.prepare(
    "SELECT original_post_id AS id, author_name AS name, body, deleted_because AS reason, deleted_by_name AS deleted_by FROM post_archive ORDER BY original_post_id",
  ).all();
  assert.deepEqual(archived.map((row) => [row.id, row.name, row.body, row.reason, row.deleted_by]), [
    [aRoot, "alice", "alice root", "post-delete", "alice"],
    [bRep, "bob", "bob replies to alice", "post-delete", "alice"],
    [cSub, "cara", "cara replies to bob", "post-delete", "alice"],
  ], "the archive set equals the cascade set — nothing under-archived");
  // Surviving content is NOT archived.
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM post_archive"), 3);
  assert.ok(countWhere(db, "SELECT COUNT(*) AS n FROM posts WHERE id = ?", bRoot));
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM post_archive WHERE original_post_id = ?", bRoot), 0);
});

test("the archiving account wipe captures third-party content the CASCADE takes with it", () => {
  const db = openForumDb();
  const fx = insertFixture(db);
  // alice wipes: her roots take bob's replies (arm 2) and cara's sub-replies
  // hanging off BOB's reply (arm 3) — third-party rows vanish too, so they
  // must be archived. Bob's own thread is untouched.
  const aRoot = fx.post(fx.alice, null, "alice root", "general", 10);
  const bRep = fx.post(fx.bob, aRoot, "bob replies to alice", "general", 20);
  const cSub = fx.post(fx.cara, bRep, "cara replies to bob", "general", 30);
  const aRep = fx.post(fx.alice, aRoot, "alice replies to her own root", "general", 40);
  const dSub = fx.post(fx.cara, aRep, "cara replies to alice's own reply", "general", 50);
  const bRoot = fx.post(fx.bob, null, "bob's own thread", "general", 60);

  runStatements(db, accountDeletionStatements(sqliteAdapter(db), fx.alice,
    { archiveReason: "account-delete", deletedAt: 1_770_000_000, deletedByUserId: fx.alice, deletedByName: "alice" }));

  const archived = db.prepare(
    "SELECT original_post_id AS id, deleted_because AS reason, deleted_by_name AS deleted_by FROM post_archive ORDER BY original_post_id",
  ).all();
  assert.deepEqual(archived.map((row) => [row.id, row.reason, row.deleted_by]), [
    [aRoot, "account-delete", "alice"],
    [bRep, "account-delete", "alice"],
    [cSub, "account-delete", "alice"],
    [aRep, "account-delete", "alice"],
    [dSub, "account-delete", "alice"],
  ], "own posts + children + grandchildren archived — no scrub hole");
  // Cara's sub-reply off bob's untouched thread (if any) would not archive;
  // bob's own content survives and is not archived.
  assert.equal(countWhere(db, "SELECT COUNT(*) AS n FROM post_archive WHERE original_post_id = ?", bRoot), 0);
  // author_name is captured BEFORE the users row vanishes.
  assert.equal(db.prepare(
    "SELECT author_name AS name FROM post_archive WHERE original_post_id = ?").get(aRoot).name, "alice");
});
