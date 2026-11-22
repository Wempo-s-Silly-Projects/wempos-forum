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

// v5.40.0 F1: per-kind notification preferences (migration 0068). A member
// mutes kinds from a FIXED allowlist; every notification-creating path skips
// a muted recipient inside its own INSERT…SELECT (fixed binds, no per-
// recipient round trip). Appeal outcomes are safety notices and never mute.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";
import { D1_MAX_BOUND_PARAMS } from "../constants.mjs";
import { NOTIFICATION_KINDS } from "../api/notifications.mjs";
import { followThreadLabel } from "../api/follows.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const PREFS = "/api/me/notification-prefs";
const MIGRATION = "migrations/0068_notification_prefs.sql";

async function world() {
  const env = makeEnv();
  const db = env.__sqlite;
  const id = {};
  for (const name of ["alice", "bob", "carol", "dave"]) id[name] = await seedUser(db, { username: name });
  id.boss = await seedUser(db, { username: "boss", role: "admin" });
  const session = (name) => forgeSession(db, id[name]);
  return { env, db, id, session };
}
const count = (db, sql, ...args) => db.prepare("SELECT COUNT(*) AS n FROM " + sql).get(...args).n;
const mute = (w, name, muted) => call(w.env, PREFS, { method: "PUT", body: { muted }, session: w.session(name) });
const rowsFor = (w, userId) => count(w.db, "notifications WHERE user_id = ?", userId);

// ---- allowlist + migration ---------------------------------------------------

test("the kind allowlist is fixed, frozen and documented", () => {
  assert.deepEqual([...NOTIFICATION_KINDS],
    ["reply", "subscription", "mention", "chat_mention", "follow_thread", "invite_joined"]);
  assert.ok(Object.isFrozen(NOTIFICATION_KINDS));
  for (const kind of NOTIFICATION_KINDS) assert.match(kind, /^[a-z_]+$/);
});

test("migration 0068 is CREATE-only, keyed on the member, and cascades on account delete", async () => {
  const sql = read(MIGRATION).replace(/--.*$/gm, "");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS notification_prefs/);
  assert.doesNotMatch(sql.replace(/ON DELETE CASCADE/g, ""), /\b(DROP|ALTER|INSERT|UPDATE|DELETE|REPLACE)\b/i);
  const refs = sql.match(/REFERENCES [^,\n]+/g) || [];
  assert.equal(refs.length, 1);
  assert.match(refs[0], /users\(id\) ON DELETE CASCADE/);
  const w = await world();
  const fks = w.db.prepare("PRAGMA foreign_key_list(notification_prefs)").all();
  assert.equal(fks.length, 1);
  assert.equal(fks[0].on_delete, "CASCADE");
  assert.equal((await mute(w, "alice", ["reply"])).status, 200);
  assert.equal((await mute(w, "bob", ["mention"])).status, 200);
  assert.equal(count(w.db, "notification_prefs"), 2);
  const del = await call(w.env, "/api/me/delete", { method: "POST", session: w.session("alice") });
  assert.equal(del.status, 200);
  assert.equal(count(w.db, "users WHERE id = ?", w.id.alice), 0);
  assert.equal(count(w.db, "notification_prefs WHERE user_id = ?", w.id.alice), 0, "the deleted member's prefs cascade");
  assert.equal(count(w.db, "notification_prefs WHERE user_id = ?", w.id.bob), 1, "other members keep theirs");
});

// ---- routes: auth, validation, round trip ----------------------------------

test("GET: guests 401; a member sees the allowlist and nothing muted by default", async () => {
  const w = await world();
  assert.equal((await call(w.env, PREFS)).status, 401);
  const res = await call(w.env, PREFS, { session: w.session("alice") });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { kinds: [...NOTIFICATION_KINDS], muted: [] });
});

