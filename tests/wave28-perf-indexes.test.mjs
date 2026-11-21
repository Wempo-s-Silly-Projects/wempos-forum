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
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// Wave 2026-11-21-28 F1 (query plans): every chat poll (/api/chat) sums the
// viewer's DM unread counters and /api/dm/threads lists the viewer's 1:1
// threads, both with `user_a = ? OR user_b = ?`. The UNIQUE(user_a, user_b)
// autoindex serves only the user_a arm, so without an index led by user_b
// SQLite full-scans dm_threads on every poll. Migration 0059 adds that index;
// this suite pins its existence and that the live SQL (captured from the real
// handlers, not copied) now plans as SEARCH on both arms.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv, MIGRATIONS_DIR } from "./helpers/d1.mjs";
import { call, forgeSession, seedUser } from "./helpers/seed.mjs";

const INDEX_NAME = "idx_forum_perf_dm_threads_user_b";
const MIGRATION = "0059_forum_perf_indexes.sql";

async function captureDmThreadSql() {
  const env = makeEnv();
  const db = env.__sqlite;
  const viewer = await seedUser(db, { username: "viewer" });
  const other = await seedUser(db, { username: "other" });
  db.prepare("INSERT INTO dm_threads (user_a, user_b, created_at) VALUES (?, ?, ?)").run(viewer, other, 1);
  const session = forgeSession(db, viewer);
  const proto = Object.getPrototypeOf(env.FORUM_DB.prepare("SELECT 1"));
  const original = proto.execute;
  const captured = [];
  proto.execute = function capture() {
    if (/FROM dm_threads/i.test(this.sql) && /user_b = \?/.test(this.sql) && /\bOR\b/.test(this.sql)) {
      captured.push({ sql: this.sql, params: this.params });
    }
    return original.call(this);
  };
  try {
    for (const path of ["/api/chat", "/api/dm/threads"]) {
      const response = await call(env, path, { session });
      assert.equal(response.status, 200, path);
    }
  } finally {
    proto.execute = original;
  }
  return { db, captured };
}

test("migration 0059 holds only CREATE INDEX IF NOT EXISTS lines", () => {
  const lines = readFileSync(MIGRATIONS_DIR + "/" + MIGRATION, "utf8").split("\n").filter((line) => line.trim());
  assert.ok(lines.length >= 1);
  for (const line of lines) {
    assert.match(line, /^CREATE INDEX IF NOT EXISTS idx_forum_perf_[a-z_]+ ON [a-z_]+\([a-z_, ]+\);$/);
  }
});

test("dm_threads gains an index led by user_b", () => {
  const db = makeEnv().__sqlite;
  const row = db.prepare("SELECT tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(INDEX_NAME);
  assert.ok(row, INDEX_NAME + " exists after migrations");
  assert.equal(row.tbl_name, "dm_threads");
  assert.match(row.sql, /ON dm_threads\(user_b\)/);
});

test("chat-poll unread sum and DM thread list search dm_threads instead of scanning it", async () => {
  const { db, captured } = await captureDmThreadSql();
  assert.ok(captured.length >= 2, "captured the unread sum and the thread list");
  for (const { sql, params } of captured) {
    const plan = db.prepare("EXPLAIN QUERY PLAN " + sql).all(...params).map((row) => row.detail);
    assert.ok(!plan.some((detail) => /^SCAN (t|dm_threads)\b/.test(detail)), "no full scan: " + plan.join(" | "));
    assert.ok(plan.some((detail) => detail.includes("USING INDEX " + INDEX_NAME)), "user_b arm uses the index: " + plan.join(" | "));
  }
});
