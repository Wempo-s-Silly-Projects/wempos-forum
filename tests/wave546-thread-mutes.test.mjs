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

// v5.46.0 F1: mute a thread (migration 0071). PUT/DELETE /api/posts/:id/mute
// on a ROOT the member can see; every notification fan-out that originates in
// a muted thread skips that member inside its own INSERT…SELECT (no extra
// round trip). Chat mentions and invite joins are not thread-scoped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { ORIGIN, call, forgeSession, now, seedPost, seedUser, sha256 } from "./helpers/seed.mjs";
import { D1_MAX_BOUND_PARAMS } from "../constants.mjs";
import { fanOutStatements, mutedThreadSql } from "../api/notifications.mjs";
import { followerFanOutStatements, followThreadLabel } from "../api/follows.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const MIGRATION = "migrations/0071_thread_mutes.sql";
const TOKEN = "agent-token-for-thread-mute-tests-0123456789AB";

async function world(overrides = {}) {
  const env = makeEnv({ AGENT_TOKENS: JSON.stringify({ [sha256(TOKEN)]: "bot" }), ...overrides });
  const db = env.__sqlite;
  const id = {};
  for (const name of ["alice", "bob", "carol", "dave", "bot"]) id[name] = await seedUser(db, { username: name });
  id.boss = await seedUser(db, { username: "boss", role: "admin" });
  const session = (name) => forgeSession(db, id[name]);
  return { env, db, id, session };
}
const count = (db, sql, ...args) => db.prepare("SELECT COUNT(*) AS n FROM " + sql).get(...args).n;
const rowsFor = (w, userId) => count(w.db, "notifications WHERE user_id = ?", userId);
const mutePath = (postId) => "/api/posts/" + postId + "/mute";
const mute = (w, name, postId) => call(w.env, mutePath(postId), { method: "PUT", session: w.session(name) });
const unmute = (w, name, postId) => call(w.env, mutePath(postId), { method: "DELETE", session: w.session(name) });
const reply = (w, name, postId, body) =>
  call(w.env, "/api/posts/" + postId + "/replies", { method: "POST", body: { body }, session: w.session(name) });

// ---- migration ---------------------------------------------------------------

test("migration 0071 is CREATE-only and both references cascade", async () => {
  const sql = read(MIGRATION).replace(/--.*$/gm, "");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS thread_mutes/);
  assert.match(sql, /PRIMARY KEY \(user_id, post_id\)/);
  assert.doesNotMatch(sql.replace(/ON DELETE CASCADE/g, ""), /\b(DROP|ALTER|INSERT|UPDATE|DELETE|REPLACE)\b/i);
  const refs = sql.match(/REFERENCES [^,\n]+/g) || [];
  assert.equal(refs.length, 2);
  for (const ref of refs) assert.match(ref, /ON DELETE CASCADE/);
  const w = await world();
  const fks = w.db.prepare("PRAGMA foreign_key_list(thread_mutes)").all();
  assert.deepEqual(fks.map((fk) => fk.table).sort(), ["posts", "users"]);
  for (const fk of fks) assert.equal(fk.on_delete, "CASCADE");
});

test("cascade: deleting the account or the thread takes the mute rows with it", async () => {
  const w = await world();
  // Fleet tables 0043 references are absent from the forum schema (pinned in
  // wave520/wave523); stub them like wave540 so a users DELETE can run.
  w.db.exec("CREATE TABLE IF NOT EXISTS gc_messages (id INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS gc_channels (id INTEGER PRIMARY KEY)");
  const keep = seedPost(w.db, { authorId: w.id.bob, body: "bob keeps this" });
  const doomed = seedPost(w.db, { authorId: w.id.bob, body: "bob deletes this" });
  for (const name of ["alice", "carol"]) {
    assert.equal((await mute(w, name, keep)).status, 200);
    assert.equal((await mute(w, name, doomed)).status, 200);
  }
  assert.equal(count(w.db, "thread_mutes"), 4);
  const del = await call(w.env, "/api/me/delete", { method: "POST", session: w.session("alice") });
  assert.equal(del.status, 200);
  assert.equal(count(w.db, "thread_mutes WHERE user_id = ?", w.id.alice), 0, "account delete cascades");
  assert.equal(count(w.db, "thread_mutes WHERE user_id = ?", w.id.carol), 2, "others keep theirs");
  const gone = await call(w.env, "/api/posts/" + doomed, { method: "DELETE", session: w.session("bob") });
  assert.equal(gone.status, 200);
  assert.equal(count(w.db, "thread_mutes WHERE post_id = ?", doomed), 0, "thread delete cascades");
  assert.equal(count(w.db, "thread_mutes WHERE post_id = ?", keep), 1);
});

