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