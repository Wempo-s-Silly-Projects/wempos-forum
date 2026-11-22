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

// v5.44.0 DM message reactions (migration 0070, dm_message_reactions): one
// reaction per person per 1:1 message, from the post-reaction allowlist.
// Only the thread's two participants may react or see reactions — anyone
// else gets 404 (never 403: no existence oracle). A block pair either way
// refuses; a banned actor is refused; a banned author's (hidden) message is
// 404. Reactions ride the thread read in one grouped query per page; the
// member's own reactions ride their data export; every reference cascades.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedUser } from "./helpers/seed.mjs";
import { REACTION_VALUES } from "../constants.mjs";

async function world(overrides = {}) {
  const env = makeEnv(overrides);
  const db = env.__sqlite;
  const id = {
    alice: await seedUser(db, { username: "alice" }),
    bob: await seedUser(db, { username: "bob" }),
    eve: await seedUser(db, { username: "eve" }),
    boss: await seedUser(db, { username: "boss", role: "admin" }),
  };
  const at = now();
  const thread = Number(db.prepare("INSERT INTO dm_threads (user_a, user_b, created_at) VALUES (?, ?, ?)")
    .run(Math.min(id.alice, id.bob), Math.max(id.alice, id.bob), at).lastInsertRowid);
  const message = (userId, body) => Number(db.prepare(
    "INSERT INTO dm_messages (thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?)",
  ).run(thread, userId, body, at).lastInsertRowid);
  const fromBob = message(id.bob, "hello alice");
  const fromAlice = message(id.alice, "hi bob");
  const session = (name) => forgeSession(db, id[name]);
  return { env, db, id, thread, fromBob, fromAlice, session, message };
}

const reactionPath = (messageId) => "/api/dm/messages/" + messageId + "/reaction";
const react = (w, messageId, value, session) =>
  call(w.env, reactionPath(messageId), { method: "PUT", body: { value }, session });
const unreact = (w, messageId, session) => call(w.env, reactionPath(messageId), { method: "DELETE", session });
const count = (db, sql, ...args) => Number(db.prepare("SELECT COUNT(*) AS n FROM " + sql).get(...args).n);
const allowUserDeletes = (db) =>
  db.exec("CREATE TABLE IF NOT EXISTS gc_messages (id INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS gc_channels (id INTEGER PRIMARY KEY)");

async function readThread(w, name) {
  const res = await call(w.env, "/api/dm/threads/" + w.thread, { session: w.session(name) });
  assert.equal(res.status, 200);
  const body = await res.json();
  return Object.fromEntries(body.messages.map((message) => [message.id, message.reactions]));
}

