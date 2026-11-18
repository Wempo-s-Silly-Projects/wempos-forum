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

// Boost mint (T79 §2.3): the route gates (405 with zero reads before any
// session work; unseen post 404; non-author 403; hidden post 404), the
// mint's idempotency semantics run against REAL sqlite (the NOT EXISTS guard
// inserting 0 rows on a replay), the title/excerpt derivation caps, the
// §2.5 preview byte shape, and the 0043 migration's IF NOT EXISTS shape.
// The route pins ride the recording fake db (tests/totp-routes.test.mjs
// idiom); the SQL-semantics and migration pins run on node:sqlite / a plain
// byte read.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  handleBoostRoutes,
  boostTitleFrom,
  boostExcerptFrom,
  boostPreview,
  BOOST_MINT_INSERT_SQL,
  BOOST_FOR_AUTHOR_SQL,
  BOOST_TITLE_CAP,
  BOOST_EXCERPT_CAP,
} from "../api/boost.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Recording fake db (mirrors tests/totp-routes.test.mjs): statements are
// recorded at bind time, so a gate that throws before any prepare records
// nothing.
function fakeDb(sqlAnswers = {}, runChanges = {}) {
  const statements = [];
  const answer = (sql) => {
    for (const [needle, value] of Object.entries(sqlAnswers)) {
      if (sql.includes(needle)) return typeof value === "function" ? value() : value;
    }
    return null;
  };
  const changes = (sql) => {
    for (const [needle, value] of Object.entries(runChanges)) {
      if (sql.includes(needle)) return value;
    }
    return 1;
  };
  const mk = (sql, params) => {
    statements.push({ sql, params });
    return {
      first: async () => answer(sql),
      all: async () => ({ results: [] }),
      run: async () => ({ meta: { changes: changes(sql), last_row_id: statements.length } }),
    };
  };
  return {
    statements,
    prepare: (sql) => ({
      first: async () => answer(sql),
      all: async () => ({ results: [] }),
      bind: (...params) => mk(sql, params),
    }),
    batch: async (stmts) => stmts.map((_, index) => ({ meta: { changes: 1, last_row_id: index + 1 } })),
  };
}

const SESSION_TOKEN = "A".repeat(44);
const CSRF_TOKEN = "c".repeat(24);
const SESSION_ANSWER = {
  token_hash: "h", user_id: 2, csrf_token: CSRF_TOKEN, expires_at: 9999999999,
  username: "tester", role: "member", bio: "", avatar_status: null,
  avatar_mime: null, avatar_updated_at: null, avatar_version: null, totp_enabled: 0,
};

function mintEnv(db) {
  return {
    FORUM_DB: db,
    POST_WRITE_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
}

function mintRequest(body) {
  return new Request("https://forum.test/api/boost", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "Origin": "https://forum.test",
      "X-CSRF-Token": CSRF_TOKEN,
      "Cookie": "__Host-wempo_session=" + SESSION_TOKEN,
    },
  });
}

test("a GET or stray method is a 405 with zero database reads", async () => {
  const db = fakeDb();
  await assert.rejects(
    handleBoostRoutes(new Request("https://forum.test/api/boost", { method: "GET" }),
      mintEnv(db), new URL("https://forum.test/api/boost"), "/api/boost", "GET"),
    (error) => error.status === 405,
  );
  assert.equal(db.statements.length, 0);
});

test("an unseen post is a 404 after exactly the post lookup", async () => {
  const db = fakeDb({
    "FROM sessions s LEFT JOIN users": SESSION_ANSWER,
    "banned_ips": null,
  });
  await assert.rejects(
    handleBoostRoutes(mintRequest({ post_id: 9 }), mintEnv(db),
      new URL("https://forum.test/api/boost"), "/api/boost", "POST"),
    (error) => error.status === 404,
  );
});

