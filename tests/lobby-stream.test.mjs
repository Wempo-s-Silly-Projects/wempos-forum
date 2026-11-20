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

// Lobby stream (old-ui-return lane): the retired public "Let's chat" surface
// from the pre-7b4d844 api/chat.mjs riding today's file additively. Pins the
// OLD response keys verbatim — GET /api/chat {messages, lastId, online,
// onlineMembers, dmUnread, bellUnread} with {id, body, createdAt,
// author:{id, username, role}} rows, guests reading unsigned-out, the
// after=<id> cursor (bad cursor 400, ASC page), POST's gate order (auth, ban,
// word filter at intake, 500 cap, empty 400) and the label mention fan-out
// never failing the send, DELETE /api/chat/:id for staff with the 404 on a
// zero-change delete. Route pins ride the SQL-answering recording fake db
// (tests/dm-module.test.mjs idiom) plus a node:sqlite referee for the ban
// filter statement.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { handleChatRoutes } from "../api/chat.mjs";

const SESSION_TOKEN = "A".repeat(44);
const CSRF_TOKEN = "c".repeat(24);

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
      run: async () => {
        const ans = answer(sql);
        const changes = ans && typeof ans === "object" && ans.changes !== undefined
          ? ans.changes : 1;
        return { meta: { changes, last_row_id: statements.length } };
      },
    };
  };
  return {
    statements,
    // Unbound prepares record too (the lobby's initial page reads without a
    // bind), so pins can reach the SELECT text of a bindless read.
    prepare: (sql) => {
      statements.push({ sql, params: [] });
      return {
        first: async () => answer(sql),
        all: async () => ({ results: Array.isArray(answer(sql)) ? answer(sql) : [] }),
        bind: (...params) => mk(sql, params),
      };
    },
    batch: async (stmts) => stmts.map((_, index) => ({ meta: { changes: 1, last_row_id: index + 1 } })),
  };
}

const SESSION_ROW = {
  token_hash: "h", user_id: 2, csrf_token: CSRF_TOKEN, expires_at: 9999999999,
  username: "tester", role: "member", bio: "", avatar_status: null,
  avatar_mime: null, avatar_updated_at: null, avatar_version: null, totp_enabled: 0,
};
const STAFF_ROW = { ...SESSION_ROW, role: "admin" };

function lobbyRequest(path, method, body, cookie) {
  const headers = { "content-type": "application/json", "Origin": "https://forum.test" };
  if (cookie) {
    headers["X-CSRF-Token"] = CSRF_TOKEN;
    headers["Cookie"] = "__Host-wempo_session=" + SESSION_TOKEN;
  }
  return new Request("https://forum.test" + path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
  });
}

function drive(db, path, method, body, cookie, envExtra = {}) {
  const url = new URL("https://forum.test" + path);
  const clean = url.pathname;
  return handleChatRoutes(lobbyRequest(clean, method, body, cookie),
    { FORUM_DB: db, FILTERED_WORDS: "", WRITE_RATE_LIMITER: { limit: async () => ({ success: true }) }, ...envExtra },
    url, clean, method, undefined);
}

const SESSION_ANSWER = { "FROM sessions s LEFT JOIN users": SESSION_ROW };
const CLEAR_GATES = {
  "SELECT id FROM bans WHERE user_id = ? AND revoked_at": null,
};

test("GET /api/chat answers the lobby shape, guests read signed-out", async () => {
  const db = fakeDb({
    "FROM chat_messages c JOIN": [
      { id: 4, body: "new", created_at: 1700000010, author_id: 3, author_username: "kai", author_role: "member" },
      { id: 2, body: "old", created_at: 1700000000, author_id: 2, author_username: "tester", author_role: "moderator" },
    ],
    "SELECT COUNT(*) AS online": { online: 3 },
    "FROM presence p JOIN users": [
      { id: 2, username: "tester", role: "member" },
      { id: 3, username: "kai", role: "moderator" },
    ],
  });
  const response = await drive(db, "/api/chat", "GET");
  assert.ok(response, "the lobby poll rides the chat dispatcher");
  const payload = await response.json();
  assert.deepEqual(
    Object.keys(payload).sort(),
    ["bellUnread", "dmUnread", "lastId", "messages", "online", "onlineMembers"],
  );
  // Guests get zeros on the signed-in extras; no session read hit the db.
  assert.equal(payload.dmUnread, 0);
  assert.equal(payload.bellUnread, 0);
  assert.equal(payload.online, 3);
  assert.deepEqual(payload.onlineMembers, [
    { id: 2, username: "tester", role: "member" },
    { id: 3, username: "kai", role: "admin" },
  ]);
  // Initial load: newest 50 stored newest-first, rendered oldest-first.
  assert.deepEqual(
    payload.messages.map((m) => m.id),
    [2, 4],
  );
  assert.deepEqual(payload.messages[0], {
    id: 2,
    body: "old",
    createdAt: new Date(1700000000 * 1000).toISOString(),
    author: { id: 2, username: "tester", role: "admin" },
  });
  assert.equal(payload.lastId, 4);
  assert.match(db.statements[0].sql, /ORDER BY c\.id DESC LIMIT 50/u);
  assert.match(db.statements[0].sql, /revoked_at IS NULL/u);
});

