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

// Sessions are FORGED at the row level (helpers/seed.mjs forgeSession): a
// sessions row keyed by sha256(token) plus the __Host-wempo_session cookie,
// and Origin + X-CSRF-Token on mutations — the real readSession/requireUser
// path runs end to end through worker.fetch.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedUser } from "./helpers/seed.mjs";

let env;
let db;
const u = {};
const s = {};
let threadId;

before(async () => {
  env = makeEnv();
  db = env.__sqlite;
  for (const name of ["alice", "bob", "carol", "dave"]) {
    u[name] = await seedUser(db, { username: name[0].toUpperCase() + name.slice(1) });
    s[name] = forgeSession(db, u[name]);
  }
  threadId = Number(db.prepare("INSERT INTO dm_threads (user_a, user_b, created_at) VALUES (?, ?, ?)")
    .run(Math.min(u.alice, u.bob), Math.max(u.alice, u.bob), now()).lastInsertRowid);
});

beforeEach(() => {
  db.prepare("DELETE FROM blocks").run();
  db.prepare("UPDATE dm_threads SET unread_a = 0, unread_b = 0").run();
});

const unread = () => db.prepare("SELECT unread_a, unread_b FROM dm_threads WHERE id = ?").get(threadId);
const send = (who, body = "hello") => call(env, "/api/dm/threads/" + threadId, { method: "POST", body: { body }, session: s[who] });
const aliceIsA = () => u.alice < u.bob;
// Same-origin but cookie-less: requireUser checks Origin BEFORE the session,
// so the header is what lets these probes reach the 401 branch.
const SAME_ORIGIN = { Origin: "https://wempos-forum.com" };

test("DM send by a non-participant answers 403 and writes nothing", async () => {
  const before = db.prepare("SELECT COUNT(*) AS n FROM dm_messages").get().n;
  const response = await send("carol");
  assert.equal(response.status, 403);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dm_messages").get().n, before);
  const read = await call(env, "/api/dm/threads/" + threadId, { session: s.carol });
  assert.equal(read.status, 403);
});

test("DM send without a session is refused", async () => {
  const response = await call(env, "/api/dm/threads/" + threadId, { method: "POST", body: { body: "x" }, headers: SAME_ORIGIN });
  assert.equal(response.status, 401);
});

test("DM send without the CSRF header is refused", async () => {
  const response = await call(env, "/api/dm/threads/" + threadId, {
    method: "POST", body: { body: "x" },
    headers: { Cookie: s.alice.cookie, Origin: "https://wempos-forum.com" },
  });
  assert.equal(response.status, 403);
});

test("a block pair answers 403 in both directions", async () => {
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(u.alice, u.bob, now());
  assert.equal((await send("alice")).status, 403, "blocker cannot send");
  assert.equal((await send("bob")).status, 403, "blockee cannot send");
  const open = await call(env, "/api/dm/threads", { method: "POST", body: { userId: u.alice }, session: s.bob });
  assert.equal(open.status, 403, "blockee cannot open");
  assert.deepEqual({ ...unread() }, { unread_a: 0, unread_b: 0 });
});

test("a send bumps only the OTHER side's unread counter", async () => {
  const response = await send("alice", "hi bob");
  assert.equal(response.status, 201);
  assert.equal((await response.json()).message.mine, true);
  const after = unread();
  const [aliceSide, bobSide] = aliceIsA() ? [after.unread_a, after.unread_b] : [after.unread_b, after.unread_a];
  assert.equal(aliceSide, 0);
  assert.equal(bobSide, 1);
  assert.equal((await send("bob", "hi alice")).status, 201);
  const later = unread();
  assert.deepEqual({ ...later }, { unread_a: 1, unread_b: 1 });
});

test("read-mark zeroes the viewer's own counter only", async () => {
  await send("alice");
  await send("bob");
  await send("bob");
  const response = await call(env, "/api/dm/threads/" + threadId + "/read", { method: "POST", body: {}, session: s.alice });
  assert.equal(response.status, 200);
  const after = unread();
  const [aliceSide, bobSide] = aliceIsA() ? [after.unread_a, after.unread_b] : [after.unread_b, after.unread_a];
  assert.equal(aliceSide, 0);
  assert.equal(bobSide, 1);
  const outsider = await call(env, "/api/dm/threads/" + threadId + "/read", { method: "POST", body: {}, session: s.carol });
  assert.equal(outsider.status, 403);
});

test("DM read hides messages by an actively-banned author", async () => {
  const dave = u.dave;
  const open = await call(env, "/api/dm/threads", { method: "POST", body: { userId: dave }, session: s.carol });
  assert.equal(open.status, 200);
  const { id } = await open.json();
  db.prepare("INSERT INTO dm_messages (thread_id, user_id, body, created_at) VALUES (?, ?, 'from dave', ?)").run(id, dave, now());
  seedBan(db, dave, null);
  const read = await (await call(env, "/api/dm/threads/" + id, { session: s.carol })).json();
  assert.equal(read.messages.length, 0);
});

test("presence GET lists fresh visible members only, never invisible or stale, never last_seen", async () => {
  db.prepare("DELETE FROM presence").run();
  const insert = db.prepare("INSERT INTO presence (user_id, last_seen, invisible) VALUES (?, ?, ?)");
  insert.run(u.alice, now(), 0);
  insert.run(u.bob, now(), 1);
  insert.run(u.carol, now() - 3600, 0);
  const response = await call(env, "/api/presence");
  assert.equal(response.status, 200);
  const text = await response.text();
  const body = JSON.parse(text);
  assert.deepEqual(body.online.map((m) => m.id), [u.alice]);
  assert.doesNotMatch(text, /last_seen|lastSeen/);
});

test("presence heartbeat requires a session; a signed-in heartbeat lands", async () => {
  assert.equal((await call(env, "/api/presence", { method: "POST", body: {}, headers: SAME_ORIGIN })).status, 401);
  const response = await call(env, "/api/presence", { method: "POST", body: { invisible: true }, session: s.dave });
  assert.equal(response.status, 200);
  assert.equal(db.prepare("SELECT invisible FROM presence WHERE user_id = ?").get(u.dave).invisible, 1);
});

test("lobby GET is readable signed-out with zeroed unread extras", async () => {
  db.prepare("INSERT INTO chat_messages (user_id, body, created_at) VALUES (?, 'lobby hello', ?)").run(u.alice, now());
  const response = await call(env, "/api/chat");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.messages.some((m) => m.body === "lobby hello"));
  assert.equal(body.dmUnread, 0);
  assert.equal(body.bellUnread, 0);
});

test("lobby GET signed-in carries the viewer's dm unread total", async () => {
  await send("alice", "ping");
  const body = await (await call(env, "/api/chat", { session: s.bob })).json();
  assert.equal(body.dmUnread, 1);
});

test("cross-origin mutations are refused before any session lookup", async () => {
  const response = await call(env, "/api/chat", { method: "POST", body: { body: "x" }, headers: { Cookie: s.alice.cookie, Origin: "https://evil.example" } });
  assert.equal(response.status, 403);
});

test("lobby POST signed-out is refused", async () => {
  const before = db.prepare("SELECT COUNT(*) AS n FROM chat_messages").get().n;
  const response = await call(env, "/api/chat", { method: "POST", body: { body: "anon" }, headers: SAME_ORIGIN });
  assert.equal(response.status, 401);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chat_messages").get().n, before);
});
