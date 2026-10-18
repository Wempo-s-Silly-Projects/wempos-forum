import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration27 = readFileSync(
  path.join(root, "migrations", "0027_gallery_images.sql"),
  "utf8",
);
const migration28 = readFileSync(
  path.join(root, "migrations", "0028_recover_gallery_chunks.sql"),
  "utf8",
);

test("Gallery MIME migration preserves existing GIF chunk bytes", () => {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE gifs (
      id TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      mime TEXT NOT NULL CHECK (mime IN ('image/gif')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      version TEXT NOT NULL,
      use_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE gif_chunks (
      gif_id TEXT NOT NULL REFERENCES gifs(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      data BLOB NOT NULL CHECK (length(data) <= 2000000),
      PRIMARY KEY (gif_id, seq)
    );
    INSERT INTO users (id) VALUES (7);
    INSERT INTO gifs (id, hash, uploader_id, mime, status, version, use_count, created_at)
      VALUES ('gif-1', 'hash-1', 7, 'image/gif', 'approved', 'v1', 3, 10);
    INSERT INTO gif_chunks (gif_id, seq, data) VALUES ('gif-1', 0, X'474946383961');
    INSERT INTO gif_chunks (gif_id, seq, data) VALUES ('gif-1', 1, X'010203');
  `);

  db.exec(migration27);

  const rows = db.prepare(
    "SELECT seq, data FROM gif_chunks WHERE gif_id = 'gif-1' ORDER BY seq",
  ).all();
  assert.deepEqual(rows.map((row) => row.seq), [0, 1]);
  assert.deepEqual(rows.map((row) => [...row.data]), [[71, 73, 70, 56, 57, 97], [1, 2, 3]]);
  assert.equal(
    db.prepare("SELECT mime FROM gifs WHERE id = 'gif-1'").get().mime,
    "image/gif",
  );
  db.prepare(
    "INSERT INTO gifs (id, hash, mime, status, version, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("png-1", "hash-png", "image/png", "pending", "v2", 11);
  db.close();
});

test("Gallery recovery migration copies only matching approved attachment bytes", () => {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  db.exec(`
    CREATE TABLE gifs (
      id TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE gif_chunks (
      gif_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY (gif_id, seq)
    );
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE attachment_chunks (
      attachment_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      seq INTEGER NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY (attachment_id, kind, seq)
    );
    CREATE TABLE revoked_attachment_hashes (hash TEXT PRIMARY KEY);

    INSERT INTO gifs (id, hash, status) VALUES ('recoverable', 'hash-a', 'approved');
    INSERT INTO gifs (id, hash, status) VALUES ('pending-recoverable', 'hash-a', 'pending');
    INSERT INTO gifs (id, hash, status) VALUES ('unrecoverable', 'hash-b', 'approved');
    INSERT INTO gifs (id, hash, status) VALUES ('already-has-bytes', 'hash-c', 'approved');
    INSERT INTO gifs (id, hash, status) VALUES ('revoked', 'hash-d', 'approved');
    INSERT INTO gif_chunks (gif_id, seq, data) VALUES ('already-has-bytes', 0, X'0909');
    INSERT INTO attachments (id, hash, status, created_at) VALUES ('source-a', 'hash-a', 'approved', 10);
    INSERT INTO attachment_chunks (attachment_id, kind, seq, data) VALUES ('source-a', 'approved', 0, X'010203');
    INSERT INTO attachment_chunks (attachment_id, kind, seq, data) VALUES ('source-a', 'approved', 1, X'0405');
    INSERT INTO attachments (id, hash, status, created_at) VALUES ('pending-source', 'hash-b', 'pending', 11);
    INSERT INTO attachment_chunks (attachment_id, kind, seq, data) VALUES ('pending-source', 'approved', 0, X'0607');
    INSERT INTO attachments (id, hash, status, created_at) VALUES ('source-d', 'hash-d', 'approved', 12);
    INSERT INTO attachment_chunks (attachment_id, kind, seq, data) VALUES ('source-d', 'approved', 0, X'0809');
    INSERT INTO revoked_attachment_hashes (hash) VALUES ('hash-d');
  `);

  db.exec(migration28);

  const recovered = db.prepare(
    "SELECT seq, data FROM gif_chunks WHERE gif_id = 'recoverable' ORDER BY seq",
  ).all();
  assert.deepEqual(recovered.map((row) => row.seq), [0, 1]);
  assert.deepEqual(recovered.map((row) => [...row.data]), [[1, 2, 3], [4, 5]]);
  const pendingRecovered = db.prepare(
    "SELECT seq, data FROM gif_chunks WHERE gif_id = 'pending-recoverable' ORDER BY seq",
  ).all();
  assert.deepEqual(pendingRecovered.map((row) => row.seq), [0, 1]);
  assert.deepEqual(pendingRecovered.map((row) => [...row.data]), [[1, 2, 3], [4, 5]]);
  assert.equal(db.prepare("SELECT status FROM gifs WHERE id = 'pending-recoverable'").get().status, "pending");
  assert.deepEqual(
    db.prepare("SELECT seq, data FROM gif_chunks WHERE gif_id = 'unrecoverable'").all(),
    [],
  );
  assert.deepEqual(
    db.prepare("SELECT seq, data FROM gif_chunks WHERE gif_id = 'already-has-bytes'").all().map((row) => [...row.data]),
    [[9, 9]],
  );
  assert.deepEqual(
    db.prepare("SELECT seq, data FROM gif_chunks WHERE gif_id = 'revoked'").all(),
    [],
  );
  db.close();
});
