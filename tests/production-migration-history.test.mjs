import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preflight = readFileSync(path.join(root, "docs/sql/preflight-production-migration-history.sql"), "utf8");
const cssPreflight = readFileSync(path.join(root, "docs/sql/preflight-css-submission-version.sql"), "utf8");
const reconcile = readFileSync(path.join(root, "docs/sql/reconcile-production-migration-history.sql"), "utf8");

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      pending_css TEXT,
      pending_css_version TEXT,
      css_status TEXT NOT NULL DEFAULT 'none'
    );
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      author_id INTEGER NOT NULL,
      parent_id INTEGER,
      body TEXT NOT NULL,
      board TEXT,
      idempotency_key TEXT
    );
    CREATE UNIQUE INDEX idx_posts_author_idempotency_key
      ON posts(author_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE TABLE post_archive (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_post_id INTEGER NOT NULL,
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      board TEXT,
      created_at INTEGER NOT NULL,
      deleted_at INTEGER NOT NULL,
      deleted_because TEXT NOT NULL,
      deleted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      deleted_by_name TEXT,
      idempotency_key TEXT,
      idempotency_fingerprint TEXT
    );
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      post_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      hash TEXT NOT NULL
    );
    CREATE TABLE attachment_chunks (
      attachment_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      seq INTEGER NOT NULL,
      data BLOB NOT NULL
    );
    CREATE TABLE gifs (id TEXT PRIMARY KEY, hash TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE revoked_attachment_hashes (
      hash TEXT PRIMARY KEY, revoked_at INTEGER NOT NULL,
      revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE d1_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (id, username) VALUES (7, 'author');
    INSERT INTO d1_migrations (name) VALUES ('0018_profile_reports.sql');
    INSERT INTO gifs (id, hash, status) VALUES ('gif-1', 'gif-hash', 'approved');
    INSERT INTO attachments (id, post_id, status, hash) VALUES ('gif-alias', 99, 'approved', 'gif-hash');
    INSERT INTO post_archive (original_post_id, author_id, author_name, body, board, created_at, deleted_at, deleted_because)
      VALUES (44, 7, 'author', 'archived body', 'general', 1, 2, 'post-delete');
  `);
  return db;
}

test("production preflight is read-only and covers ledger, CSS, schema, and byte-source drift", () => {
  assert.match(preflight, /^-- READ-ONLY/m);
  assert.doesNotMatch(preflight, /^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/im);
  assert.match(preflight, /approved_uploads_without_bytes_or_source/);
  assert.match(preflight, /gif_backed_aliases_keep_by_reference/);
  assert.match(preflight, /0024_idempotency_fingerprints_and_attachment_sources\.sql/);
  assert.doesNotMatch(
    preflight,
    /pending_css_version IS NULL/,
    "the base preflight must not reference a column that may not exist yet",
  );
  assert.match(cssPreflight, /pending_css_version IS NULL/);
  assert.match(cssPreflight, /Run only when .*has_0019_column = 1/);
});

test("manual production reconciliation is idempotent and preserves GIF references", () => {
  const db = fixture();
  assert.match(reconcile, /MANUAL RECOVERY ONLY/);
  db.exec(reconcile);
  db.exec(reconcile);

  const entries = db.prepare("SELECT name FROM d1_migrations ORDER BY name").all().map((row) => row.name);
  for (const name of [
    "0019_css_submission_version.sql",
    "0020_materialize_approved_attachment_bytes.sql",
    "0021_post_creation_idempotency.sql",
    "0022_revoked_attachment_hashes.sql",
    "0023_post_archive_deleted_by.sql",
  ]) {
    assert.equal(entries.filter((entry) => entry === name).length, 1, name);
  }
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM attachment_chunks WHERE attachment_id = 'gif-alias'").get().count,
    0,
    "the reconciliation must not copy bytes from the approved GIF library",
  );
  const archived = db.prepare(
    "SELECT deleted_by_user_id, deleted_by_name FROM post_archive WHERE original_post_id = 44",
  ).get();
  assert.equal(archived.deleted_by_user_id, 7);
  assert.equal(archived.deleted_by_name, "author");
});
