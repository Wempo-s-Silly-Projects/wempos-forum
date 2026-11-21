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

// v4.7 group DMs (wave 2026-11-21-2): membership, creator-only management,
// the 10-member cap, ban and block-pair refusals, read-time ban/block
// hiding, per-member unread counters, and the no-existence-oracle 404 for
// outsiders — all driven through worker.fetch on the real SQLite referee.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DM_GROUP_MAX_MEMBERS } from "../constants.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedUser } from "./helpers/seed.mjs";

let env;
let db;
const u = {};
const s = {};
const NAMES = ["alice", "bob", "carol", "dave", "erin", "frank", "gus", "hana", "ivan", "jo", "kim", "lee", "banned"];
const SAME_ORIGIN = { Origin: "https://wempos-forum.com" };

before(async () => {
  env = makeEnv();
  db = env.__sqlite;
  for (const name of NAMES) {
    u[name] = await seedUser(db, { username: name });
    s[name] = forgeSession(db, u[name]);
  }
  seedBan(db, u.banned, null);
});

beforeEach(() => {
  db.prepare("DELETE FROM blocks").run();
  db.prepare("DELETE FROM dm_groups").run();
});

const block = (blocker, blocked) =>
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(u[blocker], u[blocked], now());
const create = (who, usernames, name) =>
  call(env, "/api/dm/groups", { method: "POST", body: { usernames, ...(name === undefined ? {} : { name }) }, session: s[who] });
const createOk = async (who, usernames, name) => {
  const response = await create(who, usernames, name);
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).id;
};
const read = (who, id) => call(env, "/api/dm/groups/" + id, { session: s[who] });
const send = (who, id, body = "hello") => call(env, "/api/dm/groups/" + id, { method: "POST", body: { body }, session: s[who] });
const unreadOf = (id, who) => db.prepare("SELECT unread FROM dm_group_members WHERE group_id = ? AND user_id = ?").get(id, u[who])?.unread;
const memberIds = (id) => db.prepare("SELECT user_id FROM dm_group_members WHERE group_id = ? ORDER BY user_id").all(id).map((row) => Number(row.user_id));

test("the cap constant is 10 members including the creator", () => {
  assert.equal(DM_GROUP_MAX_MEMBERS, 10);
});

test("create: creator + invitees become members; members read, outsiders get 404, guests 401", async () => {
  const response = await create("alice", ["bob", "Carol"], "  Weekend plans ");
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.name, "Weekend plans");
  assert.deepEqual(memberIds(body.id), [u.alice, u.bob, u.carol].sort((a, b) => a - b));
  const view = await read("bob", body.id);
  assert.equal(view.status, 200);
  const shaped = await view.json();
  assert.equal(shaped.members.length, 3);
  assert.equal(shaped.canManage, false);
  assert.equal((await (await read("alice", body.id)).json()).canManage, true);
  assert.equal((await read("dave", body.id)).status, 404, "outsider: same 404 as a missing group");
  assert.equal((await read("dave", 999999)).status, 404);
  assert.equal((await call(env, "/api/dm/groups/" + body.id)).status, 401);
  const guestCreate = await call(env, "/api/dm/groups", { method: "POST", body: { usernames: ["bob"] }, headers: SAME_ORIGIN });
  assert.equal(guestCreate.status, 401);
});

test("create refusals: empty, self-only, unknown, banned, over-long name, over the cap", async () => {
  assert.equal((await create("alice", [])).status, 400);
  assert.equal((await create("alice", ["alice"])).status, 400);
  assert.equal((await create("alice", ["nobody-here"])).status, 400);
  assert.equal((await create("alice", ["bob", "banned"])).status, 400);
  assert.equal((await create("alice", ["bob"], "x".repeat(61))).status, 400);
  const tooMany = ["bob", "carol", "dave", "erin", "frank", "gus", "hana", "ivan", "jo", "kim"];
  assert.equal((await create("alice", tooMany)).status, 400, "creator + 10 = 11 > cap");
  assert.equal((await create("alice", tooMany.slice(0, 9))).status, 201, "creator + 9 = 10 fits");
  assert.equal((await create("banned", ["bob"])).status, 403, "a banned member cannot create");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dm_groups").get().n, 1);
});

test("create refuses a block pair between the creator and an invitee, or between invitees", async () => {
  block("bob", "alice");
  assert.equal((await create("alice", ["bob", "carol"])).status, 403);
  db.prepare("DELETE FROM blocks").run();
  block("carol", "dave");
  assert.equal((await create("alice", ["carol", "dave"])).status, 403);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dm_groups").get().n, 0);
});

test("send bumps every other member's unread; read-mark zeroes only the reader; outsiders 404", async () => {
  const id = await createOk("alice", ["bob", "carol"]);
  const sent = await send("alice", id, "hi all");
  assert.equal(sent.status, 201);
  assert.equal((await sent.json()).message.mine, true);
  assert.deepEqual([unreadOf(id, "alice"), unreadOf(id, "bob"), unreadOf(id, "carol")], [0, 1, 1]);
  await send("bob", id);
  assert.deepEqual([unreadOf(id, "alice"), unreadOf(id, "bob"), unreadOf(id, "carol")], [1, 1, 2]);
  const mark = await call(env, "/api/dm/groups/" + id + "/read", { method: "POST", body: {}, session: s.carol });
  assert.equal(mark.status, 200);
  assert.deepEqual([unreadOf(id, "alice"), unreadOf(id, "bob"), unreadOf(id, "carol")], [1, 1, 0]);
  assert.equal((await send("dave", id)).status, 404);
  assert.equal((await call(env, "/api/dm/groups/" + id + "/read", { method: "POST", body: {}, session: s.dave })).status, 404);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dm_group_messages WHERE group_id = ?").get(id).n, 2);
});