// ---- route: auth, validation, visibility ----------------------------------

test("PUT/DELETE auth: no Origin 403, anon 401, bad CSRF 403, rate limited 429, GET 405; nothing written", async () => {
  const w = await world();
  const root = seedPost(w.db, { authorId: w.id.bob, body: "root" });
  assert.equal((await call(w.env, mutePath(root), { method: "PUT" })).status, 403);
  const anon = await call(w.env, mutePath(root), { method: "PUT",
    headers: { Origin: ORIGIN, "X-CSRF-Token": "x" } });
  assert.equal(anon.status, 401);
  const s = w.session("alice");
  const bad = await call(w.env, mutePath(root), { method: "PUT", session: { ...s, csrf: "wrong-token-wrong-token-wrong" } });
  assert.equal(bad.status, 403);
  const badDelete = await call(w.env, mutePath(root), { method: "DELETE", session: { ...s, csrf: "wrong-token-wrong-token-wrong" } });
  assert.equal(badDelete.status, 403);
  assert.equal((await call(w.env, mutePath(root), { method: "GET", session: s })).status, 405);
  const env = makeEnv({ ...makeLimiters(false).bindings });
  const zed = await seedUser(env.__sqlite, { username: "zed" });
  const zroot = seedPost(env.__sqlite, { authorId: zed, body: "z" });
  const limited = await call(env, mutePath(zroot), { method: "PUT", session: forgeSession(env.__sqlite, zed) });
  assert.equal(limited.status, 429);
  assert.equal(count(w.db, "thread_mutes"), 0);
  assert.equal(count(env.__sqlite, "thread_mutes"), 0);
});

test("roots only (reply 400); invisible thread 404 (missing, hidden, banned author, block pair either way)", async () => {
  const w = await world();
  const root = seedPost(w.db, { authorId: w.id.bob, body: "root" });
  const child = seedPost(w.db, { authorId: w.id.carol, body: "child", parentId: root });
  assert.equal((await mute(w, "alice", child)).status, 400);
  assert.equal((await mute(w, "alice", 999999)).status, 404);
  const hidden = seedPost(w.db, { authorId: w.id.bob, body: "hidden", visibility: "hidden" });
  assert.equal((await mute(w, "alice", hidden)).status, 404);
  const bannedRoot = seedPost(w.db, { authorId: w.id.dave, body: "by a banned member" });
  w.db.prepare("INSERT INTO bans (user_id, reason, created_at, expires_at) VALUES (?, 'x', ?, NULL)").run(w.id.dave, now() - 10);
  assert.equal((await mute(w, "alice", bannedRoot)).status, 404);
  w.db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(w.id.alice, w.id.bob, now());
  assert.equal((await mute(w, "alice", root)).status, 404, "the blocker cannot reach the blockee's thread");
  const carolRoot = seedPost(w.db, { authorId: w.id.carol, body: "carol" });
  w.db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(w.id.carol, w.id.alice, now());
  assert.equal((await mute(w, "alice", carolRoot)).status, 404, "the blockee cannot reach the blocker's thread");
  assert.equal((await mute(w, "alice", "abc")).status, 404);
  assert.equal(count(w.db, "thread_mutes"), 0);
});

test("PUT is idempotent, DELETE clears; the thread payload carries viewerMuted for members only", async () => {
  const w = await world();
  const root = seedPost(w.db, { authorId: w.id.bob, body: "root" });
  const child = seedPost(w.db, { authorId: w.id.carol, body: "child", parentId: root });
  const first = await mute(w, "alice", root);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, muted: true });
  assert.equal((await mute(w, "alice", root)).status, 200);
  assert.equal(count(w.db, "thread_mutes WHERE user_id = ? AND post_id = ?", w.id.alice, root), 1);
  const seen = await (await call(w.env, "/api/posts/" + root, { session: w.session("alice") })).json();
  assert.equal(seen.viewerMuted, true);
  const other = await (await call(w.env, "/api/posts/" + root, { session: w.session("carol") })).json();
  assert.equal(other.viewerMuted, false, "another member's payload reads their own state");
  const guest = await (await call(w.env, "/api/posts/" + root)).json();
  assert.equal(Object.hasOwn(guest, "viewerMuted"), false, "guests get no field");
  const replyDetail = await (await call(w.env, "/api/posts/" + child, { session: w.session("alice") })).json();
  assert.equal(Object.hasOwn(replyDetail, "viewerMuted"), false, "replies carry no mute state");
  const off = await unmute(w, "alice", root);
  assert.equal(off.status, 200);
  assert.deepEqual(await off.json(), { ok: true, muted: false });
  assert.equal((await unmute(w, "alice", root)).status, 200);
  assert.equal(count(w.db, "thread_mutes"), 0);
  const after = await (await call(w.env, "/api/posts/" + root, { session: w.session("alice") })).json();
  assert.equal(after.viewerMuted, false);
});

