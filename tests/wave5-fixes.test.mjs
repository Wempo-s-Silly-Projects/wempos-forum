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

// Wave 2026-11-21-5 F1: the five wave-4 LOWs, each pinned RED-first —
// bounded 1:1 thread list, visibility-law unread counters, the creator-add
// vs last-member-leave race, group-list cursor pagination, and
// account-scoped catch-up markers cleared on sign-out.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DM_THREAD_LIST_LIMIT } from "../constants.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedUser } from "./helpers/seed.mjs";
import {
  CATCH_UP_STORAGE_KEY, catchUpKey, clearAllCatchUp, readSeenMap, recordSeen, writeSeenMap,
} from "../public/js/catch-up.js";

let env;
let db;
const u = {};
const s = {};
const EXTRA_MEMBERS = 60;

before(async () => {
  env = makeEnv();
  db = env.__sqlite;
  for (const name of ["alice", "bob", "carol", "outlaw"]) {
    u[name] = await seedUser(db, { username: name });
    s[name] = forgeSession(db, u[name]);
  }
  for (let index = 0; index < EXTRA_MEMBERS; index += 1) {
    u["m" + index] = await seedUser(db, { username: "member" + index });
  }
  seedBan(db, u.outlaw, null);
});

beforeEach(() => {
  db.prepare("DELETE FROM blocks").run();
  db.prepare("DELETE FROM dm_groups").run();
  db.prepare("DELETE FROM dm_threads").run();
});

const threadWith = (viewer, other, at) => {
  const [a, b] = viewer < other ? [viewer, other] : [other, viewer];
  const id = Number(db.prepare("INSERT INTO dm_threads (user_a, user_b, created_at) VALUES (?, ?, ?)")
    .run(a, b, at).lastInsertRowid);
  db.prepare("INSERT INTO dm_messages (thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?)")
    .run(id, other, "hi", at);
  return id;
};
const groupOf = (memberIds, at, creatorId = memberIds[0]) => {
  const id = Number(db.prepare("INSERT INTO dm_groups (creator_id, name, created_at) VALUES (?, '', ?)")
    .run(creatorId, at).lastInsertRowid);
  for (const memberId of memberIds) {
    db.prepare("INSERT INTO dm_group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)").run(id, memberId, at);
  }
  return id;
};
const groupMessage = (groupId, authorId) => {
  db.prepare("INSERT INTO dm_group_messages (group_id, user_id, body, created_at) VALUES (?, ?, 'x', ?)")
    .run(groupId, authorId, now());
  db.prepare("UPDATE dm_group_members SET unread = unread + 1 WHERE group_id = ? AND user_id <> ?").run(groupId, authorId);
};
const threads = async (who, query = "") => {
  const response = await call(env, "/api/dm/threads" + query, { session: s[who] });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
};

// LOW 1 — the 1:1 thread list is capped at the newest DM_THREAD_LIST_LIMIT.
test("GET /api/dm/threads caps the 1:1 list at the newest DM_THREAD_LIST_LIMIT threads", async () => {
  assert.equal(DM_THREAD_LIST_LIMIT, 50);
  const base = now() - 10000;
  for (let index = 0; index < DM_THREAD_LIST_LIMIT + 5; index += 1) {
    threadWith(u.alice, u["m" + index], base + index);
  }
  const body = await threads("alice");
  assert.equal(body.threads.length, DM_THREAD_LIST_LIMIT);
  const shownIds = body.threads.map((thread) => thread.other.id);
  assert.ok(shownIds.includes(u["m" + (DM_THREAD_LIST_LIMIT + 4)]), "newest thread kept");
  assert.ok(!shownIds.includes(u.m0), "oldest thread dropped");
});

// LOW 2 — counters follow the visibility law (ban + block pair).
test("group unread and the lobby badge skip messages by banned or blocked authors", async () => {
  const groupId = groupOf([u.alice, u.bob, u.carol, u.outlaw], now() - 100);
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(u.alice, u.carol, now());
  groupMessage(groupId, u.bob);
  groupMessage(groupId, u.carol);
  groupMessage(groupId, u.outlaw);
  groupMessage(groupId, u.alice);
  const body = await threads("alice");
  assert.equal(body.groups.find((group) => group.id === groupId).unread, 1);
  const lobby = await (await call(env, "/api/chat", { session: s.alice })).json();
  assert.equal(lobby.dmUnread, 1);
  // Bob sees all three others' messages except his own (no blocks, outlaw hidden).
  assert.equal((await threads("bob")).groups.find((group) => group.id === groupId).unread, 2);
});

