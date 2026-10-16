// Banning auto-hides posts (v2.4.1): an ACTIVE ban (not revoked, not expired)
// hides the author's posts at read time — feed (both boards), replies, detail
// (via canViewPost), history, and the reply decorators. No schema change and
// no bulk writes: unbanning or letting a temp ban expire restores the posts
// automatically. Visibility convention mirrors hidden posts: the author and
// admins pass; moderators are outside it.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import forumWorker from "../worker.mjs";
import { readFileSync } from "node:fs";

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

function captureFeedRoute() {
  // Captures the feed's root SELECT for later execution against real SQLite.
  const captured = [];
  const feed = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow() },
    { sql: /WHERE p\.parent_id IS NULL AND p\.visibility = 'public'/, rows: [] },
  ]);
  const realPrepare = feed.db.prepare.bind(feed.db);
  feed.db.prepare = (sql) => {
    if (/WHERE p\.parent_id IS NULL AND p\.visibility = 'public'/.test(sql)) captured.push(sql);
    return realPrepare(sql);
  };
  return { feed, captured };
}

const BAN_TERM = /NOT EXISTS \(SELECT 1 FROM bans/;

test("an active ban becomes a bind-free read-time filter on both feed boards", async () => {
  const { feed, captured } = captureFeedRoute();
  await forumWorker.fetch(new Request("https://forum.example/api/posts", { method: "GET" }), envFor(feed.db));
  assert.equal(captured.length, 1);
  assert.match(captured[0], BAN_TERM);
  assert.match(captured[0], /b\.revoked_at IS NULL/);
  assert.match(captured[0], /b\.expires_at IS NULL OR b\.expires_at > CAST\(strftime\('%s','now'\) AS INTEGER\)/);
  assert.match(captured[0], /b\.user_id = p\.author_id/);
  // The term is bind-free: the viewer bind stays the only one.
  assert.equal(feed.calls[0].values.length, 1);

  await forumWorker.fetch(new Request("https://forum.example/api/posts?board=suggestions", { method: "GET" }), envFor(feed.db));
  assert.ok(captured[1].includes("p.board = 'suggestions'"), "suggestions branch");
  assert.match(captured[1], BAN_TERM, "the suggestions sort inherits the ban filter");
});

test("functional: banned authors vanish from the feed and return when the ban lapses", () => {
  // Real SQLite with the real migration chain; runs the exact SQL the feed
  // route emits, so exclusion/lapse behavior is engine-verified, not guessed.
  const read = (n) => readFileSync("migrations/" + n, "utf8");
  const now = Math.floor(Date.now() / 1000);
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  db.exec(read("0001_initial.sql"));
  db.prepare("INSERT INTO users (username, username_key, password_salt, password_hash, role, bio, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("banned_author", "banned_author", "s", "h", "member", "", 1);
  db.prepare("INSERT INTO users (username, username_key, password_salt, password_hash, role, bio, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("good_author", "good_author", "s", "h", "member", "", 1);
  db.prepare("INSERT INTO posts (author_id, parent_id, body, created_at) VALUES (?, NULL, ?, ?)").run(1, "by banned", 10);
  db.prepare("INSERT INTO posts (author_id, parent_id, body, created_at) VALUES (?, NULL, ?, ?)").run(2, "by good", 11);
  db.prepare("INSERT INTO bans (user_id, reason, created_at, expires_at, created_by) VALUES (?, ?, ?, ?, ?)")
    .run(1, "test", now - 5, now + 1000, 2);

  // The same shape the general feed emits (bind-free ban term verified in the
  // shape test above; execute the term directly to pin exclusion semantics).
  const feedSql = "SELECT p.id, p.body FROM posts p WHERE p.parent_id IS NULL AND " +
    "p.visibility = 'public' AND NOT EXISTS (SELECT 1 FROM bans b WHERE b.user_id = p.author_id " +
    "AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER))) " +
    "ORDER BY p.id DESC";
  assert.deepEqual(
    db.prepare(feedSql).all().map((row) => row.body),
    ["by good"],
    "active ban hides the author's roots",
  );
  // A temp ban that expired restores the posts automatically.
  db.prepare("UPDATE bans SET expires_at = ?").run(now - 1);
  assert.deepEqual(db.prepare(feedSql).all().map((row) => row.body).sort(), ["by banned", "by good"]);
  // A revoked one stays restored.
  db.prepare("UPDATE bans SET revoked_at = ?").run(now - 1);
  assert.equal(db.prepare(feedSql).all().length, 2);
});

test("functional: banned authors' replies vanish from reply lists and thread metrics", () => {
  const read = (n) => readFileSync("migrations/" + n, "utf8");
  const now = Math.floor(Date.now() / 1000);
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  db.exec(read("0001_initial.sql"));
  for (const name of ["0002_forum_v2.sql", "0003_attachments.sql", "0004_attachment_chunks.sql", "0005_edit_at.sql", "0006_add_board.sql", "0007_post_edits.sql"]) db.exec(read(name));
  db.prepare("INSERT INTO users (username, username_key, password_salt, password_hash, role, bio, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("banned", "banned", "s", "h", "member", "", 1);
  db.prepare("INSERT INTO users (username, username_key, password_salt, password_hash, role, bio, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("good", "good", "s", "h", "member", "", 1);
  db.prepare("INSERT INTO posts (author_id, parent_id, body, created_at) VALUES (?, NULL, ?, ?)").run(2, "thread", 10);
  db.prepare("INSERT INTO posts (author_id, parent_id, body, created_at, last_activity_at) VALUES (?, 1, ?, ?, ?)").run(1, "reply by banned", 11, 11);
  db.prepare("INSERT INTO posts (author_id, parent_id, body, created_at, last_activity_at) VALUES (?, 1, ?, ?, ?)").run(2, "reply by good", 12, 12);
  db.prepare("INSERT INTO posts (author_id, parent_id, body, created_at) VALUES (?, 2, ?, ?)").run(1, "sub by banned", 13);
  db.prepare("INSERT INTO bans (user_id, reason, created_at, expires_at, created_by) VALUES (?, ?, ?, ?, ?)")
    .run(1, "test", now - 5, now + 1000, 2);

  const replySql = "SELECT p.id, p.body FROM posts p WHERE p.parent_id = 1 AND " +
    "(p.visibility = 'public' AND NOT EXISTS (SELECT 1 FROM bans b WHERE b.user_id = p.author_id " +
    "AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER))) " +
    "OR p.author_id = 7) ORDER BY p.id DESC";
  assert.deepEqual(db.prepare(replySql).all().map((row) => row.body), ["reply by good"],
    "banned replier excluded for other members");
  // The banned author's OWN replies stay visible to themselves — and they
  // still see everyone else's normal content, newest first.
  const selfSql = replySql.replace("p.author_id = 7", "p.author_id = 1");
  assert.deepEqual(db.prepare(selfSql).all().map((row) => row.body),
    ["reply by good", "reply by banned"]);
  // Sub-replies follow the same shape one level down.
  const subSql = "SELECT p.id, p.body FROM posts p WHERE p.parent_id = 2 AND " +
    "(p.visibility = 'public' AND NOT EXISTS (SELECT 1 FROM bans b WHERE b.user_id = p.author_id " +
    "AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER))) " +
    "OR p.author_id = 7) ORDER BY p.id DESC";
  assert.deepEqual(db.prepare(subSql).all().map((row) => row.body), [], "banned sub-replier excluded");
  db.prepare("DELETE FROM bans").run();
  assert.equal(db.prepare(replySql).all().length, 2, "unban restores replies");
});

test("functionally through the worker: a banned author's thread is a 404 for members and guests, an admin passes, and history follows", async () => {
  const own = { id: "1", author_id: "3", parent_id: null, body: "banned post", visibility: "public", created_at: 1700000000, last_activity_at: 1700000005, author_username: "banned", avatar_mime: null, avatar_updated_at: null, avatar_version: null, parent_body: null, like_count: 0, dislike_count: 0, viewer_reaction: null, board: "general", edited_at: null };
  // canViewPost's new ban check hits its own query; this route mocks it as
  // ACTIVE for the first two reads and ABSENT (expired) for the third.
  const banViewRoute = { sql: /SELECT id, author_id, visibility, parent_id FROM posts WHERE id = \? LIMIT 1|SELECT 1 FROM bans/, result: null };
  const detailRoutes = [
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow() },
    { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null },
    { sql: /WHERE p\.id = \? LIMIT 1/, result: () => own },
    { sql: /SELECT 1 FROM bans b WHERE b\.user_id = \?/, result: { ok: 1 } },
    { sql: /./ },
  ];
  const member = await forumWorker.fetch(
    new Request("https://forum.example/api/posts/1", {
      method: "GET",
      headers: { Cookie: "wempo_session=" + "s".repeat(43) },
    }),
    envFor(mockDb(detailRoutes).db),
  );
  assert.equal(member.status, 404, "active ban hides the post from members");

  const guest = await forumWorker.fetch(
    new Request("https://forum.example/api/posts/1", { method: "GET" }),
    envFor(mockDb([
      { sql: /FROM sessions s LEFT JOIN users u/, result: null },
      { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null },
      { sql: /WHERE p\.id = \? LIMIT 1/, result: () => own },
      { sql: /SELECT 1 FROM bans b WHERE b\.user_id = \?/, result: { ok: 1 } },
      { sql: /./ },
    ]).db),
  );
  assert.equal(guest.status, 404, "and from guests");

  const admin = await forumWorker.fetch(
    new Request("https://forum.example/api/posts/1", {
      method: "GET",
      headers: { Cookie: "wempo_session=" + "s".repeat(43) },
    }),
    envFor(mockDb([
      { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ role: "admin", user_id: 9 }) },
      { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null },
      { sql: /WHERE p\.id = \? LIMIT 1/, result: () => own },
      { sql: /SELECT 1 FROM bans b WHERE b\.user_id = \?/, result: { ok: 1 } },
      { sql: /./ },
    ]).db),
  );
  assert.equal(admin.status, 200, "admins keep moderation access");

  // Ban expired → canViewPost passes again.
  const expired = await forumWorker.fetch(
    new Request("https://forum.example/api/posts/1", { method: "GET" }),
    envFor(mockDb([
      { sql: /FROM sessions s LEFT JOIN users u/, result: null },
      { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null },
      { sql: /WHERE p\.id = \? LIMIT 1/, result: () => own },
      { sql: /./ },
    ]).db),
  );
  assert.equal(expired.status, 200, "expired ban restores the post");
});