test("the DM allowlist is the post-reaction allowlist (one shared constant)", () => {
  assert.deepEqual([...REACTION_VALUES], ["like", "dislike"]);
  assert.ok(Object.isFrozen(REACTION_VALUES));
  const posts = readFileSync(new URL("../api/posts-write.mjs", import.meta.url), "utf8");
  assert.match(posts, /REACTION_VALUES\.includes\(/);
  const dm = readFileSync(new URL("../api/dm-reactions.mjs", import.meta.url), "utf8");
  assert.match(dm, /REACTION_VALUES\.includes\(/);
});

test("a participant reacts, switches and removes; the thread read shows counts and mine", async () => {
  const w = await world();
  assert.equal((await react(w, w.fromBob, "like", w.session("alice"))).status, 200);
  let alice = await readThread(w, "alice");
  assert.deepEqual(alice[w.fromBob], { like: 1, dislike: 0, mine: "like" });
  assert.deepEqual(alice[w.fromAlice], { like: 0, dislike: 0, mine: null });
  const bob = await readThread(w, "bob");
  assert.deepEqual(bob[w.fromBob], { like: 1, dislike: 0, mine: null });
  // One reaction per person per message: a second PUT switches it.
  assert.equal((await react(w, w.fromBob, "dislike", w.session("alice"))).status, 200);
  assert.equal(count(w.db, "dm_message_reactions"), 1);
  alice = await readThread(w, "alice");
  assert.deepEqual(alice[w.fromBob], { like: 0, dislike: 1, mine: "dislike" });
  // Bob may react to his own message too: both participants count.
  assert.equal((await react(w, w.fromBob, "dislike", w.session("bob"))).status, 200);
  assert.deepEqual((await readThread(w, "bob"))[w.fromBob], { like: 0, dislike: 2, mine: "dislike" });
  assert.equal((await unreact(w, w.fromBob, w.session("alice"))).status, 200);
  assert.deepEqual((await readThread(w, "alice"))[w.fromBob], { like: 0, dislike: 1, mine: null });
  // DELETE is idempotent: nothing left to remove is still ok.
  assert.equal((await unreact(w, w.fromBob, w.session("alice"))).status, 200);
});

test("values outside the allowlist are refused with 400 and store nothing", async () => {
  const w = await world();
  for (const value of ["love", "", null, 1, "LIKE", ["like"]]) {
    const res = await react(w, w.fromBob, value, w.session("alice"));
    assert.equal(res.status, 400, JSON.stringify(value));
  }
  assert.equal(count(w.db, "dm_message_reactions"), 0);
});

test("non-participants get 404 on PUT and DELETE (members and staff alike); missing ids 404", async () => {
  const w = await world();
  for (const name of ["eve", "boss"]) {
    assert.equal((await react(w, w.fromBob, "like", w.session(name))).status, 404, name + " PUT");
    assert.equal((await unreact(w, w.fromBob, w.session(name))).status, 404, name + " DELETE");
  }
  assert.equal((await react(w, 999999, "like", w.session("alice"))).status, 404);
  assert.equal((await unreact(w, 999999, w.session("alice"))).status, 404);
  assert.equal(count(w.db, "dm_message_reactions"), 0);
  // The thread read never shows reactions to an outsider: it is refused.
  const outsider = await call(w.env, "/api/dm/threads/" + w.thread, { session: w.session("eve") });
  assert.notEqual(outsider.status, 200);
});

test("anonymous is 401; writes demand same-origin + X-CSRF-Token; writes are rate limited", async () => {
  const w = await world();
  const origin = { Origin: "https://wempos-forum.com" };
  assert.equal((await call(w.env, reactionPath(w.fromBob), { method: "PUT", body: { value: "like" }, headers: origin })).status, 401);
  assert.equal((await call(w.env, reactionPath(w.fromBob), { method: "DELETE", headers: origin })).status, 401);
  const alice = w.session("alice");
  const badToken = await call(w.env, reactionPath(w.fromBob), { method: "PUT", body: { value: "like" },
    session: { cookie: alice.cookie, csrf: "wrong-token" } });
  assert.equal(badToken.status, 403);
  const crossSite = await call(w.env, reactionPath(w.fromBob), { method: "PUT", body: { value: "like" },
    headers: { Cookie: alice.cookie, "X-CSRF-Token": alice.csrf, Origin: "https://evil.example" } });
  assert.equal(crossSite.status, 403);
  assert.equal(count(w.db, "dm_message_reactions"), 0);
  const limited = await world({ ...makeLimiters(false).bindings });
  assert.equal((await react(limited, limited.fromBob, "like", limited.session("alice"))).status, 429);
  assert.equal((await unreact(limited, limited.fromBob, limited.session("alice"))).status, 429);
});

test("a block pair refuses reactions both ways and hides the other side's reactions", async () => {
  for (const [blocker, blocked] of [["alice", "bob"], ["bob", "alice"]]) {
    const w = await world();
    // Bob reacted to alice's message before the block landed.
    assert.equal((await react(w, w.fromAlice, "like", w.session("bob"))).status, 200);
    w.db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(w.id[blocker], w.id[blocked], now());
    for (const name of ["alice", "bob"]) {
      const target = name === "alice" ? w.fromBob : w.fromAlice;
      assert.equal((await react(w, target, "like", w.session(name))).status, 403, blocker + " blocks " + blocked + ": " + name);
      assert.equal((await unreact(w, target, w.session(name))).status, 403, blocker + " blocks " + blocked + ": " + name + " DELETE");
    }
    const alice = await readThread(w, "alice");
    assert.deepEqual(alice[w.fromAlice], { like: 0, dislike: 0, mine: null }, blocker + " blocks " + blocked);
  }
});

test("a banned actor is refused; a banned author's hidden message is 404 and their reactions vanish", async () => {
  const w = await world();
  assert.equal((await react(w, w.fromAlice, "like", w.session("bob"))).status, 200);
  seedBan(w.db, w.id.bob);
  assert.equal((await react(w, w.fromAlice, "dislike", w.session("bob"))).status, 403);
  assert.equal((await react(w, w.fromBob, "like", w.session("alice"))).status, 404);
  assert.deepEqual((await readThread(w, "alice"))[w.fromAlice], { like: 0, dislike: 0, mine: null });
  // An expired ban restores everything with no write.
  w.db.prepare("UPDATE bans SET expires_at = ? WHERE user_id = ?").run(now() - 60, w.id.bob);
  assert.deepEqual((await readThread(w, "alice"))[w.fromAlice], { like: 1, dislike: 0, mine: null });
});

test("group DMs are out of scope: an id that is not a 1:1 message is a 404", async () => {
  const w = await world();
  const group = Number(w.db.prepare("INSERT INTO dm_groups (creator_id, name, created_at) VALUES (?, 'g', ?)").run(w.id.alice, now()).lastInsertRowid);
  w.db.prepare("INSERT INTO dm_group_members (group_id, user_id, joined_at, unread) VALUES (?, ?, ?, 0)").run(group, w.id.alice, now());
  const groupMessage = Number(w.db.prepare("INSERT INTO dm_group_messages (group_id, user_id, body, created_at) VALUES (?, ?, 'g', ?)")
    .run(group, w.id.alice, now()).lastInsertRowid) + 1000;
  assert.equal((await react(w, groupMessage, "like", w.session("alice"))).status, 404);
});

test("the thread read's reactions cost ONE grouped query per page (no N+1)", async () => {
  const w = await world();
  for (let i = 0; i < 40; i += 1) w.message(i % 2 ? w.id.alice : w.id.bob, "m" + i);
  const ids = w.db.prepare("SELECT id FROM dm_messages WHERE thread_id = ?").all(w.thread).map((row) => Number(row.id));
  for (const messageId of ids) {
    w.db.prepare("INSERT INTO dm_message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, 'like', ?)").run(messageId, w.id.alice, now());
  }
  const real = w.env.FORUM_DB;
  const seen = [];
  const spied = { ...w.env, FORUM_DB: { prepare(sql) { seen.push(sql); return real.prepare(sql); },
    batch: (s) => real.batch(s), exec: (s) => real.exec(s) } };
  const res = await call(spied, "/api/dm/threads/" + w.thread, { session: w.session("bob") });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.messages.length > 40);
  assert.ok(body.messages.every((message) => message.reactions.like === 1));
  assert.equal(seen.filter((sql) => /dm_message_reactions/.test(sql)).length, 1);
});

test("the member's data export carries their own DM reactions (and only theirs)", async () => {
  const w = await world();
  await react(w, w.fromBob, "like", w.session("alice"));
  await react(w, w.fromAlice, "dislike", w.session("bob"));
  const res = await call(w.env, "/api/me/export", { session: w.session("alice") });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.dmReactions.length, 1);
  assert.equal(data.dmReactions[0].messageId, w.fromBob);
  assert.equal(data.dmReactions[0].value, "like");
  assert.equal(typeof data.dmReactions[0].reactedAt, "string");
  assert.equal(data.truncated.dmReactions, false);
});

