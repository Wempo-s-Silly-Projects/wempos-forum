import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  path.join(root, "migrations", "0025_attachment_gif_identity.sql"),
  "utf8",
);

test("migration 0025 records the library GIF identity on existing and new attachment schemas", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      post_id INTEGER NOT NULL,
      source_kind TEXT NOT NULL DEFAULT 'legacy'
    );
    INSERT INTO attachments (id, post_id, source_kind) VALUES ('old', 10, 'gif');
  `);

  db.exec(migration);
  const columns = db.prepare("PRAGMA table_info(attachments)").all().map((row) => row.name);
  assert.ok(columns.includes("source_gif_id"));
  assert.equal(
    db.prepare("SELECT source_gif_id FROM attachments WHERE id = 'old'").get().source_gif_id,
    null,
    "historical rows remain unknown rather than being assigned a guessed GIF identity",
  );

  db.prepare(
    "INSERT INTO attachments (id, post_id, source_kind, source_gif_id) VALUES (?, ?, 'gif', ?)",
  ).run("new", 10, "123e4567-e89b-12d3-a456-426614174000");
  assert.equal(
    db.prepare("SELECT source_gif_id FROM attachments WHERE id = 'new'").get().source_gif_id,
    "123e4567-e89b-12d3-a456-426614174000",
  );
  assert.ok(
    db.prepare("EXPLAIN QUERY PLAN SELECT source_gif_id FROM attachments WHERE post_id = ? AND source_gif_id = ?")
      .all(10, "123e4567-e89b-12d3-a456-426614174000").length > 0,
  );
});
