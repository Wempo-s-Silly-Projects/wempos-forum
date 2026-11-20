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

// Presence surface (chat-widget-backend lane): the roster read hides
// invisible + stale members and never leaks last_seen, the heartbeat upsert
// sets last_seen always and invisible only when the body carries it (the
// COALESCE arm pinned on real node:sqlite against PRESENCE_UPSERT_SQL).
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  handleChatRoutes,
  PRESENCE_WINDOW,
  PRESENCE_UPSERT_SQL,
  PRESENCE_KEEP_SQL,
} from "../api/chat.mjs";

const SESSION_TOKEN = "A".repeat(44);
const CSRF_TOKEN = "c".repeat(24);

// Recording, SQL-text-answering fake FORUM_DB (tests/totp-routes.test.mjs idiom).
function fakeDb(sqlAnswers = {}) {
  const statements = [];
  const answer = (sql) => {
    for (const [needle, value] of Object.entries(sqlAnswers)) {
      if (sql.includes(needle)) return typeof value === "function" ? value() : value;
    }
    return null;
  };
  const mk = (sql, params) => {
    statements.push({ sql, params });
    return {
      first: async () => answer(sql),
      all: async () => ({ results: Array.isArray(answer(sql)) ? answer(sql) : [] }),
      run: async () => ({ meta: { changes: 1, last_row_id: statements.length } }),
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

const SESSION_ROW = {
  token_hash: "h", user_id: 2, csrf_token: CSRF_TOKEN, expires_at: 9999999999,
  username: "tester", role: "member", bio: "", avatar_status: null,
  avatar_mime: null, avatar_updated_at: null, avatar_version: null, totp_enabled: 0,
};

function chatRequest(path, method, body) {
  return new Request("https://forum.test" + path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "Origin": "https://forum.test",
      "X-CSRF-Token": CSRF_TOKEN,
      "Cookie": "__Host-wempo_session=" + SESSION_TOKEN,
    },
  });
}

function envFor(db) {
  return {
    FORUM_DB: db,
    FILTERED_WORDS: "",
    WRITE_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
}

function drive(request, env, path, method) {
  return handleChatRoutes(request, env, new URL("https://forum.test" + path), path, method, undefined);
}

test("chat.mjs exports the dispatcher and the 300s presence window", () => {
  assert.equal(typeof handleChatRoutes, "function");
  assert.equal(PRESENCE_WINDOW, 300);
});

test("the dispatcher passes through shapes it does not own, writing nothing", async () => {
  const db = fakeDb();
  const noMatch = async (path, method) =>
    drive(chatRequest(path, method), envFor(db), path, method);
  assert.equal(await noMatch("/api/presence", "PUT"), null);
  assert.equal(await noMatch("/api/presence/2", "GET"), null);
  assert.equal(await noMatch("/api/online", "GET"), null);
  assert.equal(db.statements.length, 0);
});

test("the roster read answers guests and never leaks last_seen", async () => {
  const db = fakeDb({
    "FROM presence p JOIN users u": [
      { id: 3, username: "sam", role: "member" },
      { id: 5, username: "kai", role: "member" },
    ],
  });
  const guestRequest = new Request("https://forum.test/api/presence", { method: "GET" });
  const response = await drive(guestRequest, envFor(db), "/api/presence", "GET");
  const payload = await response.json();
  assert.equal(typeof payload.now, "number");
  assert.deepEqual(payload.online[0], { id: 3, username: "sam", role: "member" });
  assert.deepEqual(Object.keys(payload.online[1]), ["id", "username", "role"]);
  const select = db.statements.find((s) => s.sql.includes("FROM presence p"));
  assert.match(select.sql, /p\.invisible = 0/u);
  assert.match(select.sql, /last_seen >= \?/u);
  assert.ok(Math.abs(Number(select.params[0]) - payload.now + PRESENCE_WINDOW) <= 1,
    "the window binds now minus " + PRESENCE_WINDOW + "s");
});

test("the heartbeat sets last_seen always and echoes the requested flag", async () => {
  const db = fakeDb({
    "FROM sessions s LEFT JOIN users": SESSION_ROW,
    "FROM presence WHERE user_id = ?": { invisible: 0 },
  });
  const response = await drive(chatRequest("/api/presence", "POST", { invisible: 1 }),
    envFor(db), "/api/presence", "POST");
  const payload = await response.json();
  assert.deepEqual(payload, { ok: true, invisible: 1 });
  const upsert = db.statements.find((s) => s.sql.includes("INSERT INTO presence"));
  assert.ok(upsert, "the presence upsert ran");
  assert.equal(upsert.params[0], 2);
  assert.equal(Number(upsert.params[2]), 1);
});

test("a flag-less heartbeat keeps the stored invisible setting", async () => {
  const db = fakeDb({
    "FROM sessions s LEFT JOIN users": SESSION_ROW,
    "FROM presence WHERE user_id = ?": { invisible: 1 },
  });
  const response = await drive(chatRequest("/api/presence", "POST", {}),
    envFor(db), "/api/presence", "POST");
  assert.deepEqual(await response.json(), { ok: true, invisible: 1 });
  const upsert = db.statements.find((s) => s.sql.includes("INSERT INTO presence"));
  assert.equal(upsert.params.length, 2, "the flag-less arm binds only who + when");
});

test("a signed-out heartbeat stays 401 before any write", async () => {
  const db = fakeDb();
  await assert.rejects(
    drive(chatRequest("/api/presence", "POST", {}), envFor(db), "/api/presence", "POST"),
    (error) => error.status === 401,
  );
  assert.ok(!db.statements.some((s) => s.sql.includes("INSERT INTO presence")));
});

test("the heartbeats' SQL arms are replay-safe on node:sqlite", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE presence (user_id INTEGER PRIMARY KEY, " +
    "last_seen INTEGER NOT NULL, invisible INTEGER NOT NULL DEFAULT 0 CHECK (invisible IN (0, 1)))");
  db.prepare(PRESENCE_UPSERT_SQL).run(2, 100, 1);
  db.prepare(PRESENCE_KEEP_SQL).run(2, 200);
  const row = db.prepare("SELECT last_seen, invisible FROM presence WHERE user_id = 2").get();
  assert.equal(row.invisible, 1, "the flag-less replay keeps invisible");
  assert.equal(row.last_seen, 200);
  db.prepare(PRESENCE_UPSERT_SQL).run(2, 300, 0);
  assert.equal(db.prepare("SELECT invisible FROM presence WHERE user_id = 2").get().invisible, 0,
    "an explicit flag overwrites");
  db.prepare(PRESENCE_KEEP_SQL).run(3, 100);
  assert.equal(db.prepare("SELECT invisible FROM presence WHERE user_id = 3").get().invisible, 0,
    "a fresh member defaults invisible to 0");
});
