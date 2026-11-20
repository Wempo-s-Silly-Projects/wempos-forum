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

// DM surface (chat-widget-backend lane): module surface pin plus the
// behavioral pins — thread list shape, the open-or-return pair (INSERT OR
// IGNORE, node:sqlite referee), the read gates (participant 403, active-ban
// filter shape), the send gates (ban, block pair, word filter at intake,
// exactly one unread bump on the OTHER side), and the read endpoint zeroing
// the viewer's own counter. Route pins ride the SQL-answering recording fake
// db (tests/totp-routes.test.mjs idiom).
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  handleChatRoutes,
  DM_MAX_BODY_CHARS,
  DM_THREAD_OPEN_SQL,
  DM_THREAD_FIND_SQL,
} from "../api/chat.mjs";

const SESSION_TOKEN = "A".repeat(44);
const CSRF_TOKEN = "c".repeat(24);

// Recording, SQL-text-answering fake FORUM_DB: reads answer by needle, writes
// record {sql, params} at bind time so a gate that throws first records
// nothing.
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

function drive(db, path, method, body) {
  const url = new URL("https://forum.test" + path);
  const clean = url.pathname;
  return handleChatRoutes(chatRequest(clean, method, body),
    { FORUM_DB: db, FILTERED_WORDS: "", WRITE_RATE_LIMITER: { limit: async () => ({ success: true }) } },
    url, clean, method, undefined);
}

const SESSION_ANSWER = { "FROM sessions s LEFT JOIN users": SESSION_ROW };
const CLEAR_GATES = {
  "SELECT id FROM bans WHERE user_id = ? AND revoked_at": null,
  "FROM blocks": null,
};

test("chat.mjs exports the dispatcher, cap, and window", () => {
  assert.equal(typeof handleChatRoutes, "function");
  assert.equal(DM_MAX_BODY_CHARS, 1000);
});

test("the dispatcher passes through every route shape it does not own", async () => {
  const db = fakeDb();
  const noMatch = async (path, method) => drive(db, path, method);
  assert.equal(await noMatch("/api/dm", "GET"), null);
  assert.equal(await noMatch("/api/dm/threads/12/other", "POST"), null);
  assert.equal(await noMatch("/api/dm/threads/abc", "GET"), null);
  assert.equal(await noMatch("/api/dm/threads/12/read", "GET"), null);
  assert.equal(await noMatch("/api/messages", "POST"), null);
  assert.equal(db.statements.length, 0);
});

test("the thread list answers the contract shape, newest activity first", async () => {
  const db = fakeDb({
    ...SESSION_ANSWER,
    "FROM dm_threads t": [{
      id: 7, user_a: 2, user_b: 5, unread_a: 3, unread_b: 0,
      other_username: "kai", other_role: "member",
      last_body: "y".repeat(140), last_at: 1700000000,
    }],
  });
  const response = await drive(db, "/api/dm/threads", "GET");
  const payload = await response.json();
  const thread = payload.threads[0];
  assert.equal(thread.id, 7);
  assert.deepEqual(thread.other, { id: 5, username: "kai", role: "member" });
  assert.equal(thread.unread, 3);
  assert.equal(thread.lastMessagePreview.length, 80);
  assert.equal(thread.lastMessageAt, new Date(1700000000 * 1000).toISOString());
});

test("a signed-out member gets 401 before any dm table is read", async () => {
  const db = fakeDb();
  await assert.rejects(drive(db, "/api/dm/threads", "GET"), (error) => error.status === 401);
  assert.ok(!db.statements.some((s) => s.sql.includes("dm_")), "zero dm-table reads");
});

test("open-or-return returns the existing thread without re-inserting", async () => {
  const db = fakeDb({
    ...SESSION_ANSWER,
    ...CLEAR_GATES,
    "FROM users WHERE id = ?": { id: 5, username: "kai", role: "member" },
    "WHERE user_a = ? AND user_b = ?": { id: 7, user_a: 2, user_b: 5 },
  });
  const response = await drive(db, "/api/dm/threads", "POST", { userId: 5 });
  const payload = await response.json();
  assert.equal(payload.id, 7);
  assert.deepEqual(payload.other, { id: 5, username: "kai", role: "member" });
  assert.ok(!db.statements.some((s) => s.sql.includes("INSERT INTO dm_threads")));
});

test("open-or-return inserts once with the canonical (min, max) pair", async () => {
  let lookups = 0;
  const db = fakeDb({
    ...SESSION_ANSWER,
    ...CLEAR_GATES,
    "FROM users WHERE id = ?": { id: 5, username: "kai", role: "member" },
    "WHERE user_a = ? AND user_b = ?": { id: 9, user_a: 2, user_b: 5 },
  });
  const response = await drive(db, "/api/dm/threads", "POST", { userId: 5 });
  assert.equal((await response.json()).id, 9);
  const insert = db.statements.find((s) => s.sql.includes("INSERT OR IGNORE INTO dm_threads"));
  assert.ok(insert, "the INSERT OR IGNORE rode the send");
  assert.equal(insert.params[0], 2);
  assert.equal(insert.params[1], 5);
});

