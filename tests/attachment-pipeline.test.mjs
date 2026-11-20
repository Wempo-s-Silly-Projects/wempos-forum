// Copyright 2026 ItsWempo
//
// This file is part of Wempo's Forum.
//
// Wempo's Forum is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the
// GNU Affero General Public License along with this program.  If not,
// see <https://www.gnu.org/licenses/>.

// Attachment/gif chunk pipeline (the 2026-11-19 full-DB read defect lane):
// metadata must never commit without its chunk bytes in the same all-or-nothing
// batch, and read shapes must never advertise a row whose bytes are gone
// (legacy debris) — list reads omit it, direct reads keep the shared 404.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { insertAttachments, attachmentRowsForView } from "../api/attachments.mjs";

// A minimal D1-shaped adapter over node:sqlite: prepare().bind() statement
// handles, and an ATOMIC batch (BEGIN/COMMIT with rollback on throw — the
// contract D1's batch gives the write path).
class SqliteStatement {
  constructor(sqlite, sql) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.params = [];
  }
  bind(...params) {
    this.params = params;
    return this;
  }
  all() {
    const stmt = this.sqlite.prepare(this.sql);
    return { results: stmt.all(...this.params) };
  }
  first() {
    const stmt = this.sqlite.prepare(this.sql);
    return stmt.get(...this.params) ?? null;
  }
  run() {
    return this.sqlite.prepare(this.sql).run(...this.params);
  }
}

