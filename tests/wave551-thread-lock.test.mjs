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

// v5.51.0 staff thread lock (migration 0075): PUT/DELETE/GET
// /api/admin/threads/:id/lock. Auth (anon 401, member 403, staff 200), CSRF,
// the write limiter, roots only, reason validation (≤ 200, one line, no
// bidi/NUL/C0/C1 controls), enforcement on BOTH reply paths (web + MCP) with
// staff exempt and 423 + thread_locked for members, unlock restores replies,
// edits and reactions unaffected, the reason never in a member payload, the
// bind-free POST_SELECT field, one PK lookup and every cascade.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedPost, seedUser, sha256 } from "./helpers/seed.mjs";
import { POST_SELECT } from "../api/core/shapers.mjs";
import { ERROR_CODES } from "../api/core/error-codes.mjs";
import { THREAD_LOCK_CHECK_SQL, THREAD_LOCK_REASON_MAX, THREAD_LOCK_STATUS } from "../api/thread-locks.mjs";

const AGENT_TOKEN = "w551-agent-token-0123456789abcdefghijklmn";
const STAFF_AGENT_TOKEN = "w551-staff-agent-token-0123456789abcdefgh";
const REASON_NEEDLE = "LOCKREASONTXT";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

async function world(overrides = {}) {
  const env = makeEnv({
    AGENT_TOKENS: JSON.stringify({ [sha256(AGENT_TOKEN)]: "bob", [sha256(STAFF_AGENT_TOKEN)]: "deputy" }),
    ...overrides,
  });
  const db = env.__sqlite;
  const id = {
    boss: await seedUser(db, { username: "boss", role: "admin" }),
    deputy: await seedUser(db, { username: "deputy", role: "moderator" }),
    alice: await seedUser(db, { username: "alice" }),
    bob: await seedUser(db, { username: "bob" }),
  };
  const root = seedPost(db, { authorId: id.alice, body: "lockable thread root" });
  const other = seedPost(db, { authorId: id.alice, body: "other thread root" });
  const reply = seedPost(db, { authorId: id.bob, body: "bob earlier reply", parentId: root });
  const session = (name) => forgeSession(db, id[name]);
  return { env, db, id, root, other, reply, session };
}

const count = (db, sql, ...args) => Number(db.prepare("SELECT COUNT(*) AS n FROM " + sql).get(...args).n);
const lockPath = (postId) => "/api/admin/threads/" + postId + "/lock";
const allowUserDeletes = (db) =>
  db.exec("CREATE TABLE IF NOT EXISTS gc_messages (id INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS gc_channels (id INTEGER PRIMARY KEY)");
const lockRow = (w, postId, reason = null, by = w.id.boss) =>
  w.db.prepare("INSERT INTO thread_locks (post_id, locked_by, reason, locked_at) VALUES (?, ?, ?, ?)").run(postId, by, reason, now());
const replyPost = (env, postId, body, session) =>
  call(env, "/api/posts/" + postId + "/replies", { method: "POST", body: { body }, session });

async function mcpReply(env, token, postId, body) {
  const res = await call(env, "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "reply", arguments: { post_id: postId, body } } }),
  });
  return (await res.json()).result;
}

// ---------------------------------------------------------------- auth

test("lock routes: anonymous 401, member 403, staff (both roles) allowed", async () => {
  const w = await world();
  const routes = [["PUT", lockPath(w.root), { reason: "x" }], ["DELETE", lockPath(w.root)], ["GET", lockPath(w.root)]];
  for (const [method, path, body] of routes) {
    const headers = method === "GET" ? {} : { Origin: "https://wempos-forum.com" };
    assert.equal((await call(w.env, path, { method, body, headers })).status, 401, "anon " + method);
    assert.equal((await call(w.env, path, { method, body, session: w.session("bob") })).status, 403, "member " + method);
    assert.equal((await call(w.env, path, { method, body, session: w.session("alice") })).status, 403, "thread author " + method);
  }
  assert.equal(count(w.db, "thread_locks"), 0);
  for (const staff of ["boss", "deputy"]) {
    const s = w.session(staff);
    assert.equal((await call(w.env, lockPath(w.root), { method: "PUT", body: {}, session: s })).status, 200, staff + " lock");
    assert.equal((await call(w.env, lockPath(w.root), { session: s })).status, 200, staff + " read");
    assert.equal((await call(w.env, lockPath(w.root), { method: "DELETE", session: s })).status, 200, staff + " unlock");
  }
  assert.equal((await call(w.env, lockPath(w.root), { method: "POST", session: w.session("boss") })).status, 405);
});