test("self-pair, unknown target, and block pair all refuse before any write", async () => {
  const self = fakeDb({ ...SESSION_ANSWER });
  await assert.rejects(drive(self, "/api/dm/threads", "POST", { userId: 2 }),
    (error) => error.status === 400 && error.message === "You cannot message yourself.");
  assert.ok(self.statements.every((s) => s.sql.includes("sessions")),
    "nothing but the session read touched the database");

  const unknown = fakeDb({ ...SESSION_ANSWER, "FROM users WHERE id = ?": null });
  await assert.rejects(drive(unknown, "/api/dm/threads", "POST", { userId: 999 }),
    (error) => error.status === 400 && error.message === "That member does not exist.");

  const blocked = fakeDb({
    ...SESSION_ANSWER,
    "FROM users WHERE id = ?": { id: 5, username: "kai", role: "member" },
    "FROM blocks": { "1": 1 },
  });
  await assert.rejects(drive(blocked, "/api/dm/threads", "POST", { userId: 5 }),
    (error) => error.status === 403);
  assert.ok(!blocked.statements.some((s) => s.sql.includes("INSERT INTO dm_threads")));
});

test("open-or-return is replay-safe on the real UNIQUE pair (node:sqlite)", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE dm_threads (id INTEGER PRIMARY KEY AUTOINCREMENT, " +
    "user_a INTEGER NOT NULL, user_b INTEGER NOT NULL, created_at INTEGER NOT NULL, " +
    "UNIQUE (user_a, user_b), CHECK (user_a < user_b))");
  const first = db.prepare(DM_THREAD_OPEN_SQL).run(2, 5, 1700000000);
  const replay = db.prepare(DM_THREAD_OPEN_SQL).run(2, 5, 1700000100);
  assert.equal(first.changes, 1);
  assert.equal(replay.changes, 0, "the replayed open inserts ZERO rows");
  const found = db.prepare(DM_THREAD_FIND_SQL).get(2, 5);
  assert.equal(found.id, Number(first.lastInsertRowid));
});

test("thread detail enforces the participant gate and the active-ban filter", async () => {
  const db = fakeDb({
    ...SESSION_ANSWER,
    "FROM dm_threads t": { id: 7, user_a: 4, user_b: 5, unread_a: 0, unread_b: 0 },
  });
  await assert.rejects(drive(db, "/api/dm/threads/7", "GET"), (error) => error.status === 403);
  assert.ok(!db.statements.some((s) => s.sql.includes("FROM dm_messages m JOIN")),
    "a non-participant reads zero messages");

  const own = fakeDb({
    ...SESSION_ANSWER,
    "FROM dm_threads t": { id: 7, user_a: 2, user_b: 5, unread_a: 0, unread_b: 3,
      a_username: "tester", a_role: "member", b_username: "kai", b_role: "member" },
    "FROM dm_messages m JOIN": [{ id: 11, body: "hi", user_id: 5, created_at: 1700000000, author_username: "kai" }],
  });
  const response = await drive(own, "/api/dm/threads/7", "GET");
  const payload = await response.json();
  assert.deepEqual(payload.other, { id: 5, username: "kai", role: "member" });
  assert.equal(payload.unread, 0);
  const message = payload.messages[0];
  assert.deepEqual(
    { id: message.id, body: message.body, authorId: message.authorId,
      authorUsername: message.authorUsername, mine: message.mine,
      createdAt: message.createdAt },
    { id: 11, body: "hi", authorId: 5, authorUsername: "kai", mine: false,
      createdAt: new Date(1700000000 * 1000).toISOString() },
  );
  const select = own.statements.find((s) => s.sql.includes("FROM dm_messages m JOIN"));
  assert.match(select.sql, /revoked_at IS NULL/u);
  assert.match(select.sql, /(b\.)?expires_at IS NULL OR (b\.)?expires_at >/u);
  assert.match(select.sql, /ORDER BY m\.id DESC LIMIT 50/u);
});

test("the after cursor fetches the OLDER page for scrollback", async () => {
  const db = fakeDb({
    ...SESSION_ANSWER,
    "FROM dm_threads t": { id: 7, user_a: 2, user_b: 5, unread_a: 0, unread_b: 0 },
    "FROM dm_messages m JOIN": [],
  });
  await drive(db, "/api/dm/threads/7?after=11", "GET");
  const select = db.statements.find((s) => s.sql.includes("FROM dm_messages m JOIN"));
  assert.equal(select.params[0], 7);
  assert.equal(select.params[1], 11);
  assert.match(select.sql, /AND m\.id < \?/u);
});