test("cascades: removing the message, the thread or the reacting member removes the reaction", async () => {
  const w = await world();
  allowUserDeletes(w.db);
  const insert = w.db.prepare("INSERT INTO dm_message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, 'like', ?)");
  insert.run(w.fromBob, w.id.alice, now());
  w.db.prepare("DELETE FROM dm_messages WHERE id = ?").run(w.fromBob);
  assert.equal(count(w.db, "dm_message_reactions"), 0, "message removal");
  insert.run(w.fromAlice, w.id.bob, now());
  w.db.prepare("DELETE FROM dm_threads WHERE id = ?").run(w.thread);
  assert.equal(count(w.db, "dm_message_reactions"), 0, "thread removal");
  const w2 = await world();
  allowUserDeletes(w2.db);
  w2.db.prepare("INSERT INTO dm_message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, 'like', ?)").run(w2.fromAlice, w2.id.bob, now());
  w2.db.prepare("DELETE FROM users WHERE id = ?").run(w2.id.bob);
  assert.equal(count(w2.db, "dm_message_reactions"), 0, "member removal");
});

test("the table refuses values outside the allowlist and a second row per member", async () => {
  const w = await world();
  const insert = w.db.prepare("INSERT INTO dm_message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)");
  assert.throws(() => insert.run(w.fromBob, w.id.alice, "heart", now()));
  insert.run(w.fromBob, w.id.alice, "like", now());
  assert.throws(() => insert.run(w.fromBob, w.id.alice, "dislike", now()));
});
