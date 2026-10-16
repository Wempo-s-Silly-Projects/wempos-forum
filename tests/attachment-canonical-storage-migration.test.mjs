import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  path.join(root, "migrations", "0020_materialize_approved_attachment_bytes.sql"),
  "utf8",
);

function fixtureDb() {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  db.exec(`
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
  `);

  db.prepare("INSERT INTO attachments (id, hash, status, created_at) VALUES (?, ?, ?, ?)").run(
    "attachment-source", "hash-a", "approved", 10,
  );
  db.prepare("INSERT INTO attachment_chunks (attachment_id, kind, seq, data) VALUES (?, 'approved', ?, ?)").run(
    "attachment-source", 0, Buffer.from([1, 2, 3]),
  );
  db.prepare("INSERT INTO attachment_chunks (attachment_id, kind, seq, data) VALUES (?, 'approved', ?, ?)").run(
    "attachment-source", 1, Buffer.from([4, 5]),
  );
  db.prepare("INSERT INTO attachments (id, hash, status, created_at) VALUES (?, ?, ?, ?)").run(
    "legacy-alias", "hash-a", "approved", 20,
  );
  db.prepare("INSERT INTO attachments (id, hash, status, created_at) VALUES (?, ?, ?, ?)").run(
    "already-materialized", "hash-a", "approved", 30,
  );
  db.prepare("INSERT INTO attachment_chunks (attachment_id, kind, seq, data) VALUES (?, 'approved', ?, ?)").run(
    "already-materialized", 0, Buffer.from([9, 9]),
  );

  db.prepare("INSERT INTO attachments (id, hash, status, created_at) VALUES (?, ?, ?, ?)").run(
    "gif-backed-alias", "hash-b", "approved", 40,
  );
  db.prepare("INSERT INTO gifs (id, hash, status) VALUES (?, ?, ?)").run(
    "gif-source", "hash-b", "approved",
  );
  db.prepare("INSERT INTO gif_chunks (gif_id, seq, data) VALUES (?, ?, ?)").run(
    "gif-source", 0, Buffer.from([7, 8, 9, 10]),
  );

  db.prepare("INSERT INTO attachments (id, hash, status, created_at) VALUES (?, ?, ?, ?)").run(
    "missing-source", "hash-no-source", "approved", 50,
  );
  db.prepare("INSERT INTO attachments (id, hash, status, created_at) VALUES (?, ?, ?, ?)").run(
    "still-pending", "hash-a", "pending", 60,
  );
  return db;
}

function chunksFor(db, attachmentId) {
  return db.prepare(
    "SELECT seq, data FROM attachment_chunks WHERE attachment_id = ? AND kind = 'approved' ORDER BY seq",
  ).all(attachmentId);
}

test("migration materializes legacy approved attachment aliases from an approved attachment", () => {
  const db = fixtureDb();
  db.exec(migration);

  const source = chunksFor(db, "attachment-source");
  const alias = chunksFor(db, "legacy-alias");
  assert.deepEqual(alias.map((row) => row.seq), [0, 1]);
  assert.deepEqual(alias.map((row) => [...row.data]), source.map((row) => [...row.data]));
});

test("migration uses an approved GIF when no approved attachment owns the bytes", () => {
  const db = fixtureDb();
  db.exec(migration);

  const alias = chunksFor(db, "gif-backed-alias");
  assert.equal(alias.length, 1);
  assert.equal(alias[0].seq, 0);
  assert.deepEqual([...alias[0].data], [7, 8, 9, 10]);
});

test("migration preserves existing chunks and leaves unresolved or pending rows alone", () => {
  const db = fixtureDb();
  db.exec(migration);

  assert.deepEqual(chunksFor(db, "already-materialized").map((row) => [...row.data]), [[9, 9]]);
  assert.deepEqual(chunksFor(db, "missing-source"), []);
  assert.deepEqual(chunksFor(db, "still-pending"), []);
});