class SqliteD1 {
  constructor(sqlite) {
    this.sqlite = sqlite;
  }
  prepare(sql) {
    return new SqliteStatement(this.sqlite, sql);
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement, index) => {
        const info = this.sqlite.prepare(statement.sql).run(...statement.params);
        return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) }, index };
      });
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function pipelineDb() {
  const sqlite = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  sqlite.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE posts (id INTEGER PRIMARY KEY);
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      version TEXT NOT NULL,
      mime TEXT NOT NULL,
      hash TEXT,
      source_kind TEXT NOT NULL DEFAULT 'upload',
      source_gif_id TEXT
    );
    CREATE TABLE attachment_chunks (
      attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('pending', 'approved')),
      seq INTEGER NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY (attachment_id, kind, seq)
    );
    CREATE TABLE gifs (
      id TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      mime TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      version TEXT NOT NULL,
      use_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE gif_chunks (
      gif_id TEXT NOT NULL REFERENCES gifs(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY (gif_id, seq)
    );
    CREATE TABLE revoked_attachment_hashes (hash TEXT PRIMARY KEY);
    INSERT INTO users (id) VALUES (7);
    INSERT INTO posts (id) VALUES (100);
  `);
  return new SqliteD1(sqlite);
}

const FILE = { mime: "image/gif", bytes: new Uint8Array([1, 2, 3, 4]), hash: "hash-file", preApproved: false };

test("insertAttachments commits the metadata row and its chunks in one batch", async () => {
  const db = pipelineDb();
  await insertAttachments(db, 100, 7, [FILE], []);
  const chunks = db.prepare(
    "SELECT c.seq, c.data FROM attachment_chunks c JOIN attachments a ON a.id = c.attachment_id WHERE a.post_id = ? ORDER BY c.seq",
  ).bind(100).all();
  assert.equal(chunks.results.length, 1, "a committed attachment row always owns chunk rows");
});

test("a mid-batch intake failure rolls back the metadata row AND its chunks", async () => {
  const db = pipelineDb();
  // The gif-reference INSERT emits status 'invalid' when the selected library
  // gif no longer resolves — that trips the status CHECK mid-batch, after the
  // direct-upload row and its chunks have already been built.
  await assert.rejects(
    () => insertAttachments(db, 100, 7, [FILE], [{ id: "gif-gone", hash: "hash-gone", mime: "image/gif", file: false }]),
    /selected GIFs is no longer available/,
  );
  assert.deepEqual(
    db.prepare("SELECT id FROM attachments").all().results,
    [...[]],
    "no partial metadata survives a failed intake batch",
  );
  assert.deepEqual(
    db.prepare("SELECT attachment_id FROM attachment_chunks").all().results,
    [...[]],
    "no orphan chunk rows survive a failed intake batch",
  );
});

test("attachmentRowsForView omits rows whose bytes are gone and keeps servable rows", async () => {
  const db = pipelineDb();
  const seed = sqliteSeed(db);
  // Dead uploads: approved/pending rows with no chunks and no canonical.
  seed("INSERT INTO attachments (id, post_id, created_by, created_at, status, version, mime, hash, source_kind) " +
    "VALUES ('dead-approved', 100, 7, 10, 'approved', 'v1', 'image/png', 'hash-dead', 'upload')" +
    ", ('dead-pending', 100, 7, 11, 'pending', 'v1', 'image/png', 'hash-dead2', 'upload')");
  // A healthy upload: approved with its own chunks.
  seed("INSERT INTO attachments (id, post_id, created_by, created_at, status, version, mime, hash, source_kind) " +
    "VALUES ('own-bytes', 100, 7, 12, 'approved', 'v1', 'image/png', 'hash-own', 'upload')");
  seed("INSERT INTO attachment_chunks (attachment_id, kind, seq, data) VALUES ('own-bytes', 'approved', 0, X'0A0B')");
  // A healthy gif reference: no chunks of its own, canonical gif has bytes.
  seed("INSERT INTO attachments (id, post_id, created_by, created_at, status, version, mime, hash, source_kind, source_gif_id) " +
    "VALUES ('ref-alive', 100, 7, 13, 'approved', 'v1', 'image/gif', 'hash-ref', 'gif', 'gif-alive')");
  seed("INSERT INTO gifs (id, hash, uploader_id, mime, status, version, created_at) " +
    "VALUES ('gif-alive', 'hash-ref', 7, 'image/gif', 'approved', 'v1', 5)");
  seed("INSERT INTO gif_chunks (gif_id, seq, data) VALUES ('gif-alive', 0, X'0C0D')");
  // Dead gif reference: its source gif lost its chunks.
  seed("INSERT INTO attachments (id, post_id, created_by, created_at, status, version, mime, hash, source_kind, source_gif_id) " +
    "VALUES ('ref-dead', 100, 7, 14, 'approved', 'v1', 'image/gif', 'hash-ref2', 'gif', 'gif-dead')");
  seed("INSERT INTO gifs (id, hash, uploader_id, mime, status, version, created_at) " +
    "VALUES ('gif-dead', 'hash-ref2', 7, 'image/gif', 'approved', 'v1', 5)");
  const byPost = await attachmentRowsForView(db, [100], null);
  const ids = (byPost.get(100) || []).map((row) => row.id);
  assert.deepEqual(
    ids,
    ["own-bytes", "ref-alive"],
    "a 0-chunk row without resolvable canonical bytes must be omitted; servable rows stay",
  );
});

test("the pending attachments admin queue omits 0-chunk rows", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../api/attachments.mjs", import.meta.url), "utf8");
  const queueQuery = source.split("attachments a JOIN users u ON u.id = a.created_by ")[1];
  assert.ok(queueQuery, "the pending attachments queue query keeps its join shape");
  const queueFlat = queueQuery.slice(0, 1200).replace(/["\n+]/g, " ").replace(/\s+/g, " ");
  assert.match(
    queueFlat,
    /WHERE a\.status = 'pending' AND EXISTS \(SELECT 1 FROM attachment_chunks \w+ WHERE \w+\.attachment_id = a\.id AND \w+\.kind = 'pending'\)/,
    "the queue must omit pending rows whose bytes never landed",
  );
});

test("the pending gallery admin queue omits 0-chunk rows", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../api/gifs.mjs", import.meta.url), "utf8");
  // The queue reads metadata only; a pending row with no gif_chunks can never
  // preview or approve into a servable gif, so it must not render in the desk.
  const queueQuery = source.split('const result = await db.prepare(\n      "SELECT g.id, g.hash, g.mime, g.created_at, u.username AS uploader " +')[1];
  assert.ok(queueQuery, "the pending gallery queue query keeps its shape");
  assert.match(
    queueQuery,
    /EXISTS \(SELECT 1 FROM gif_chunks [a-z]+ WHERE [a-z]+\.gif_id = g\.id\)/,
    "the gallery desk must omit pending rows whose bytes never landed",
  );
});

test("gif upload's dedup restore rewrites the canonical chunk set in one batch", async () => {
  // Regression pin: when an approved gallery hash exists with a lost/empty
  // chunk set, the upload route deletes and reinserts the canonical's chunks
  // inside ONE batch — never leaving a repaired-but-empty window.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../api/gifs.mjs", import.meta.url), "utf8");
  const restore = source.split("const restore = [\n")[1];
  assert.ok(restore, "the upload dedup restore path keeps its batch shape");
  const restoreBatch = restore.split("\n    ];")[0];
  assert.match(restoreBatch, /DELETE FROM gif_chunks WHERE gif_id = \?/);
  assert.match(restoreBatch, /gifChunkInsertStatements\(db, existing\.id, bytes\)/);
  assert.deepEqual(restoreBatch.includes("await db.batch"), false, "the restore statements ride ONE batch, not sequenced runs");
});

function sqliteSeed(db) {
  return (sql) => {
    db.sqlite.prepare(sql).run();
  };
}