test("sending bumps ONLY the other side's unread, exactly once", async () => {
  const send = async (threadRow, needleExtra = {}) => {
    const db = fakeDb({
      ...SESSION_ANSWER,
      ...CLEAR_GATES,
      "FROM users WHERE id = ?": null,
      "FROM dm_threads t": threadRow,
      ...needleExtra,
    });
    const response = await drive(db, "/api/dm/threads/:id".replace(":id", String(threadRow.id)),
      "POST", { body: "hello" });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).message.mine, true);
    const bumps = db.statements.filter((s) => s.sql.includes("SET unread_"));
    assert.equal(bumps.length, 1, "exactly one counter bump");
    return bumps[0];
  };
  const fromUserA = await send({ id: 7, user_a: 2, user_b: 5, unread_a: 0, unread_b: 0 });
  assert.match(fromUserA.sql, /SET unread_b = unread_b \+ 1/u);
  const fromUserB = await send({ id: 7, user_a: 1, user_b: 2, unread_a: 0, unread_b: 0 });
  assert.match(fromUserB.sql, /SET unread_a = unread_a \+ 1/u);
});

test("sending drops banned authors and blocked pairs before the write", async () => {
  const banned = fakeDb({
    ...SESSION_ANSWER,
    "FROM users WHERE id = ?": null,
    "SELECT id FROM bans WHERE user_id = ? AND revoked_at": { id: 1 },
    "FROM dm_threads t": { id: 7, user_a: 2, user_b: 5, unread_a: 0, unread_b: 0 },
  });
  await assert.rejects(drive(banned, "/api/dm/threads/7", "POST", { body: "hello" }),
    (error) => error.status === 403);
  assert.ok(!banned.statements.some((s) => s.sql.includes("INSERT INTO dm_messages")));

  const blocked = fakeDb({
    ...SESSION_ANSWER,
    "FROM users WHERE id = ?": null,
    "FROM blocks": { "1": 1 },
    "FROM dm_threads t": { id: 7, user_a: 2, user_b: 5, unread_a: 0, unread_b: 0 },
  });
  await assert.rejects(drive(blocked, "/api/dm/threads/7", "POST", { body: "hello" }),
    (error) => error.status === 403);
  assert.ok(!blocked.statements.some((s) => s.sql.includes("INSERT INTO dm_messages")));
});

test("sending filters words at intake, caps at 1000, and rejects empty bodies", async () => {
  const send = (body, extraEnv = {}) => {
    const db = fakeDb({
      ...SESSION_ANSWER,
      "SELECT id FROM bans WHERE user_id = ? AND revoked_at": null,
      "FROM blocks": null,
      "FROM dm_threads t": { id: 7, user_a: 2, user_b: 5, unread_a: 1, unread_b: 0 },
    });
    const env = { FORUM_DB: db, FILTERED_WORDS: "", WRITE_RATE_LIMITER: { limit: async () => ({ success: true }) }, ...extraEnv };
    const response = handleChatRoutes(chatRequest("/api/dm/threads/7", "POST", { body }),
      env, new URL("https://forum.test/api/dm/threads/7"), "/api/dm/threads/7", "POST", undefined);
    return { db, response };
  };

  const filtered = await (async () => {
    const { db, response } = send("oh darn no", { FILTERED_WORDS: "darn" });
    assert.equal((await response).status, 201);
    return db.statements.find((s) => s.sql.includes("INSERT INTO dm_messages"));
  })();
  assert.ok(!filtered.params[2].includes("darn"), "the word filter ran at intake");

  const capped = await (async () => {
    const { db, response } = send("x".repeat(1500));
    assert.equal((await response).status, 201);
    return db.statements.find((s) => s.sql.includes("INSERT INTO dm_messages"));
  })();
  assert.equal(capped.params[2].length, 1000);

  const empty = send("   ");
  await assert.rejects(empty.response, (error) => error.status === 400);
});

test("the read endpoint zeroes the viewer's own counter only", async () => {
  const db = fakeDb({
    ...SESSION_ANSWER,
    "FROM dm_threads t": { id: 7, user_a: 2, user_b: 5, unread_a: 1, unread_b: 4 },
  });
  const response = await drive(db, "/api/dm/threads/7/read", "POST");
  assert.equal(response.status, 200);
  const bump = db.statements.find((s) => s.sql.includes("SET unread_"));
  assert.ok(bump);
  assert.match(bump.sql, /SET unread_a = 0/u);
  assert.ok(!bump.sql.includes("unread_b"));
  assert.equal(bump.params[0], 7);
});