test("lock writes demand same-origin + X-CSRF-Token and ride the write limiter", async () => {
  const w = await world();
  const boss = w.session("boss");
  for (const method of ["PUT", "DELETE"]) {
    const body = method === "PUT" ? { reason: "spam" } : undefined;
    const bad = await call(w.env, lockPath(w.root), { method, body, session: { cookie: boss.cookie, csrf: "wrong-token" } });
    assert.equal(bad.status, 403, "bad csrf " + method);
    const crossSite = await call(w.env, lockPath(w.root), { method, body,
      headers: { Cookie: boss.cookie, "X-CSRF-Token": boss.csrf, Origin: "https://evil.example" } });
    assert.equal(crossSite.status, 403, "cross-site " + method);
  }
  assert.equal(count(w.db, "thread_locks"), 0);
  const limited = await world({ ...makeLimiters(false).bindings });
  const lboss = limited.session("boss");
  for (const method of ["PUT", "DELETE"]) {
    assert.equal((await call(limited.env, lockPath(limited.root), { method, body: {}, session: lboss })).status, 429, "limited " + method);
  }
  assert.equal(count(limited.db, "thread_locks"), 0);
});

// ---------------------------------------------------------------- validation

test("roots only, 404 for a missing thread, 409 unlocking an unlocked thread, re-lock is an upsert", async () => {
  const w = await world();
  const boss = w.session("boss");
  assert.equal((await call(w.env, lockPath(w.reply), { method: "PUT", body: {}, session: boss })).status, 400, "roots only");
  assert.equal((await call(w.env, lockPath(999999), { method: "PUT", body: {}, session: boss })).status, 404);
  assert.equal((await call(w.env, lockPath(999999), { session: boss })).status, 404);
  assert.equal((await call(w.env, lockPath(w.root), { method: "DELETE", session: boss })).status, 409);
  assert.equal(count(w.db, "thread_locks"), 0);
  assert.equal((await call(w.env, lockPath(w.root), { method: "PUT", body: { reason: "first" }, session: boss })).status, 200);
  const again = await call(w.env, lockPath(w.root), { method: "PUT", body: { reason: "second" }, session: w.session("deputy") });
  assert.equal(again.status, 200);
  assert.equal(count(w.db, "thread_locks"), 1, "one row per thread");
  const row = w.db.prepare("SELECT reason, locked_by FROM thread_locks WHERE post_id = ?").get(w.root);
  assert.equal(row.reason, "second");
  assert.equal(Number(row.locked_by), w.id.deputy);
});

test("reason: optional, trimmed, ≤ 200 code points, one line, no bidi/NUL/C0/C1 controls", async () => {
  const w = await world();
  const boss = w.session("boss");
  assert.equal(THREAD_LOCK_REASON_MAX, 200);
  const refused = [123, true, ["x"], { a: 1 }, "x".repeat(201), "🔒".repeat(201), "a‮b", "a⁦b", "a\u0000b",
    "line\nbreak", "tab\tbed", "c1\u0085x", "sep x", "del\u007Fx"];
  for (const reason of refused) {
    const res = await call(w.env, lockPath(w.root), { method: "PUT", body: { reason }, session: boss });
    assert.equal(res.status, 400, JSON.stringify(reason));
  }
  assert.equal(count(w.db, "thread_locks"), 0, "nothing stored on a refusal");
  const stored = async (body, expected) => {
    assert.equal((await call(w.env, lockPath(w.root), { method: "PUT", body, session: boss })).status, 200, JSON.stringify(body));
    assert.equal(w.db.prepare("SELECT reason FROM thread_locks WHERE post_id = ?").get(w.root).reason, expected);
  };
  await stored({}, null);
  await stored({ reason: null }, null);
  await stored({ reason: "   " }, null);
  await stored({ reason: "  off-topic flame war  " }, "off-topic flame war");
  await stored({ reason: "x".repeat(200) }, "x".repeat(200));
  await stored({ reason: "🔒".repeat(200) }, "🔒".repeat(200));
  await stored({ reason: "mark‎ok" }, "mark‎ok");
});

// ---------------------------------------------------------------- enforcement