test("PUT auth: no Origin 403, anon 401, bad CSRF 403, banned 403, rate limited 429; nothing written", async () => {
  const w = await world();
  assert.equal((await call(w.env, PREFS, { method: "PUT", body: { muted: [] } })).status, 403);
  const anon = await call(w.env, PREFS, { method: "PUT", body: { muted: [] },
    headers: { Origin: "https://wempos-forum.com", "X-CSRF-Token": "x" } });
  assert.equal(anon.status, 401);
  const s = w.session("alice");
  const bad = await call(w.env, PREFS, { method: "PUT", body: { muted: ["reply"] },
    session: { ...s, csrf: "wrong-token-wrong-token-wrong" } });
  assert.equal(bad.status, 403);
  seedBan(w.db, w.id.alice);
  assert.equal((await mute(w, "alice", ["reply"])).status, 403);
  const env = makeEnv({ ...makeLimiters(false).bindings });
  const zed = await seedUser(env.__sqlite, { username: "zed" });
  const limited = await call(env, PREFS, { method: "PUT", body: { muted: ["reply"] }, session: forgeSession(env.__sqlite, zed) });
  assert.equal(limited.status, 429);
  assert.equal(count(w.db, "notification_prefs"), 0);
  assert.equal(count(env.__sqlite, "notification_prefs"), 0);
  assert.equal((await call(w.env, PREFS, { method: "DELETE", session: w.session("bob") })).status, 405);
});

test("PUT validation: unknown kinds, safety notices and bad shapes are 400; valid lists dedupe into allowlist order", async () => {
  const w = await world();
  const bads = [["nope"], ["reply", "nope"], ["appeal"], ["REPLY"], [" reply"], [1], [null], "reply", null, {},
    Array(NOTIFICATION_KINDS.length * 4 + 1).fill("reply")];
  for (const bad of bads) {
    const res = await mute(w, "alice", bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
  assert.equal((await call(w.env, PREFS, { method: "PUT", body: {}, session: w.session("alice") })).status, 400);
  assert.equal(count(w.db, "notification_prefs"), 0);
  const ok = await mute(w, "alice", ["mention", "reply", "mention"]);
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).muted, ["reply", "mention"]);
  assert.equal(w.db.prepare("SELECT muted FROM notification_prefs WHERE user_id = ?").get(w.id.alice).muted, "reply,mention");
  const back = await (await call(w.env, PREFS, { session: w.session("alice") })).json();
  assert.deepEqual(back.muted, ["reply", "mention"]);
  assert.deepEqual((await (await mute(w, "alice", [])).json()).muted, []);
  assert.equal(count(w.db, "notification_prefs"), 1, "an upsert, not a second row");
  // Own row only: bob's read never shows alice's choice.
  await mute(w, "alice", ["reply"]);
  assert.deepEqual((await (await call(w.env, PREFS, { session: w.session("bob") })).json()).muted, []);
});

// ---- enforcement per kind ----------------------------------------------------

test("reply: a muted post author gets no reply row; unmuting restores future rows", async () => {
  const w = await world();
  const root = seedPost(w.db, { authorId: w.id.alice, body: "root" });
  await mute(w, "alice", ["reply"]);
  const r1 = await call(w.env, "/api/posts/" + root + "/replies", { method: "POST", body: { body: "first" }, session: w.session("bob") });
  assert.equal(r1.status, 201);
  assert.equal(rowsFor(w, w.id.alice), 0);
  await mute(w, "alice", ["mention"]);
  await call(w.env, "/api/posts/" + root + "/replies", { method: "POST", body: { body: "second" }, session: w.session("bob") });
  assert.equal(rowsFor(w, w.id.alice), 1, "reply rows flow again once reply is unmuted");
});

test("subscription: a muted subscriber is skipped, an unmuted one still notified", async () => {
  const w = await world();
  const root = seedPost(w.db, { authorId: w.id.alice, body: "root" });
  for (const name of ["carol", "dave"]) {
    const sub = await call(w.env, "/api/posts/" + root + "/subscribe", { method: "POST", session: w.session(name) });
    assert.ok(sub.status < 300, String(sub.status));
  }
  await mute(w, "carol", ["subscription"]);
  await call(w.env, "/api/posts/" + root + "/replies", { method: "POST", body: { body: "news" }, session: w.session("bob") });
  assert.equal(rowsFor(w, w.id.carol), 0);
  assert.equal(rowsFor(w, w.id.dave), 1);
  assert.equal(rowsFor(w, w.id.alice), 1, "the author's reply row is a different kind");
});