test("a member cannot boost another member's post (403)", async () => {
  const db = fakeDb({
    "FROM sessions s LEFT JOIN users": SESSION_ANSWER,
    "banned_ips": null,
    "AS parent_body": {
      id: 9, author_id: 3, parent_id: null, visibility: "public",
      body: "not mine", created_at: 1,
    },
  });
  await assert.rejects(
    handleBoostRoutes(mintRequest({ post_id: 9 }), mintEnv(db),
      new URL("https://forum.test/api/boost"), "/api/boost", "POST"),
    (error) => error.status === 403,
  );
  assert.equal(db.statements.some((s) => s.sql.includes("INSERT INTO gc_fleet_boosts")), false);
});

test("a hidden post is a 404 for its own non-staff author", async () => {
  const db = fakeDb({
    "FROM sessions s LEFT JOIN users": SESSION_ANSWER,
    "banned_ips": null,
    "AS parent_body": {
      id: 9, author_id: 2, parent_id: null, visibility: "hidden",
      body: "staged", created_at: 1,
    },
  });
  await assert.rejects(
    handleBoostRoutes(mintRequest({ post_id: 9 }), mintEnv(db),
      new URL("https://forum.test/api/boost"), "/api/boost", "POST"),
    (error) => error.status === 404,
  );
  assert.equal(db.statements.some((s) => s.sql.includes("INSERT INTO gc_fleet_boosts")), false);
});

test("the author's mint inserts a PENDING row and answers the preview bytes", async () => {
  const bodyText = "A".repeat(130) + " the tail";
  const db = fakeDb({
    "FROM sessions s LEFT JOIN users": SESSION_ANSWER,
    "banned_ips": null,
    "AS parent_body": {
      id: 9, author_id: 2, parent_id: null, visibility: "public",
      body: bodyText, created_at: 1,
    },
    "FROM gc_fleet_boosts WHERE forum_post_id": {
      id: 5, thread_title: "", thread_excerpt: "", created_at: 1,
      rendered_message_id: null,
    },
  });
  const response = await handleBoostRoutes(mintRequest({ post_id: 9 }), mintEnv(db),
    new URL("https://forum.test/api/boost"), "/api/boost", "POST");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.boostId, 5);
  assert.equal(payload.pending, true);
  const insert = db.statements.find((s) => s.sql.includes("INSERT INTO gc_fleet_boosts"));
  assert.ok(insert, "the mint insert ran");
  // The §2.5 preview bytes, from the request's own origin.
  const title = bodyText.slice(0, BOOST_TITLE_CAP) + "…";
  const excerpt = bodyText.slice(BOOST_TITLE_CAP);
  // Bind order: post, author, title, excerpt, now, then the guard's re- pair.
  assert.deepEqual(insert.params.slice(0, 4), [9, 2, title, excerpt]);
  assert.equal(insert.params[5], 9);
  assert.equal(insert.params[6], 2);
  assert.equal(typeof payload.preview, "string");
  assert.equal(
    payload.preview,
    "[Forum boost] " + title + "\n\n" + excerpt + "\n\n" +
      "Posted in the forum by tester — read it at https://forum.test/posts/9",
  );
  assert.equal(payload.threadTitle, title);
  assert.equal(payload.threadExcerpt, excerpt);
});

test("the preview composer reproduces the §2.5 byte shape exactly", () => {
  assert.equal(
    boostPreview(
      { threadTitle: "The Well", threadExcerpt: "a quiet evening", postId: 12 },
      "https://forum.test",
      "goobster",
    ),
    "[Forum boost] The Well\n\na quiet evening\n\n" +
      "Posted in the forum by goobster — read it at https://forum.test/posts/12",
  );
});

test("the title derivation flattens and caps the body head", () => {
  assert.equal(boostTitleFrom("hello\n  world"), "hello world");
  assert.equal(boostTitleFrom("short"), "short");
  const long = "x".repeat(BOOST_TITLE_CAP + 7);
  assert.equal(boostTitleFrom(long), "x".repeat(BOOST_TITLE_CAP) + "…");
});