// ---- enforcement: every fan-out that originates in the thread ----------------

test("web reply: a reply to the muted root author lands nothing; unmuting restores future rows", async () => {
  const w = await world();
  const root = seedPost(w.db, { authorId: w.id.alice, body: "root" });
  await mute(w, "alice", root);
  assert.equal((await reply(w, "bob", root, "first")).status, 201);
  assert.equal(rowsFor(w, w.id.alice), 0);
  await unmute(w, "alice", root);
  assert.equal((await reply(w, "bob", root, "second")).status, 201);
  assert.equal(rowsFor(w, w.id.alice), 1);
});

test("web reply: a sub-reply to a muted member's level-1 reply resolves to the root mute", async () => {
  const w = await world();
  const root = seedPost(w.db, { authorId: w.id.alice, body: "root" });
  const level1 = seedPost(w.db, { authorId: w.id.carol, body: "carol replies", parentId: root });
  await mute(w, "carol", root);
  assert.equal((await reply(w, "dave", level1, "to carol")).status, 201);
  assert.equal(rowsFor(w, w.id.carol), 0);
  await unmute(w, "carol", root);
  assert.equal((await reply(w, "dave", level1, "to carol again")).status, 201);
  assert.equal(rowsFor(w, w.id.carol), 1);
});

test("subscription: a muted subscriber is skipped, the others still notified; unmute restores", async () => {
  const w = await world();
  const root = seedPost(w.db, { authorId: w.id.alice, body: "root" });
  for (const name of ["carol", "dave"]) {
    assert.ok((await call(w.env, "/api/posts/" + root + "/subscribe", { method: "POST", session: w.session(name) })).status < 300);
  }
  await mute(w, "carol", root);
  await reply(w, "bob", root, "news");
  assert.equal(rowsFor(w, w.id.carol), 0);
  assert.equal(rowsFor(w, w.id.dave), 1, "an unmuted subscriber is unaffected");
  assert.equal(rowsFor(w, w.id.alice), 1, "the unmuted author is unaffected");
  await unmute(w, "carol", root);
  await reply(w, "bob", root, "more news");
  assert.equal(rowsFor(w, w.id.carol), 1);
});

test("mention: an @mention inside a muted thread is skipped; outside it still lands", async () => {
  const w = await world();
  const root = seedPost(w.db, { authorId: w.id.alice, body: "root" });
  const elsewhere = seedPost(w.db, { authorId: w.id.alice, body: "another thread" });
  const level1 = seedPost(w.db, { authorId: w.id.alice, body: "level1", parentId: root });
  await mute(w, "carol", root);
  await reply(w, "bob", root, "hey @carol and @dave");
  await reply(w, "bob", level1, "deeper @carol");
  assert.equal(rowsFor(w, w.id.carol), 0);
  assert.equal(rowsFor(w, w.id.dave), 1);
  await reply(w, "bob", elsewhere, "over here @carol");
  assert.equal(rowsFor(w, w.id.carol), 1, "a mute is per thread");
  await unmute(w, "carol", root);
  await reply(w, "bob", root, "back @carol");
  assert.equal(rowsFor(w, w.id.carol), 2);
});

test("MCP reply tool: reply, mention and subscription rows all honour the mute", async () => {
  const w = await world();
  const root = seedPost(w.db, { authorId: w.id.alice, body: "root" });
  await call(w.env, "/api/posts/" + root + "/subscribe", { method: "POST", session: w.session("dave") });
  for (const name of ["alice", "carol", "dave"]) await mute(w, name, root);
  const tool = (body) => call(w.env, "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "reply", arguments: { post_id: root, body } } }) });
  const res = await tool("agent says hi @carol");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).result.isError, false);
  for (const name of ["alice", "carol", "dave"]) assert.equal(rowsFor(w, w.id[name]), 0, name);
  for (const name of ["alice", "carol", "dave"]) await unmute(w, name, root);
  await tool("again @carol");
  for (const name of ["alice", "carol", "dave"]) assert.equal(rowsFor(w, w.id[name]), 1, name);
});