test("web reply route: members refused with 423 + thread_locked (direct and level-2), staff allowed, other threads open", async () => {
  const w = await world();
  lockRow(w, w.root, "heated");
  const bob = w.session("bob");
  const before = count(w.db, "posts");
  for (const target of [w.root, w.reply]) {
    const res = await replyPost(w.env, target, "member reply into a locked thread", bob);
    assert.equal(res.status, THREAD_LOCK_STATUS, "target " + target);
    const payload = await res.json();
    assert.equal(payload.code, "thread_locked");
    assert.equal(payload.error, ERROR_CODES.thread_locked);
    assert.ok(!JSON.stringify(payload).includes("heated"), "the refusal never carries the reason");
  }
  assert.equal((await replyPost(w.env, w.root, "author reply", w.session("alice"))).status, THREAD_LOCK_STATUS, "the thread's author too");
  assert.equal(count(w.db, "posts"), before, "nothing written");
  assert.equal((await replyPost(w.env, w.root, "staff note in locked thread", w.session("boss"))).status, 201);
  assert.equal((await replyPost(w.env, w.reply, "deputy level-2 in locked thread", w.session("deputy"))).status, 201);
  assert.equal((await replyPost(w.env, w.other, "other thread stays open", bob)).status, 201);
});

test("MCP reply tool: the same refusal for member agents, staff agents exempt", async () => {
  const w = await world();
  lockRow(w, w.root);
  for (const target of [w.root, w.reply]) {
    const refused = await mcpReply(w.env, AGENT_TOKEN, target, "agent into locked thread");
    assert.equal(refused.isError, true);
    assert.equal(refused.content[0].text, ERROR_CODES.thread_locked);
  }
  assert.equal(count(w.db, "posts WHERE body = 'agent into locked thread'"), 0);
  assert.equal((await mcpReply(w.env, STAFF_AGENT_TOKEN, w.root, "staff agent reply")).isError, false);
  assert.equal((await mcpReply(w.env, AGENT_TOKEN, w.other, "agent elsewhere")).isError, false);
});

test("unlock restores replies on both paths", async () => {
  const w = await world();
  const boss = w.session("boss");
  assert.equal((await call(w.env, lockPath(w.root), { method: "PUT", body: { reason: "cool off" }, session: boss })).status, 200);
  assert.equal((await replyPost(w.env, w.root, "too early", w.session("bob"))).status, THREAD_LOCK_STATUS);
  assert.equal((await call(w.env, lockPath(w.root), { method: "DELETE", session: boss })).status, 200);
  assert.equal(count(w.db, "thread_locks"), 0);
  assert.equal((await replyPost(w.env, w.root, "back again", w.session("bob"))).status, 201);
  assert.equal((await mcpReply(w.env, AGENT_TOKEN, w.root, "agent back again")).isError, false);
});

test("a locked thread still allows editing existing replies, reactions and reading", async () => {
  const w = await world();
  lockRow(w, w.root);
  const bob = w.session("bob");
  const edit = await call(w.env, "/api/posts/" + w.reply, { method: "PATCH", body: { body: "bob edited reply" }, session: bob });
  assert.equal(edit.status, 200);
  assert.equal((await call(w.env, "/api/posts/" + w.root + "/reaction", { method: "PUT", body: { value: "like" }, session: bob })).status, 200);
  assert.equal((await call(w.env, "/api/posts/" + w.reply + "/reaction", { method: "PUT", body: { value: "like" }, session: w.session("alice") })).status, 200);
  assert.equal((await call(w.env, "/api/posts/" + w.root)).status, 200);
  assert.equal((await call(w.env, "/api/posts/" + w.root + "/replies")).status, 200);
});

// ---------------------------------------------------------------- display

test("payloads: `locked` rides the thread, its replies and the feed; reason and locker never leave the desk", async () => {
  const w = await world();
  lockRow(w, w.root, REASON_NEEDLE + " flame war");
  for (const session of [undefined, w.session("bob"), w.session("alice")]) {
    const thread = await (await call(w.env, "/api/posts/" + w.root, { session })).json();
    assert.equal(thread.locked, true);
    assert.equal(thread.replies.find((r) => r.id === w.reply).locked, false, "replies carry their own row's flag");
    const feed = await (await call(w.env, "/api/posts", { session })).json();
    const rows = feed.posts || feed;
    assert.equal(rows.find((p) => p.id === w.root).locked, true);
    assert.equal(rows.find((p) => p.id === w.other).locked, false);
    for (const path of ["/api/posts/" + w.root, "/api/posts", "/api/posts/" + w.root + "/replies",
      "/api/search?q=lockable", "/api/search?q=" + REASON_NEEDLE, "/posts/" + w.root]) {
      const text = await (await call(w.env, path, { session })).text();
      assert.ok(!text.includes(REASON_NEEDLE), path + " leaks the lock reason");
      assert.ok(!/lockedBy|locked_by|lockReason/.test(text), path + " leaks lock metadata");
    }
  }
  const staffView = await (await call(w.env, "/api/posts/" + w.root, { session: w.session("boss") })).json();
  assert.ok(!JSON.stringify(staffView).includes(REASON_NEEDLE), "even staff read the reason only from the desk route");
  const desk = await (await call(w.env, lockPath(w.root), { session: w.session("boss") })).json();
  assert.equal(desk.locked, true);
  assert.equal(desk.reason, REASON_NEEDLE + " flame war");
  assert.equal(desk.lockedBy.username, "boss");
  assert.match(desk.lockedAt, /^\d{4}-\d\d-\d\dT/);
  const open = await (await call(w.env, lockPath(w.other), { session: w.session("boss") })).json();
  assert.deepEqual(open, { locked: false, reason: null, lockedBy: null, lockedAt: null });
});

