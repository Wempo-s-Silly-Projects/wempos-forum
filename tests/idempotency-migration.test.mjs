import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  path.join(root, "migrations", "0024_idempotency_fingerprints_and_attachment_sources.sql"),
  "utf8",
);

test("migration 0024 adds replay snapshots and safe attachment provenance defaults", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      author_id INTEGER NOT NULL,
      parent_id INTEGER,
      body TEXT NOT NULL,
      board TEXT,
      idempotency_key TEXT
    );
    CREATE TABLE post_archive (
      id INTEGER PRIMARY KEY,
      original_post_id INTEGER NOT NULL,
      author_id INTEGER,
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      board TEXT,
      created_at INTEGER NOT NULL,
      deleted_at INTEGER NOT NULL,
      deleted_because TEXT NOT NULL
    );
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      post_id INTEGER NOT NULL
    );
  `);

  assert.doesNotThrow(() => db.exec(migration));
  const postColumns = db.prepare("PRAGMA table_info(posts)").all().map((row) => row.name);
  const archiveColumns = db.prepare("PRAGMA table_info(post_archive)").all().map((row) => row.name);
  const attachmentColumns = db.prepare("PRAGMA table_info(attachments)").all();

  assert.ok(postColumns.includes("idempotency_fingerprint"));
  assert.ok(archiveColumns.includes("idempotency_key"));
  assert.ok(archiveColumns.includes("idempotency_fingerprint"));
  assert.ok(attachmentColumns.some((row) => row.name === "source_kind" && row.dflt_value === "'legacy'"));

  db.prepare("INSERT INTO attachments (id, post_id) VALUES ('legacy-attachment', 1)").run();
  assert.equal(
    db.prepare("SELECT source_kind FROM attachments WHERE id = 'legacy-attachment'").get().source_kind,
    "legacy",
  );
});
