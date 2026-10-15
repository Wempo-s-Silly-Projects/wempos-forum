// Migration 0002 tests: apply migrations/0001_initial.sql, insert a fixture,
// then apply migrations/0002_forum_v2.sql inside an explicit transaction (mirroring
// how D1 batches execute atomically) and assert the rebuilt schema's columns,
// CHECKs, backfill, indexes, and no-cascade-loss guarantee.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION_0001 = readFileSync(path.join(repoRoot, "migrations", "0001_initial.sql"), "utf8");
const MIGRATION_0002 = readFileSync(path.join(repoRoot, "migrations", "0002_forum_v2.sql"), "utf8");
const MIGRATION_0003 = readFileSync(path.join(repoRoot, "migrations", "0003_attachments.sql"), "utf8");

const T = 1_700_000_000;

function openFixtureDb() {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  db.exec(MIGRATION_0001);
  db.prepare(
    "INSERT INTO users (username, username_key, password_salt, password_hash, role, bio, created_at) VALUES (?, ?, ?, ?, 'admin', ?, ?)",
  ).run("wempo", "wempo", "fixture-salt", "fixture-hash", "tiny bio!!", T);
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
  ).run("token-hash-1", 1, "csrf-1", T + 10, T + 1_000_000);
  db.prepare("INSERT INTO posts (author_id, parent_id, body, created_at) VALUES (?, NULL, ?, ?)").run(1, "root post one", T + 20);
  db.prepare("INSERT INTO posts (author_id, parent_id, body, created_at) VALUES (?, ?, ?, ?)").run(1, 1, "reply to root one", T + 50);
  db.prepare("INSERT INTO posts (author_id, parent_id, body, created_at) VALUES (?, NULL, ?, ?)").run(1, "root post two", T + 30);
  db.prepare("INSERT INTO reactions (post_id, user_id, value, created_at) VALUES (?, ?, ?, ?)").run(1, 1, "like", T + 40);
  db.prepare("INSERT INTO reports (post_id, reporter_id, reason, status, created_at) VALUES (?, ?, ?, 'open', ?)").run(1, 1, "test report reason", T + 45);
  db.prepare("INSERT INTO bans (user_id, reason, created_at, created_by) VALUES (?, ?, ?, ?)").run(1, "test ban reason", T + 55, 1);
  return db;
}