test("the excerpt derivation rides past the title head and caps", () => {
  assert.equal(boostExcerptFrom("short"), "");
  const long = "y".repeat(BOOST_TITLE_CAP + BOOST_EXCERPT_CAP + 3);
  assert.equal(boostExcerptFrom(long), "y".repeat(BOOST_EXCERPT_CAP) + "…");
  const split = "z".repeat(BOOST_TITLE_CAP + 1);
  assert.equal(boostExcerptFrom(split), "z");
});

test("the mint insert is idempotent on (forum_post_id, author_id) — REAL sqlite", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE gc_fleet_boosts (" +
      "id INTEGER PRIMARY KEY, forum_post_id INTEGER, author_id INTEGER," +
      "thread_title TEXT NOT NULL, thread_excerpt TEXT NOT NULL," +
      "created_at INTEGER NOT NULL, rendered_channel_id INTEGER, rendered_message_id INTEGER)",
  );
  const binds = [9, 2, "t", "e", 1, 9, 2];
  const first = db.prepare(BOOST_MINT_INSERT_SQL).run(...binds);
  assert.equal(first.changes, 1);
  const replay = db.prepare(BOOST_MINT_INSERT_SQL).run(...binds);
  assert.equal(replay.changes, 0, "a replayed mint inserts ZERO rows");
  const otherAuthor = db.prepare(BOOST_MINT_INSERT_SQL)
    .run(9, 3, "t", "e", 1, 9, 3);
  assert.equal(otherAuthor.changes, 1, "a DIFFERENT author mints their own row");
  db.exec("CREATE UNIQUE INDEX idx_gc_fleet_boosts_mirror_once " +
    "ON gc_fleet_boosts(forum_post_id, rendered_channel_id) " +
    "WHERE rendered_message_id IS NOT NULL");
  const stamped = db.prepare(BOOST_FOR_AUTHOR_SQL).get(9, 2);
  assert.equal(stamped.id, 1);
});

test("0043 carries the IF NOT EXISTS shape of the shared boost table", () => {
  const sql = readFileSync(path.join(root, "migrations", "0043_fleet_boosts.sql"), "utf8")
    // The pins read the DDL, not the prose above and inside it.
    .replace(/--[^\n]*/g, "");
  assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS gc_fleet_boosts"));
  // The GC-owned columns in GC 0029's exact order.
  const columns = [
    "forum_post_id INTEGER NOT NULL REFERENCES posts(id)",
    "author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE",
    "thread_title TEXT NOT NULL",
    "thread_excerpt TEXT NOT NULL",
    "created_at INTEGER NOT NULL",
    "rendered_channel_id INTEGER NULL REFERENCES gc_channels(id) ON DELETE SET NULL",
    "rendered_message_id INTEGER NULL REFERENCES gc_messages(id) ON DELETE SET NULL",
  ];
  let cursor = sql.indexOf("CREATE TABLE IF NOT EXISTS gc_fleet_boosts");
  for (const column of columns) {
    const at = sql.indexOf(column, cursor);
    assert.ok(at > cursor, "column rides after the previous: " + column);
    cursor = at;
  }
  // The scoping-pin findings ride the copy: no rendered_at, no pair CHECK.
  assert.equal(/\brendered_at\s+INTEGER\b/.test(sql), false);
  assert.equal(
    /\bCHECK\b/.test(sql.slice(sql.indexOf("gc_fleet_boosts"), sql.indexOf("CREATE UNIQUE INDEX"))),
    false,
    "the boost table carries no CHECK",
  );
  // Both statements no-op on the live shared D1 (GC 0029 materialized them).
  assert.ok(sql.includes("CREATE UNIQUE INDEX IF NOT EXISTS idx_gc_fleet_boosts_mirror_once"));
  assert.ok(sql.includes("WHERE rendered_message_id IS NOT NULL"));
});
