import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reconciliation = readFileSync(
  path.join(root, "docs", "sql", "reconcile-0019-migration-history.sql"),
  "utf8",
);

function fixtureDb({ unresolvedPendingCss = false } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      pending_css TEXT,
      pending_css_version TEXT,
      css_status TEXT NOT NULL DEFAULT 'none'
    );
    CREATE TABLE d1_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  if (unresolvedPendingCss) {
    db.prepare(
      "INSERT INTO users (id, pending_css, pending_css_version, css_status) VALUES (1, 'pending CSS', NULL, 'pending')",
    ).run();
  }
  return db;
}

test("migration reconciliation records 0019 once when the schema and data invariant match", () => {
  const db = fixtureDb();
  db.exec(reconciliation);
  db.exec(reconciliation);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM d1_migrations WHERE name = '0019_css_submission_version.sql'").get().count,
    1,
  );
});

test("migration reconciliation refuses to advance history when a pending CSS row lacks a version", () => {
  const db = fixtureDb({ unresolvedPendingCss: true });
  db.exec(reconciliation);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM d1_migrations WHERE name = '0019_css_submission_version.sql'").get().count,
    0,
  );
});