test("mention: muted in posts and replies; the chat mention is its own kind", async () => {
  const w = await world();
  await mute(w, "carol", ["mention"]);
  await mute(w, "dave", ["chat_mention"]);
  const thread = await call(w.env, "/api/posts", { method: "POST", body: { body: "hi @carol and @dave", board: "general" }, session: w.session("bob") });
  assert.equal(thread.status, 201);
  assert.equal(rowsFor(w, w.id.carol), 0);
  assert.equal(rowsFor(w, w.id.dave), 1, "a post mention still reaches a chat-only mute");
  const chat = await call(w.env, "/api/chat", { method: "POST", body: { body: "yo @carol @dave" }, session: w.session("bob") });
  assert.equal(chat.status, 201);
  assert.equal(rowsFor(w, w.id.carol), 1, "chat mention is not the post mention kind");
  assert.equal(rowsFor(w, w.id.dave), 1, "chat mention muted");
});

test("follow_thread: muted followers drop inside the fan-out and do not use up the cap", async () => {
  const w = await world();
  for (const name of ["bob", "carol"]) {
    w.db.prepare("INSERT INTO user_follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)").run(w.id[name], w.id.alice, now());
  }
  await mute(w, "bob", ["follow_thread"]);
  const res = await call(w.env, "/api/posts", { method: "POST", body: { body: "new thread", board: "general" }, session: w.session("alice") });
  assert.equal(res.status, 201);
  assert.equal(count(w.db, "notifications WHERE label = ? AND user_id = ?", followThreadLabel("alice"), w.id.bob), 0);
  assert.equal(count(w.db, "notifications WHERE label = ? AND user_id = ?", followThreadLabel("alice"), w.id.carol), 1);
  assert.match(read("api/follows.mjs"), /ELIGIBLE_FOLLOWERS_SQL =[\s\S]{0,600}mutedKindSql\("f\.follower_id", "follow_thread"\)/);
});

test("invite_joined: a muted inviter gets no join ping; the invite itself still records", async () => {
  const w = await world();
  await mute(w, "alice", ["invite_joined"]);
  const newbie = await seedUser(w.db, { username: "newbie" });
  const res = await call(w.env, "/api/me/invite", { method: "POST", body: { ref: "alice" }, session: forgeSession(w.db, newbie) });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).inviter, "alice");
  assert.equal(count(w.db, "invites WHERE inviter_id = ?", w.id.alice), 1);
  assert.equal(rowsFor(w, w.id.alice), 0);
});

test("safety notices: an appeal outcome reaches a member who muted every kind", async () => {
  const w = await world();
  await mute(w, "alice", [...NOTIFICATION_KINDS]);
  w.db.prepare("INSERT INTO appeals (user_id, kind, body, created_at) VALUES (?, 'ban', 'please', ?)").run(w.id.alice, now());
  const appealId = w.db.prepare("SELECT id FROM appeals WHERE user_id = ?").get(w.id.alice).id;
  const res = await call(w.env, "/api/admin/appeals/" + appealId + "/deny", { method: "POST", session: w.session("boss") });
  assert.equal(res.status, 200);
  assert.equal(rowsFor(w, w.id.alice), 1);
});

test("binds stay fixed and under D1_MAX_BOUND_PARAMS; no per-recipient prefs read", async () => {
  const w = await world();
  const root = seedPost(w.db, { authorId: w.id.alice, body: "root" });
  for (const name of ["carol", "dave"]) await call(w.env, "/api/posts/" + root + "/subscribe", { method: "POST", session: w.session(name) });
  await mute(w, "carol", ["subscription"]);
  const realPrepare = w.env.FORUM_DB.prepare.bind(w.env.FORUM_DB);
  let maxBinds = 0;
  const prefsReads = [];
  w.env.FORUM_DB.prepare = (sql) => {
    const statement = realPrepare(sql);
    if (/notification_prefs/.test(sql) && !/^\s*INSERT INTO notifications/i.test(sql)) prefsReads.push(sql);
    const realBind = statement.bind.bind(statement);
    statement.bind = (...values) => { maxBinds = Math.max(maxBinds, values.length); return realBind(...values); };
    return statement;
  };
  const res = await call(w.env, "/api/posts/" + root + "/replies", { method: "POST", body: { body: "hi @bob" }, session: w.session("dave") });
  assert.equal(res.status, 201);
  assert.ok(maxBinds < D1_MAX_BOUND_PARAMS, "max binds " + maxBinds);
  assert.deepEqual(prefsReads, [], "mutes are enforced inside the INSERT…SELECT, never read per recipient");
  assert.equal(rowsFor(w, w.id.carol), 0);
  assert.equal(rowsFor(w, w.id.bob), 1);
});