test("a signed-in member's lobby poll carries the dm and bell extras", async () => {
  const db = fakeDb({
    ...SESSION_ANSWER,
    "FROM chat_messages c JOIN": [],
    "SELECT COUNT(*) AS online": { online: 0 },
    "FROM presence p JOIN users": [],
    "FROM dm_threads WHERE (user_a = ? OR user_b = ?)": { unread: 4 },
    "FROM notifications WHERE user_id": { unread: 2 },
  });
  const response = await drive(db, "/api/chat", "GET", undefined, true);
  const payload = await response.json();
  assert.equal(payload.dmUnread, 4);
  assert.equal(payload.bellUnread, 2);
  assert.equal(payload.lastId, 0);
  assert.equal(payload.messages.length, 0);
});

test("the after cursor pages ASC and a malformed cursor is refused", async () => {
  const db = fakeDb({
    "FROM chat_messages c JOIN": [
      { id: 9, body: "next", created_at: 1700000020, author_id: 3, author_username: "kai", author_role: "member" },
    ],
    "SELECT COUNT(*) AS online": { online: 1 },
    "FROM presence p JOIN users": [],
  });
  const response = await drive(db, "/api/chat?after=7", "GET");
  const payload = await response.json();
  assert.equal(payload.lastId, 9);
  const page = db.statements.findLast((s) => s.sql.includes("WHERE c.id > ?"));
  assert.match(page.sql, /WHERE c\.id > \?/u);
  assert.match(page.sql, /ORDER BY c\.id ASC LIMIT 50/u);
  assert.equal(page.params[0], 7);

  await assert.rejects(drive(fakeDb(), "/api/chat?after=abc", "GET"),
    (error) => error.status === 400 && error.message === "That chat cursor is invalid.");
});

test("POST /api/chat gates auth and the ban before any write", async () => {
  const guest = fakeDb();
  await assert.rejects(drive(guest, "/api/chat", "POST", { body: "hello" }),
    (error) => error.status === 401);
  assert.ok(!guest.statements.some((s) => s.sql.includes("INSERT INTO chat_messages")));

  const banned = fakeDb({
    ...SESSION_ANSWER,
    "SELECT id FROM bans WHERE user_id = ? AND revoked_at": { id: 1 },
  });
  await assert.rejects(drive(banned, "/api/chat", "POST", { body: "hello" }, true),
    (error) => error.status === 403);
  assert.ok(!banned.statements.some((s) => s.sql.includes("INSERT INTO chat_messages")));
});

test("POST /api/chat filters words at intake, caps at 500, and rejects empty bodies", async () => {
  const insert = (body, envExtra = {}) => {
    const db = fakeDb({
      ...SESSION_ANSWER,
      ...CLEAR_GATES,
      "WHERE c.id = ? LIMIT 1": {
        id: 42, body, created_at: 1700000030, author_id: 2, author_username: "tester", author_role: "member",
      },
    });
    const response = drive(db, "/api/chat", "POST", { body }, true, envExtra);
    return { db, response };
  };
  const plain = insert("hello");
  assert.equal((await plain.response).status, 201);
  const stored = plain.db.statements.findLast((s) => s.sql.includes("INSERT INTO chat_messages"));
  assert.equal(stored.params[0], 2);
  assert.equal(stored.params[1], "hello");
  assert.equal((await (await plain.response).json()).message.id, 42);

  const filtered = insert("oh darn no", { FILTERED_WORDS: "darn" });
  await filtered.response;
  const filteredParams = filtered.db.statements.findLast((s) => s.sql.includes("INSERT INTO chat_messages"));
  assert.ok(!filteredParams.params[1].includes("darn"), "the word filter ran at intake");

  const capped = insert("x".repeat(900));
  await capped.response;
  assert.equal(capped.db.statements.findLast((s) => s.sql.includes("INSERT INTO chat_messages")).params[1].length, 500);

  await assert.rejects(insert("   ").response, (error) => error.status === 400 &&
    error.message === "Write a message first.");
});