test("a 1:1 thread with an actively banned member counts zero unread in the list and the badge", async () => {
  const threadId = threadWith(u.alice, u.outlaw, now() - 50);
  const column = u.alice < u.outlaw ? "unread_a" : "unread_b";
  db.prepare("UPDATE dm_threads SET " + column + " = 2 WHERE id = ?").run(threadId);
  const body = await threads("alice");
  assert.equal(body.threads.find((thread) => thread.id === threadId).unread, 0);
  const lobby = await (await call(env, "/api/chat", { session: s.alice })).json();
  assert.equal(lobby.dmUnread, 0);
});

// LOW 3 — creator add racing the creator's last-member leave.
test("a creator add that loses the race to the creator's last-member leave answers 404, not 500", async () => {
  const groupId = groupOf([u.alice], now());
  const raced = {
    ...env,
    FORUM_DB: {
      ...env.FORUM_DB,
      batch: (statements) => env.FORUM_DB.batch(statements),
      prepare(sql) {
        if (sql.startsWith("INSERT INTO dm_group_members (group_id, user_id, joined_at) SELECT")) {
          db.prepare("DELETE FROM dm_group_members WHERE group_id = ?").run(groupId);
          db.prepare("DELETE FROM dm_groups WHERE id = ?").run(groupId);
        }
        return env.FORUM_DB.prepare(sql);
      },
    },
  };
  const response = await call(raced, "/api/dm/groups/" + groupId + "/members", {
    method: "POST", body: { username: "bob" }, session: s.alice,
  });
  assert.equal(response.status, 404, await response.clone().text());
});

// LOW 4 — groups past the first page are reachable by cursor.
test("GET /api/dm/threads pages the groups key with a before cursor", async () => {
  const base = now() - 100000;
  const ids = [];
  for (let index = 0; index < 55; index += 1) ids.push(groupOf([u.alice, u.bob], base + index));
  const first = await threads("alice");
  assert.equal(first.groups.length, 50);
  assert.equal(typeof first.groupsCursor, "string");
  const second = await threads("alice", "?before=" + encodeURIComponent(first.groupsCursor));
  assert.equal(second.groups.length, 5);
  assert.equal(second.groupsCursor, null);
  const seen = [...first.groups, ...second.groups].map((group) => group.id);
  assert.equal(new Set(seen).size, 55);
  assert.deepEqual([...seen].sort((a, b) => a - b), [...ids].sort((a, b) => a - b));
  assert.equal((await call(env, "/api/dm/threads?before=nope", { session: s.alice })).status, 400);
});

test("a short group list carries a null cursor", async () => {
  groupOf([u.alice, u.bob], now());
  assert.equal((await threads("alice")).groupsCursor, null);
});

// LOW 5 — catch-up markers are per account and leave on sign-out.
const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
    data,
  };
};

test("catch-up marks are keyed per account; a guest keeps the unscoped key", () => {
  assert.equal(catchUpKey(null), CATCH_UP_STORAGE_KEY);
  assert.equal(catchUpKey(7), CATCH_UP_STORAGE_KEY + ":u7");
  const storage = memoryStorage();
  writeSeenMap(storage, recordSeen({}, 1, 10, 1), 7);
  assert.deepEqual(readSeenMap(storage, 8), {});
  assert.deepEqual(readSeenMap(storage), {});
  assert.equal(readSeenMap(storage, 7)["1"].id, 10);
});

test("clearAllCatchUp removes every account's marks and leaves other keys", () => {
  const storage = memoryStorage();
  writeSeenMap(storage, { 1: { id: 1, at: 1 } }, 7);
  writeSeenMap(storage, { 1: { id: 1, at: 1 } }, 8);
  writeSeenMap(storage, { 1: { id: 1, at: 1 } });
  storage.setItem("forum-draft:reply:1", "{}");
  clearAllCatchUp(storage);
  assert.deepEqual([...storage.data.keys()], ["forum-draft:reply:1"]);
  assert.doesNotThrow(() => clearAllCatchUp(null));
  assert.doesNotThrow(() => clearAllCatchUp({ get length() { throw new Error("blocked"); } }));
});

test("sign-out clears catch-up marks and the thread page passes the account id", () => {
  const nav = readFileSync(new URL("../public/js/routes/account-nav.js", import.meta.url), "utf8");
  assert.match(nav, /clearAllCatchUp\(\)/);
  const post = readFileSync(new URL("../public/js/routes/post.js", import.meta.url), "utf8");
  assert.match(post, /applyCatchUp\([^)]*accountId: state\.currentUser\?\.id/);
});

test("the widget pages older groups through the before cursor and keeps them across refreshes", () => {
  const threadsModule = readFileSync(new URL("../public/js/chat-widget-threads.js", import.meta.url), "utf8");
  assert.match(threadsModule, /\/api\/dm\/threads\?before=" \+ encodeURIComponent\(cursor\)/);
  assert.match(threadsModule, /t\("dm\.olderGroups"\)/);
  assert.match(threadsModule, /mergeOlderGroups\(data\.groups\)/);
});