test("read hides messages by banned authors, and by anyone in a block pair with the viewer", async () => {
  const id = await createOk("alice", ["bob", "carol", "dave"]);
  await send("bob", id, "from bob");
  await send("carol", id, "from carol");
  seedBan(db, u.dave, null);
  db.prepare("INSERT INTO dm_group_messages (group_id, user_id, body, created_at) VALUES (?, ?, 'from dave', ?)").run(id, u.dave, now());
  block("alice", "bob");
  const aliceView = await (await read("alice", id)).json();
  assert.deepEqual(aliceView.messages.map((m) => m.body), ["from carol"]);
  const carolView = await (await read("carol", id)).json();
  assert.deepEqual(carolView.messages.map((m) => m.body).sort(), ["from bob", "from carol"]);
  assert.ok(!carolView.members.some((m) => m.id === u.dave), "banned members are not listed");
  db.prepare("DELETE FROM bans WHERE user_id = ?").run(u.dave);
  seedBan(db, u.dave, -60);
});

test("a banned member cannot send", async () => {
  const id = await createOk("alice", ["bob", "erin"]);
  seedBan(db, u.erin, 3600);
  assert.equal((await send("erin", id)).status, 403);
  db.prepare("DELETE FROM bans WHERE user_id = ?").run(u.erin);
});

test("add: creator only, refuses existing, banned, blocked-with-any-member, and the cap", async () => {
  const id = await createOk("alice", ["bob"]);
  const add = (who, username) => call(env, "/api/dm/groups/" + id + "/members", { method: "POST", body: { username }, session: s[who] });
  assert.equal((await add("bob", "carol")).status, 403, "non-creator");
  assert.equal((await add("dave", "carol")).status, 404, "outsider");
  assert.equal((await add("alice", "bob")).status, 400, "already a member");
  assert.equal((await add("alice", "banned")).status, 400);
  block("carol", "bob");
  assert.equal((await add("alice", "carol")).status, 403, "block pair with an existing member");
  db.prepare("DELETE FROM blocks").run();
  assert.equal((await add("alice", "carol")).status, 200);
  for (const name of ["dave", "erin", "frank", "gus", "hana", "ivan", "jo"]) {
    assert.equal((await add("alice", name)).status, 200, name);
  }
  assert.equal(memberIds(id).length, DM_GROUP_MAX_MEMBERS);
  assert.equal((await add("alice", "kim")).status, 400, "cap");
});

test("remove: creator only; removed members lose access; the creator cannot remove themself", async () => {
  const id = await createOk("alice", ["bob", "carol"]);
  const remove = (who, target) => call(env, "/api/dm/groups/" + id + "/members/" + u[target], { method: "DELETE", session: s[who] });
  assert.equal((await remove("bob", "carol")).status, 403);
  assert.equal((await remove("alice", "alice")).status, 400);
  assert.equal((await remove("alice", "dave")).status, 404, "not a member");
  assert.equal((await remove("alice", "bob")).status, 200);
  assert.equal((await read("bob", id)).status, 404);
  assert.equal((await send("bob", id)).status, 404);
});

test("leave: anyone can leave; the last member out deletes the group", async () => {
  const id = await createOk("alice", ["bob"]);
  const leave = (who) => call(env, "/api/dm/groups/" + id + "/leave", { method: "POST", body: {}, session: s[who] });
  assert.equal((await leave("carol")).status, 404);
  assert.equal((await leave("alice")).status, 200);
  assert.equal((await read("alice", id)).status, 404);
  assert.equal((await read("bob", id)).status, 200);
  assert.equal((await (await read("bob", id)).json()).canManage, false, "a departed creator manages nothing");
  assert.equal((await leave("bob")).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dm_groups WHERE id = ?").get(id).n, 0);
});

test("the thread list carries the viewer's groups and the chat poll counts group unread", async () => {
  const id = await createOk("alice", ["bob"], "Pals");
  await send("alice", id);
  await send("alice", id);
  const list = await (await call(env, "/api/dm/threads", { session: s.bob })).json();
  assert.ok(Array.isArray(list.threads));
  const group = list.groups.find((row) => row.id === id);
  assert.equal(group.name, "Pals");
  assert.equal(group.unread, 2);
  assert.ok(group.members.some((m) => m.id === u.alice));
  const outsider = await (await call(env, "/api/dm/threads", { session: s.dave })).json();
  assert.ok(!outsider.groups.some((row) => row.id === id));
  const poll = await (await call(env, "/api/chat", { session: s.bob })).json();
  assert.ok(poll.dmUnread >= 2);
});

test("a typed body shaped like an image token is refused in groups and 1:1", async () => {
  const id = await createOk("alice", ["bob"]);
  const token = "[img:" + "0".repeat(8) + "-0000-4000-8000-" + "0".repeat(12) + "]";
  assert.equal((await send("alice", id, token)).status, 400);
  const open = await (await call(env, "/api/dm/threads", { method: "POST", body: { userId: u.bob }, session: s.alice })).json();
  const direct = await call(env, "/api/dm/threads/" + open.id, { method: "POST", body: { body: token }, session: s.alice });
  assert.equal(direct.status, 400);
});