test("a mention fan-out that throws never fails the lobby send", async () => {
  const db = fakeDb({
    ...SESSION_ANSWER,
    ...CLEAR_GATES,
    "FROM blocks WHERE (blocker_id = ? AND blocked_id = ?)": () => {
      throw new Error("fan-out exploded");
    },
    "WHERE c.id = ? LIMIT 1": {
      id: 43, body: "hi @kai", created_at: 1700000040, author_id: 2, author_username: "tester", author_role: "member",
    },
  });
  const response = await drive(db, "/api/chat", "POST", { body: "hi @kai" }, true);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).message.id, 43);
});

test("DELETE /api/chat/:id is staff-only and 404s a zero-change delete", async () => {
  const member = fakeDb({ ...SESSION_ANSWER, ...CLEAR_GATES });
  await assert.rejects(drive(member, "/api/chat/17", "DELETE", undefined, true),
    (error) => error.status === 403);
  assert.ok(!member.statements.some((s) => s.sql.includes("DELETE FROM chat_messages")));

  const staff = fakeDb({ "FROM sessions s LEFT JOIN users": STAFF_ROW, ...CLEAR_GATES });
  const ok = await drive(staff, "/api/chat/17", "DELETE", undefined, true);
  assert.equal((await ok.json()).ok, true);
  const removed = staff.statements.findLast((s) => s.sql.includes("DELETE FROM chat_messages WHERE id = ?"));
  assert.equal(removed.params[0], 17);

  const gone = fakeDb({
    "FROM sessions s LEFT JOIN users": STAFF_ROW,
    ...CLEAR_GATES,
    "DELETE FROM chat_messages WHERE id = ?": { changes: 0 },
  });
  await assert.rejects(drive(gone, "/api/chat/17", "DELETE", undefined, true),
    (error) => error.status === 404 && error.message === "Message not found.");

  const otherMethod = drive(fakeDb(), "/api/chat/17", "GET");
  await assert.rejects(otherMethod, (error) => error.status === 405 ||
    error.message === "That method is not supported.");
});

test("today's dm and presence routes still own their paths beside the lobby", async () => {
  const presence = fakeDb({
    ...SESSION_ANSWER,
    ...CLEAR_GATES,
    "SELECT invisible FROM presence WHERE user_id = ?": { invisible: 0 },
  });
  const beat = await drive(presence, "/api/presence", "POST", {}, true);
  assert.equal((await beat.json()).ok, true);

  const noMatch = async (path, method) => drive(fakeDb(), path, method);
  assert.equal(await noMatch("/api/chat", "PATCH"), null);
  assert.equal(await noMatch("/api/messages", "POST"), null);
});

test("the ban filter hides actively-banned authors on real node:sqlite", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, role TEXT)");
  db.exec("CREATE TABLE bans (user_id INTEGER NOT NULL, revoked_at INTEGER, expires_at INTEGER)");
  db.exec("CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, " +
    "user_id INTEGER NOT NULL, body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 500), " +
    "created_at INTEGER NOT NULL)");
  const now = 1700000000;
  db.prepare("INSERT INTO users (id, username, role) VALUES (?, ?, ?)").run(2, "tester", "member");
  db.prepare("INSERT INTO users (id, username, role) VALUES (?, ?, ?)").run(5, "kai", "member");
  db.prepare("INSERT INTO chat_messages (user_id, body, created_at) VALUES (?, ?, ?)").run(2, "open", now);
  db.prepare("INSERT INTO chat_messages (user_id, body, created_at) VALUES (?, ?, ?)").run(5, "from-banned", now);
  // An unexpired ban (no expiry = active): strftime('now') is the referee's
  // real clock, so the active test leans on the NULL-expires arm.
  db.prepare("INSERT INTO bans (user_id, revoked_at, expires_at) VALUES (?, NULL, NULL)").run(5);
  const CHAT_BAN_FILTER_SQL =
    "NOT EXISTS (SELECT 1 FROM bans b WHERE b.user_id = c.user_id " +
    "AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > " +
    "CAST(strftime('%s','now') AS INTEGER)))";
  const CHAT_SELECT =
    "SELECT c.id, c.body, c.created_at, c.user_id AS author_id, " +
    "u.username AS author_username, u.role AS author_role " +
    "FROM chat_messages c JOIN users u ON u.id = c.user_id ";
  const rows = db.prepare(CHAT_SELECT + "WHERE " + CHAT_BAN_FILTER_SQL +
    " ORDER BY c.id ASC LIMIT 50").all();
  assert.deepEqual(rows.map((r) => r.body), ["open"]);
  assert.equal(Number(rows[0].author_id), 2);
  // The banned row's body still sits in the table: read-time only, an unban
  // restores it without any write.
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM chat_messages").get().total, 2);
});