// ---------------------------------------------------------------- SQL pins

test("enforcement is one primary-key lookup with one bound param; staff skip it", async () => {
  assert.equal((THREAD_LOCK_CHECK_SQL.match(/\?/g) || []).length, 1);
  const w = await world();
  const plan = w.db.prepare("EXPLAIN QUERY PLAN " + THREAD_LOCK_CHECK_SQL).all(w.root).map((row) => row.detail).join(" | ");
  assert.doesNotMatch(plan, /\bSCAN\b/, plan);
  const source = read("api/thread-locks.mjs");
  assert.match(source, /if \(isStaffRole\(user\)\) return;/);
  for (const file of ["api/replies.mjs", "api/mcp.mjs"]) {
    assert.match(read(file), /await assertThreadUnlocked\(db, (session\.user|agent), bumpTargetId\);/, file);
  }
});

test("POST_SELECT gains only a bind-free `locked` subquery; its bind count stays 1; posts-feed.mjs never reads thread_locks", () => {
  assert.equal((POST_SELECT.match(/\?/g) || []).length, 1, "POST_SELECT binds only the viewer (pinned at 1)");
  assert.match(POST_SELECT, /EXISTS \(SELECT 1 FROM thread_locks l WHERE l\.post_id = p\.id\) AS locked/);
  assert.doesNotMatch(POST_SELECT, /thread_locks[^)]*(reason|locked_by)/, "the reason and locker never join POST_SELECT");
  assert.doesNotMatch(read("api/posts-feed.mjs"), /thread_locks/);
});

test("the 423 status and the thread_locked code are pinned", () => {
  assert.equal(THREAD_LOCK_STATUS, 423);
  assert.equal(ERROR_CODES.thread_locked, "This thread is locked. Only staff can reply.");
});

// ---------------------------------------------------------------- cascades

test("cascades: removing the thread or the staff member who locked it removes the lock", async () => {
  const w = await world();
  allowUserDeletes(w.db);
  lockRow(w, w.root, "r1");
  w.db.prepare("DELETE FROM posts WHERE id = ?").run(w.root);
  assert.equal(count(w.db, "thread_locks"), 0, "thread removal");
  lockRow(w, w.other, "r2", w.id.deputy);
  w.db.prepare("DELETE FROM users WHERE id = ?").run(w.id.deputy);
  assert.equal(count(w.db, "thread_locks"), 0, "locker removal");
});

test("cascades: the thread author's own delete route takes the lock with the thread", async () => {
  const w = await world();
  lockRow(w, w.other, "r3");
  const res = await call(w.env, "/api/posts/" + w.other, { method: "DELETE", session: w.session("alice") });
  assert.equal(res.status, 200);
  assert.equal(count(w.db, "thread_locks"), 0);
});

test("migration 0075 is CREATE-only and every reference cascades", () => {
  const sql = read("migrations/0075_thread_locks.sql");
  const code = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(code.replace(/ON DELETE CASCADE/g, ""), /\b(ALTER|DROP|DELETE|UPDATE|INSERT)\b/i);
  const references = code.match(/REFERENCES\s+\w+\(\w+\)[^,\n]*/g) || [];
  assert.equal(references.length, 2);
  for (const ref of references) assert.match(ref, /ON DELETE CASCADE/, ref);
  const creates = code.match(/CREATE\s+(TABLE|INDEX)[^(]*/gi) || [];
  assert.ok(creates.length >= 2);
  for (const statement of creates) assert.match(statement, /IF NOT EXISTS/i, statement);
  assert.match(code, /CHECK \(reason IS NULL OR length\(reason\) BETWEEN 1 AND 200\)/);
});