test("post-create paths: mention and follow_thread fan-outs skip a member who muted that root", async () => {
  const w = await world();
  const root = seedPost(w.db, { authorId: w.id.alice, body: "hi @carol" });
  w.db.prepare("INSERT INTO thread_mutes (user_id, post_id, created_at) VALUES (?, ?, ?)").run(w.id.carol, root, now());
  w.db.prepare("INSERT INTO thread_mutes (user_id, post_id, created_at) VALUES (?, ?, ?)").run(w.id.bob, root, now());
  // bot follows but was not mentioned (a mention row would dedupe its follow row).
  for (const name of ["bob", "bot"]) {
    w.db.prepare("INSERT INTO user_follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)").run(w.id[name], w.id.alice, now());
  }
  const db = w.env.FORUM_DB;
  await db.batch(fanOutStatements(db, [w.id.carol, w.id.dave], { targetPostId: root, replyId: root, now: now(), label: "You were mentioned by alice", kind: "mention" }));
  assert.equal(rowsFor(w, w.id.carol), 0, "root mention skipped");
  assert.equal(rowsFor(w, w.id.dave), 1);
  await db.batch(followerFanOutStatements(db, { authorId: w.id.alice, postId: root, username: "alice", now: now() }));
  assert.equal(count(w.db, "notifications WHERE label = ? AND user_id = ?", followThreadLabel("alice"), w.id.bob), 0);
  assert.equal(count(w.db, "notifications WHERE label = ? AND user_id = ?", followThreadLabel("alice"), w.id.bot), 1);
});

test("not thread-scoped: a lobby @mention still reaches a member who muted threads", async () => {
  const w = await world();
  const root = seedPost(w.db, { authorId: w.id.alice, body: "root" });
  await mute(w, "carol", root);
  const chat = await call(w.env, "/api/chat", { method: "POST", body: { body: "yo @carol" }, session: w.session("bob") });
  assert.equal(chat.status, 201);
  assert.equal(rowsFor(w, w.id.carol), 1);
});

test("the predicate binds nothing and every fan-out statement covers it, under D1_MAX_BOUND_PARAMS", async () => {
  assert.doesNotMatch(mutedThreadSql("n.user_id", "p.id"), /\?/);
  assert.match(mutedThreadSql("n.user_id", "p.id"), /thread_mutes/);
  assert.match(read("api/notifications.mjs"), /insertNotificationSql[\s\S]{0,700}mutedThreadSql\("\?", "\?"\)/);
  assert.match(read("api/follows.mjs"), /FANOUT_INSERT_SQL =[\s\S]{0,700}mutedThreadSql\("e\.follower_id", "p\.id"\)/);
  const w = await world();
  const root = seedPost(w.db, { authorId: w.id.alice, body: "root" });
  for (const name of ["carol", "dave"]) await call(w.env, "/api/posts/" + root + "/subscribe", { method: "POST", session: w.session(name) });
  await mute(w, "carol", root);
  const realPrepare = w.env.FORUM_DB.prepare.bind(w.env.FORUM_DB);
  let maxBinds = 0;
  const muteReads = [];
  w.env.FORUM_DB.prepare = (sql) => {
    const statement = realPrepare(sql);
    if (/thread_mutes/.test(sql) && !/^\s*INSERT INTO notifications/i.test(sql)) muteReads.push(sql);
    const realBind = statement.bind.bind(statement);
    statement.bind = (...values) => { maxBinds = Math.max(maxBinds, values.length); return realBind(...values); };
    return statement;
  };
  assert.equal((await reply(w, "bob", root, "hi @dave")).status, 201);
  assert.ok(maxBinds < D1_MAX_BOUND_PARAMS, "max binds " + maxBinds);
  assert.deepEqual(muteReads, [], "mutes are enforced inside the INSERT…SELECT, never read per recipient");
  assert.equal(rowsFor(w, w.id.carol), 0);
  assert.equal(rowsFor(w, w.id.dave), 1);
});