function applyForumV2(db) {
  db.exec("BEGIN");
  try {
    db.exec(MIGRATION_0002);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function objectNames(db, type) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%'").all(type).map((row) => row.name);
}

function columnsOf(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

function expectSqlRejection(db, sql, ...params) {
  assert.throws(
    () => {
      const statement = db.prepare(sql);
      statement.run(...params);
    },
    (error) => error instanceof Error,
    `expected rejection: ${sql}`,
  );
}

function objectNamesForType(db, type) {
  return objectNames(db, type);
}

function applyAttachments(db) {
  db.exec("BEGIN");
  try {
    db.exec(MIGRATION_0003);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

test("migration 0002 preserves child rows across the users table rebuild", () => {
  const db = openFixtureDb();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM posts").get().n, 3);

  applyForumV2(db);

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM posts").get().n, 3);

  const user = db.prepare("SELECT id, username, role, bio FROM users").get();
  assert.equal(user.id, 1);
  assert.equal(user.username, "wempo");
  assert.equal(user.role, "admin");
  assert.equal(user.bio, "tiny bio!!");

  const session = db.prepare("SELECT user_id FROM sessions").get();
  assert.equal(session.user_id, 1);
  assert.equal(db.prepare("SELECT COUNT(DISTINCT author_id) AS n FROM posts WHERE author_id = 1").get().n, 1);
  const reply = db.prepare("SELECT parent_id FROM posts WHERE parent_id IS NOT NULL").get();
  assert.equal(reply.parent_id, 1);
});

test("migration 0002 renames users_new, recreates the admin index, and adds activity/notification indexes", () => {
  const db = openFixtureDb();
  applyForumV2(db);

  const tables = objectNamesForType(db, "table");
  assert.ok(tables.includes("users"));
  assert.ok(tables.includes("notifications"));
  assert.ok(!tables.includes("users_new"), "users_new must be renamed away after the rebuild");

  const indexes = objectNamesForType(db, "index");
  for (const name of [
    "idx_users_single_admin",
    "idx_sessions_expires_at",
    "idx_sessions_user_id",
    "idx_posts_feed",
    "idx_posts_author",
    "idx_posts_parent_replies",
    "idx_reactions_post_value",
    "idx_reports_queue",
    "idx_reports_one_open_per_reporter",
    "idx_bans_active",
    "idx_posts_activity",
    "idx_notifications_user",
  ]) {
    assert.ok(indexes.includes(name), `missing index ${name}`);
  }
});

test("migration 0002 exposes the new users columns", () => {
  const db = openFixtureDb();
  applyForumV2(db);

  const columns = columnsOf(db, "users");
  for (const name of [
    "avatar_status",
    "pending_avatar_mime",
    "pending_avatar_data",
    "pending_avatar_updated_at",
    "pending_avatar_version",
    "social_youtube",
    "social_x",
    "social_reddit",
    "social_github",
    "social_discord",
    "social_gitlab",
    "social_instagram",
    "social_tiktok",
    "social_twitch",
    "polytoria_username",
  ]) {
    assert.ok(columns.includes(name), `missing column users.${name}`);
  }
});

test("bio CHECK now allows 10000 characters and rejects 10001", () => {
  const db = openFixtureDb();
  applyForumV2(db);

  const long = "b".repeat(10_000);
  db.prepare("UPDATE users SET bio = ? WHERE id = 1").run(long);
  assert.equal(db.prepare("SELECT bio FROM users WHERE id = 1").get().bio, long);
  expectSqlRejection(db, "UPDATE users SET bio = ? WHERE id = 1", "b".repeat(10_001));
});

test("role CHECK accepts moderator and rejects guest-like values", () => {
  const db = openFixtureDb();
  applyForumV2(db);

  db.prepare("UPDATE users SET role = 'moderator' WHERE id = 1").run();
  assert.equal(db.prepare("SELECT role FROM users WHERE id = 1").get().role, "moderator");
  expectSqlRejection(db, "UPDATE users SET role = 'guest' WHERE id = 1");
  expectSqlRejection(db, "UPDATE users SET role = 'owner' WHERE id = 1");
});

test("post last_activity_at backfills to newest reply time, or created_at for replyless roots", () => {
  const db = openFixtureDb();
  applyForumV2(db);

  const rows = db.prepare("SELECT id, parent_id, created_at, last_activity_at FROM posts ORDER BY id").all();
  const rootOne = rows.find((row) => row.id === 1);
  const reply = rows.find((row) => row.id === 2);
  const rootTwo = rows.find((row) => row.id === 3);
  assert.equal(rootOne.last_activity_at, T + 50, "root with a later reply gets the reply's created_at");
  assert.equal(rootTwo.last_activity_at, T + 30, "replyless root gets its own created_at");
  assert.equal(reply.last_activity_at, null, "replies do not get last_activity_at");
});

test("notifications table rejects NULL user_id and backwards read_at", () => {
  const db = openFixtureDb();
  applyForumV2(db);

  db.prepare(
    "INSERT INTO notifications (user_id, target_post_id, reply_id, created_at) VALUES (?, ?, ?, ?)",
  ).run(1, 1, 2, T + 60);

  expectSqlRejection(
    db,
    "INSERT INTO notifications (user_id, target_post_id, reply_id, created_at) VALUES (?, ?, ?, ?)",
    null, 1, 2, T + 60,
  );
  expectSqlRejection(
    db,
    "INSERT INTO notifications (user_id, target_post_id, reply_id, created_at, read_at) VALUES (?, ?, ?, ?, ?)",
    1, 1, 2, T + 60, T + 59,
  );
});

test("child FK clauses resolve to the rebuilt users table and ALL child-table rows survive", () => {
  const db = openFixtureDb();
  const expected = {
    users: 1,
    sessions: 1,
    posts: 3,
    reactions: 1,
    reports: 1,
    bans: 1,
  };
  for (const [table, expectedCount] of Object.entries(expected)) {
    const actual = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    assert.equal(actual, expectedCount, `${table} count before migration`);
  }

  applyForumV2(db);

  // Row-count preservation across every rebuilt table, not just sessions and posts.
  for (const [table, expectedCount] of Object.entries(expected)) {
    const actual = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    assert.equal(actual, expectedCount, `${table} rows must survive the rebuild`);
  }

  const ban = db.prepare("SELECT user_id, created_by, reason FROM bans").get();
  assert.equal(ban.user_id, 1);
  assert.equal(ban.created_by, 1);
  const report = db.prepare("SELECT reporter_id, post_id, status FROM reports").get();
  assert.equal(report.reporter_id, 1);
  assert.equal(report.post_id, 1);
  const reaction = db.prepare("SELECT post_id, user_id, value FROM reactions").get();
  assert.equal(reaction.post_id, 1);
  assert.equal(reaction.user_id, 1);
  assert.equal(reaction.value, "like");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM posts WHERE author_id = 1").get().n, 3);
  assert.equal(db.prepare("SELECT parent_id FROM posts WHERE parent_id IS NOT NULL").get().parent_id, 1);
  assert.equal(db.prepare("SELECT user_id FROM sessions").get().user_id, 1);

  // Child tables' FK clauses must name "users" and resolve to the rebuilt table.
  for (const table of ["sessions", "posts", "reactions", "reports", "bans", "notifications"]) {
    const parents = db.prepare(`PRAGMA foreign_key_list(${table})`).all();
    assert.ok(parents.length > 0, `${table} has no foreign keys?`);
    const usersRefs = parents.filter((fk) => fk.table === "users");
    assert.ok(usersRefs.length > 0, `${table} must reference users`);
  }

  // New child rows must be insertable against the rebuilt table (FK resolves live).
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
  ).run("token-hash-2", 1, "csrf-2", T + 100, T + 2_000_000);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 2);

  expectSqlRejection(
    db,
    "INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    "orphan", 12345, "csrf", T + 100, T + 2_000_000,
  );
});

test("social columns reject values longer than 120 characters", () => {
  const db = openFixtureDb();
  applyForumV2(db);

  for (const column of ["social_youtube", "social_x", "social_reddit", "social_github", "social_discord", "social_gitlab", "social_instagram", "social_tiktok", "social_twitch", "polytoria_username"]) {
    const sql = `UPDATE users SET ${column} = ? WHERE id = 1`;
    db.prepare(sql).run("h".repeat(120));
    expectSqlRejection(db, sql, "h".repeat(121));
    db.prepare(`UPDATE users SET ${column} = NULL WHERE id = 1`).run();
  }
});

test("avatar consistency CHECKs enforce avatar_status against both avatar sets", () => {
  const db = openFixtureDb();
  applyForumV2(db);

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const mime = "image/png";
  const at = T + 70;
  const version = "aaaabbbbccccdddd";
  const insertUser = `
    INSERT INTO users (username, username_key, password_salt, password_hash, bio, created_at,
      avatar_mime, avatar_data, avatar_updated_at, avatar_version, avatar_status,
      pending_avatar_mime, pending_avatar_data, pending_avatar_updated_at, pending_avatar_version)
    VALUES (?, ?, 'salt', 'hash', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  let key = 0;
  const nextKey = () => `user${(key += 1)}`;

  // Approved set populated, status approved: valid.
  db.prepare(insertUser).run(nextKey(), nextKey(), T, mime, png, at, version, "approved", null, null, null, null);
  // Approved set populated, fresh pending upload, both sets populated: valid.
  db.prepare(insertUser).run(nextKey(), nextKey(), T, mime, png, at, version, "pending", mime, png, at + 1, "eeeeffff00001111");
  // Pending-set-only upload, status pending: valid.
  db.prepare(insertUser).run(nextKey(), nextKey(), T, null, null, null, null, "pending", mime, png, at, version);
  // Never-uploaded user, status NULL: valid.
  db.prepare(insertUser).run(nextKey(), nextKey(), T, null, null, null, null, null, null, null, null, null);
  // Transient rejected state with both sets empty: valid.
  db.prepare(insertUser).run(nextKey(), nextKey(), T, null, null, null, null, "rejected", null, null, null, null);

  // Brief case: approved set populated, status pending, pending set empty: rejected.
  expectSqlRejection(db, insertUser, nextKey(), nextKey(), T, mime, png, at, version, "pending", null, null, null, null);
  // Approved set populated with status NULL or rejected: rejected.
  expectSqlRejection(db, insertUser, nextKey(), nextKey(), T, mime, png, at, version, null, null, null, null, null);
  expectSqlRejection(db, insertUser, nextKey(), nextKey(), T, mime, png, at, version, "rejected", null, null, null, null);
  // Empty pending set labeled pending (never-uploaded users): rejected.
  expectSqlRejection(db, insertUser, nextKey(), nextKey(), T, null, null, null, null, "pending", null, null, null, null);
  // Populated pending set with status NULL, approved, or rejected: rejected.
  expectSqlRejection(db, insertUser, nextKey(), nextKey(), T, null, null, null, null, null, mime, png, at, version);
  expectSqlRejection(db, insertUser, nextKey(), nextKey(), T, null, null, null, null, "approved", mime, png, at, version);
  expectSqlRejection(db, insertUser, nextKey(), nextKey(), T, null, null, null, null, "rejected", mime, png, at, version);
  // Empty sets labeled approved: rejected.
  expectSqlRejection(db, insertUser, nextKey(), nextKey(), T, null, null, null, null, "approved", null, null, null, null);
});

// Migration 0003 tests: apply 0001 + 0002 first (attachments FKs target posts and
// users as rebuilt by 0002), then apply 0003 inside an explicit transaction
// (mirroring how D1 batches execute atomically) and assert the attachments
// table's columns, CHECKs, indexes, and post-delete cascade.
function openV2Db() {
  const db = openFixtureDb();
  applyForumV2(db);
  return db;
}

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0x00, 0x00]);
const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
const version = "aaaabbbbccccdddd";

const insertAttachment = `
  INSERT INTO attachments (id, post_id, created_by, created_at, mime, data, updated_at,
    status, version, pending_mime, pending_data, pending_updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

test("migration 0003 creates the attachments table with the expected columns and indexes", () => {
  const db = openV2Db();

  const before = objectNamesForType(db, "table");
  assert.ok(!before.includes("attachments"), "attachments must not exist before 0003");

  applyAttachments(db);

  const tables = objectNamesForType(db, "table");
  assert.ok(tables.includes("attachments"), "attachments table must exist after 0003");

  const columns = columnsOf(db, "attachments");
  for (const name of [
    "id",
    "post_id",
    "created_by",
    "created_at",
    "mime",
    "data",
    "updated_at",
    "status",
    "version",
    "pending_mime",
    "pending_data",
    "pending_updated_at",
  ]) {
    assert.ok(columns.includes(name), `missing column attachments.${name}`);
  }

  const indexes = objectNamesForType(db, "index");
  assert.ok(indexes.includes("idx_attachments_post"), "missing index idx_attachments_post");
  assert.ok(indexes.includes("idx_attachments_pending"), "missing index idx_attachments_pending");

  const parents = db.prepare("PRAGMA foreign_key_list(attachments)").all();
  const postRef = parents.find((fk) => fk.table === "posts");
  assert.ok(postRef, "attachments must reference posts");
  assert.equal(postRef.on_delete, "CASCADE", "post deletion must cascade to attachments");
  assert.ok(parents.some((fk) => fk.table === "users"), "attachments must reference users");
});

test("migration 0003 accepts a valid pending attachment row", () => {
  const db = openV2Db();
  applyAttachments(db);

  db.prepare(insertAttachment).run(
    "att-pending", 1, 1, T + 80, null, null, null,
    "pending", version, "image/png", png, T + 80,
  );
  const row = db.prepare(
    "SELECT id, post_id, created_by, created_at, status, version, pending_mime FROM attachments WHERE id = ?",
  ).get("att-pending");
  assert.equal(row.id, "att-pending");
  assert.equal(row.post_id, 1);
  assert.equal(row.created_by, 1);
  assert.equal(row.created_at, T + 80);
  assert.equal(row.status, "pending");
  assert.equal(row.version, version);
  assert.equal(row.pending_mime, "image/png");
});

test("attachments mime CHECK accepts the four sniffed types and rejects everything else", () => {
  const db = openV2Db();
  applyAttachments(db);

  let n = 0;
  for (const mime of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
    db.prepare(insertAttachment).run(
      `att-${(n += 1)}`, 1, 1, T + 80, null, null, null,
      "pending", version, mime, png, T + 80,
    );
  }
  // Approved-set mime is checked the same way.
  db.prepare(insertAttachment).run(
    "att-approved-gif", 1, 1, T + 80, "image/gif", gif, T + 80,
    "approved", version, null, null, null,
  );
  expectSqlRejection(db, insertAttachment, "att-bmp", 1, 1, T + 80, null, null, null, "pending", version, "image/bmp", png, T + 80);
  expectSqlRejection(db, insertAttachment, "att-bmp-approved", 1, 1, T + 80, "image/bmp", png, T + 80, "approved", version, null, null, null);
});

test("attachments status CHECK rejects unknown values and defaults to pending", () => {
  const db = openV2Db();
  applyAttachments(db);

  const insertNoStatus = `
    INSERT INTO attachments (id, post_id, created_by, created_at, version, pending_mime, pending_data, pending_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.prepare(insertNoStatus).run("att-default", 1, 1, T + 80, version, "image/png", png, T + 80);
  assert.equal(db.prepare("SELECT status FROM attachments WHERE id = ?").get("att-default").status, "pending");

  expectSqlRejection(db, insertAttachment, "att-weird", 1, 1, T + 80, null, null, null, "weird", version, "image/png", png, T + 80);
  expectSqlRejection(db, insertAttachment, "att-open", 1, 1, T + 80, null, null, null, "open", version, "image/png", png, T + 80);
});

test("attachments consistency CHECKs pin status against both byte sets", () => {
  const db = openV2Db();
  applyAttachments(db);

  const at = T + 80;
  // Approved pair populated, status approved, pending empty: valid.
  db.prepare(insertAttachment).run("att-a", 1, 1, at, "image/png", png, at, "approved", version, null, null, null);
  // Pending pair populated, status pending, approved empty: valid.
  db.prepare(insertAttachment).run("att-b", 1, 1, at, null, null, null, "pending", version, "image/png", png, at);
  // Transient rejected state with both sets empty: valid.
  db.prepare(insertAttachment).run("att-c", 1, 1, at, null, null, null, "rejected", version, null, null, null);

  // Half-populated pending pair (bytes without mime or timestamp): rejected.
  expectSqlRejection(db, insertAttachment, "att-d", 1, 1, at, null, null, null, "pending", version, null, png, null);
  expectSqlRejection(db, insertAttachment, "att-e", 1, 1, at, null, null, null, "pending", version, "image/png", null, at);
  // Half-populated approved pair: rejected.
  expectSqlRejection(db, insertAttachment, "att-f", 1, 1, at, null, png, null, "approved", version, null, null, null);
  expectSqlRejection(db, insertAttachment, "att-g", 1, 1, at, "image/png", null, at, "approved", version, null, null, null);
  // Status pending without a pending pair: rejected.
  expectSqlRejection(db, insertAttachment, "att-h", 1, 1, at, null, null, null, "pending", version, null, null, null);
  // Status approved without an approved pair: rejected.
  expectSqlRejection(db, insertAttachment, "att-i", 1, 1, at, null, null, null, "approved", version, null, null, null);
  // Approved with a pending pair still present: rejected.
  expectSqlRejection(db, insertAttachment, "att-j", 1, 1, at, "image/png", png, at, "approved", version, "image/png", png, at);
  // Pending with an approved pair present: rejected.
  expectSqlRejection(db, insertAttachment, "att-k", 1, 1, at, "image/png", png, at, "pending", version, "image/png", png, at);
  // Rejected with either set populated: rejected.
  expectSqlRejection(db, insertAttachment, "att-l", 1, 1, at, null, null, null, "rejected", version, "image/png", png, at);
  expectSqlRejection(db, insertAttachment, "att-m", 1, 1, at, "image/png", png, at, "rejected", version, null, null, null);
});

test("attachment blobs are capped at 1 MiB like avatar blobs", () => {
  const db = openV2Db();
  applyAttachments(db);

  const at = T + 80;
  const tooBig = Buffer.alloc(1_048_577, 0x42);
  const max = Buffer.alloc(1_048_576, 0x42);
  expectSqlRejection(db, insertAttachment, "att-big", 1, 1, at, null, null, null, "pending", version, "image/jpeg", tooBig, at);
  db.prepare(insertAttachment).run("att-max", 1, 1, at, null, null, null, "pending", version, "image/jpeg", max, at);
  expectSqlRejection(db, insertAttachment, "att-big-approved", 1, 1, at, "image/jpeg", tooBig, at, "approved", version, null, null, null);
});

test("attachment FKs are enforced and deleting a post cascades its attachments", () => {
  const db = openV2Db();
  applyAttachments(db);

  const at = T + 80;
  db.prepare(insertAttachment).run("att-cascade", 3, 1, at, null, null, null, "pending", version, "image/png", png, at);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attachments").get().n, 1);

  // Unknown author: rejected.
  expectSqlRejection(db, insertAttachment, "att-orphan-user", 3, 999, at, null, null, null, "pending", version, "image/png", png, at);
  // Unknown post: rejected.
  expectSqlRejection(db, insertAttachment, "att-orphan-post", 999, 1, at, null, null, null, "pending", version, "image/png", png, at);

  db.prepare("DELETE FROM posts WHERE id = 3").run();
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM attachments WHERE id = ?").get("att-cascade").n,
    0,
    "attachment must be cascade-deleted with its post",
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attachments").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM posts").get().n, 2);
});