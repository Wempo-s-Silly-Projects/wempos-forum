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

// v5.43.0 staff tools (migration 0069): staff notes on members, report
// claiming, per-thread slow mode. Auth (anon 401, member 403, staff 200),
// CSRF, validation, the claim race, the slow-mode boundary on every reply
// path (web + MCP), staff exemption, resolve-clears-claim and every cascade.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedPost, seedUser, sha256 } from "./helpers/seed.mjs";
import { D1_MAX_BOUND_PARAMS } from "../constants.mjs";
import { MEMBER_NOTE_MAX, MEMBER_NOTES_LIMIT, SLOW_MODE_CHOICES } from "../api/staff-tools.mjs";
import { ERROR_CODES } from "../api/core/error-codes.mjs";

const AGENT_TOKEN = "w543-agent-token-0123456789abcdefghijklmn";
const STAFF_AGENT_TOKEN = "w543-staff-agent-token-0123456789abcdefgh";

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
  const root = seedPost(db, { authorId: id.alice, body: "slow thread root" });
  const other = seedPost(db, { authorId: id.alice, body: "other thread root" });
  const report = Number(db.prepare(
    "INSERT INTO reports (post_id, reporter_id, reason, status, created_at) VALUES (?, ?, 'spam', 'open', ?)",
  ).run(root, id.bob, now()).lastInsertRowid);
  const session = (name) => forgeSession(db, id[name]);
  return { env, db, id, root, other, report, session };
}

const count = (db, sql, ...args) => Number(db.prepare("SELECT COUNT(*) AS n FROM " + sql).get(...args).n);
const notesPath = (memberId) => "/api/admin/members/" + memberId + "/notes";
const claimPath = (reportId) => "/api/admin/reports/" + reportId + "/claim";
const slowPath = (postId) => "/api/admin/threads/" + postId + "/slowmode";
const removeRows = (db, sql, ...args) => db.prepare("DELETE FROM " + sql).run(...args);
// The users row removal cascades into fleet_boosts, which still references the
// retired GooberCord tables; create stand-ins so the cascade can run here.
const allowUserDeletes = (db) =>
  db.exec("CREATE TABLE IF NOT EXISTS gc_messages (id INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS gc_channels (id INTEGER PRIMARY KEY)");

async function withClock(seconds, work) {
  const real = Date.now;
  Date.now = () => seconds * 1000;
  try {
    return await work();
  } finally {
    Date.now = real;
  }
}

function insertReply(db, { authorId, parentId, createdAt, body = "earlier reply" }) {
  return Number(db.prepare(
    "INSERT INTO posts (author_id, parent_id, body, visibility, created_at, last_activity_at, board) VALUES (?, ?, ?, 'public', ?, ?, 'general')",
  ).run(authorId, parentId, body, createdAt, createdAt).lastInsertRowid);
}

async function mcpReply(env, token, postId, body) {
  const res = await call(env, "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "reply", arguments: { post_id: postId, body } } }),
  });
  return (await res.json()).result;
}

const replyPost = (env, postId, body, session) =>
  call(env, "/api/posts/" + postId + "/replies", { method: "POST", body: { body }, session });

// ---------------------------------------------------------------- auth matrix

test("every staff-tools route: anonymous 401, member 403, staff allowed", async () => {
  const w = await world();
  const routes = [
    ["GET", notesPath(w.id.alice)],
    ["POST", notesPath(w.id.alice), { body: "careful with this one" }],
    ["DELETE", notesPath(w.id.alice) + "/1"],
    ["POST", claimPath(w.report)],
    ["DELETE", claimPath(w.report)],
    ["PUT", slowPath(w.root), { seconds: 60 }],
    ["DELETE", slowPath(w.root)],
  ];
  for (const [method, path, body] of routes) {
    const headers = method === "GET" ? {} : { Origin: "https://wempos-forum.com" };
    assert.equal((await call(w.env, path, { method, body, headers })).status, 401, "anon " + method + " " + path);
    assert.equal((await call(w.env, path, { method, body, session: w.session("bob") })).status, 403, "member " + method + " " + path);
  }
  const deputy = w.session("deputy");
  assert.equal((await call(w.env, notesPath(w.id.alice), { session: deputy })).status, 200);
  const added = await call(w.env, notesPath(w.id.alice), { method: "POST", body: { body: "careful" }, session: deputy });
  assert.equal(added.status, 201);
  const noteId = (await added.json()).note.id;
  assert.equal((await call(w.env, notesPath(w.id.alice) + "/" + noteId, { method: "DELETE", session: deputy })).status, 200);
  assert.equal((await call(w.env, claimPath(w.report), { method: "POST", session: deputy })).status, 200);
  assert.equal((await call(w.env, claimPath(w.report), { method: "DELETE", session: deputy })).status, 200);
  assert.equal((await call(w.env, slowPath(w.root), { method: "PUT", body: { seconds: 60 }, session: deputy })).status, 200);
  assert.equal((await call(w.env, slowPath(w.root), { method: "DELETE", session: deputy })).status, 200);
});

test("staff writes demand same-origin + X-CSRF-Token; every write is rate limited", async () => {
  const w = await world();
  const boss = w.session("boss");
  const writes = [
    ["POST", notesPath(w.id.alice), { body: "note" }],
    ["POST", claimPath(w.report)],
    ["PUT", slowPath(w.root), { seconds: 30 }],
  ];
  for (const [method, path, body] of writes) {
    const badToken = await call(w.env, path, { method, body, session: { cookie: boss.cookie, csrf: "wrong-token" } });
    assert.equal(badToken.status, 403, "bad csrf " + path);
    const crossSite = await call(w.env, path, { method, body, session: boss, headers: { Origin: "https://evil.example" } });
    assert.equal(crossSite.status, 403, "cross-site origin " + path);
  }
  assert.equal(count(w.db, "member_notes"), 0);
  assert.equal(count(w.db, "report_claims"), 0);
  assert.equal(count(w.db, "thread_slowmode"), 0);
  const limited = await world({ ...makeLimiters(false).bindings });
  const lboss = limited.session("boss");
  for (const [method, path, body] of [
    ["POST", notesPath(limited.id.alice), { body: "note" }],
    ["DELETE", notesPath(limited.id.alice) + "/1"],
    ["POST", claimPath(limited.report)],
    ["DELETE", claimPath(limited.report)],
    ["PUT", slowPath(limited.root), { seconds: 30 }],
    ["DELETE", slowPath(limited.root)],
  ]) {
    assert.equal((await call(limited.env, path, { method, body, session: lboss })).status, 429, "limited " + method + " " + path);
  }
});

// ---------------------------------------------------------------- staff notes

test("notes: validation allowlist, 404s, newest first, capped at the list limit", async () => {
  const w = await world();
  const boss = w.session("boss");
  for (const bad of [{}, { body: "" }, { body: "   " }, { body: 7 }, { body: ["x"] }, { body: "x".repeat(MEMBER_NOTE_MAX + 1) }]) {
    assert.equal((await call(w.env, notesPath(w.id.alice), { method: "POST", body: bad, session: boss })).status, 400, JSON.stringify(bad).slice(0, 40));
  }
  assert.equal(MEMBER_NOTE_MAX, 500);
  assert.equal((await call(w.env, notesPath(w.id.alice), { method: "POST", body: { body: "x".repeat(MEMBER_NOTE_MAX) }, session: boss })).status, 201);
  assert.equal((await call(w.env, notesPath(999999), { session: boss })).status, 404);
  assert.equal((await call(w.env, notesPath(999999), { method: "POST", body: { body: "hi" }, session: boss })).status, 404);
  assert.equal((await call(w.env, "/api/admin/members/abc/notes", { session: boss })).status, 404);
  removeRows(w.db, "member_notes");
  const at = now();
  for (let i = 0; i < MEMBER_NOTES_LIMIT + 5; i++) {
    w.db.prepare("INSERT INTO member_notes (member_id, author_id, body, created_at) VALUES (?, ?, ?, ?)")
      .run(w.id.alice, w.id.deputy, "note " + i, at - 1000 + i);
  }
  const list = await (await call(w.env, notesPath(w.id.alice), { session: boss })).json();
  assert.equal(MEMBER_NOTES_LIMIT, 50);
  assert.equal(list.notes.length, MEMBER_NOTES_LIMIT);
  assert.ok(MEMBER_NOTES_LIMIT < D1_MAX_BOUND_PARAMS);
  assert.equal(list.notes[0].body, "note " + (MEMBER_NOTES_LIMIT + 4), "newest first");
  assert.deepEqual(list.notes[0].author, { id: w.id.deputy, username: "deputy" });
  assert.match(list.notes[0].createdAt, /^\d{4}-\d{2}-\d{2}T/);
  // Another member's note id is not removable through this member's path.
  const bobNote = Number(w.db.prepare("INSERT INTO member_notes (member_id, author_id, body, created_at) VALUES (?, ?, 'about bob', ?)")
    .run(w.id.bob, w.id.boss, at).lastInsertRowid);
  assert.equal((await call(w.env, notesPath(w.id.alice) + "/" + bobNote, { method: "DELETE", session: boss })).status, 404);
  assert.equal(count(w.db, "member_notes WHERE id = ?", bobNote), 1);
  assert.equal((await call(w.env, notesPath(w.id.bob) + "/" + bobNote, { method: "DELETE", session: w.session("deputy") })).status, 200,
    "any staff member may remove a note");
  assert.equal((await call(w.env, notesPath(w.id.bob) + "/" + bobNote, { method: "DELETE", session: boss })).status, 404);
});

test("notes: the body is stored trimmed and read back verbatim (no markup processing)", async () => {
  const w = await world();
  const boss = w.session("boss");
  const raw = "  <img src=x onerror=alert(1)> repeat offender  ";
  const res = await call(w.env, notesPath(w.id.alice), { method: "POST", body: { body: raw }, session: boss });
  const { note } = await res.json();
  assert.equal(note.body, raw.trim());
  const list = await (await call(w.env, notesPath(w.id.alice), { session: boss })).json();
  assert.equal(list.notes[0].body, raw.trim());
});

// ---------------------------------------------------------------- report claims

test("claim race: concurrent claims by two staff members — exactly one wins, the other gets 409", async () => {
  const w = await world();
  const [a, b] = await Promise.all([
    call(w.env, claimPath(w.report), { method: "POST", session: w.session("boss") }),
    call(w.env, claimPath(w.report), { method: "POST", session: w.session("deputy") }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(count(w.db, "report_claims WHERE report_id = ?", w.report), 1);
  const winner = a.status === 200 ? "boss" : "deputy";
  const loser = winner === "boss" ? "deputy" : "boss";
  assert.equal(Number(w.db.prepare("SELECT staff_id FROM report_claims").get().staff_id), w.id[winner]);
  // The holder claiming again is a no-op success; the other is still refused.
  assert.equal((await call(w.env, claimPath(w.report), { method: "POST", session: w.session(winner) })).status, 200);
  assert.equal((await call(w.env, claimPath(w.report), { method: "POST", session: w.session(loser) })).status, 409);
  assert.equal(count(w.db, "report_claims"), 1);
  // Any staff member can release; a second release has nothing to release.
  assert.equal((await call(w.env, claimPath(w.report), { method: "DELETE", session: w.session(loser) })).status, 200);
  assert.equal(count(w.db, "report_claims"), 0);
  assert.equal((await call(w.env, claimPath(w.report), { method: "DELETE", session: w.session(loser) })).status, 409);
});

test("claim race: eight concurrent claimers on one report — one row, one 200", async () => {
  const w = await world();
  const staff = [];
  for (let i = 0; i < 8; i++) staff.push(forgeSession(w.db, await seedUser(w.db, { username: "mod" + i, role: "moderator" })));
  const statuses = (await Promise.all(staff.map((session) => call(w.env, claimPath(w.report), { method: "POST", session }))))
    .map((res) => res.status);
  assert.equal(statuses.filter((s) => s === 200).length, 1, statuses.join(","));
  assert.equal(statuses.filter((s) => s === 409).length, 7, statuses.join(","));
  assert.equal(count(w.db, "report_claims"), 1);
});

test("claims: only open reports; the desk list shows who holds each claim", async () => {
  const w = await world();
  const boss = w.session("boss");
  assert.equal((await call(w.env, claimPath(999999), { method: "POST", session: boss })).status, 404);
  assert.equal((await call(w.env, "/api/admin/reports/abc/claim", { method: "POST", session: boss })).status, 404);
  let list = await (await call(w.env, "/api/admin/reports", { session: boss })).json();
  assert.equal(list.reports[0].claim, null);
  assert.equal((await call(w.env, claimPath(w.report), { method: "POST", session: w.session("deputy") })).status, 200);
  list = await (await call(w.env, "/api/admin/reports", { session: boss })).json();
  assert.equal(list.reports[0].claim.username, "deputy");
  assert.equal(list.reports[0].claim.staffId, w.id.deputy);
  assert.match(list.reports[0].claim.claimedAt, /^\d{4}-\d{2}-\d{2}T/);
  w.db.prepare("UPDATE reports SET status = 'dismissed' WHERE id = ?").run(w.report);
  removeRows(w.db, "report_claims");
  assert.equal((await call(w.env, claimPath(w.report), { method: "POST", session: boss })).status, 404, "a resolved report cannot be claimed");
});

test("resolving or dismissing a report clears its claim (desk resolve and hide-recent)", async () => {
  for (const action of ["dismiss", "hide_post"]) {
    const w = await world();
    assert.equal((await call(w.env, claimPath(w.report), { method: "POST", session: w.session("deputy") })).status, 200);
    const res = await call(w.env, "/api/admin/reports/" + w.report + "/resolve", { method: "POST", body: { action }, session: w.session("boss") });
    assert.equal(res.status, 200, action);
    assert.equal(count(w.db, "report_claims"), 0, action + " clears the claim");
  }
  const w = await world();
  assert.equal((await call(w.env, claimPath(w.report), { method: "POST", session: w.session("deputy") })).status, 200);
  const res = await call(w.env, "/api/admin/users/" + w.id.alice + "/hide-recent", { method: "POST", body: { count: 5 }, session: w.session("boss") });
  assert.equal(res.status, 200);
  assert.equal(count(w.db, "report_claims"), 0, "hide-recent closes the report and its claim");
});

// ---------------------------------------------------------------- slow mode

test("slow mode: staff set/clear with a validation allowlist, roots only; the thread payload carries it", async () => {
  const w = await world();
  const boss = w.session("boss");
  for (const bad of [{}, { seconds: 45 }, { seconds: "60" }, { seconds: 0 }, { seconds: -30 }, { seconds: 60.5 }, { seconds: null }]) {
    assert.equal((await call(w.env, slowPath(w.root), { method: "PUT", body: bad, session: boss })).status, 400, JSON.stringify(bad));
  }
  const reply = seedPost(w.db, { authorId: w.id.bob, body: "a reply", parentId: w.root });
  assert.equal((await call(w.env, slowPath(reply), { method: "PUT", body: { seconds: 60 }, session: boss })).status, 400, "roots only");
  assert.equal((await call(w.env, slowPath(999999), { method: "PUT", body: { seconds: 60 }, session: boss })).status, 404);
  assert.equal((await call(w.env, slowPath(w.root), { method: "DELETE", session: boss })).status, 409, "nothing to clear");
  for (const seconds of SLOW_MODE_CHOICES) {
    assert.equal((await call(w.env, slowPath(w.root), { method: "PUT", body: { seconds }, session: boss })).status, 200, String(seconds));
  }
  assert.deepEqual([...SLOW_MODE_CHOICES], [30, 60, 300, 900]);
  assert.equal(count(w.db, "thread_slowmode"), 1, "an upsert, not a second row");
  const thread = await (await call(w.env, "/api/posts/" + w.root, { session: w.session("bob") })).json();
  assert.equal(thread.slowModeSeconds, 900);
  const guest = await (await call(w.env, "/api/posts/" + w.root)).json();
  assert.equal(guest.slowModeSeconds, 900);
  assert.ok(!JSON.stringify(guest).includes("set_by") && !("slowModeSetBy" in guest), "who set it never leaves the desk");
  assert.equal((await call(w.env, slowPath(w.root), { method: "DELETE", session: boss })).status, 200);
  assert.equal((await (await call(w.env, "/api/posts/" + w.root)).json()).slowModeSeconds, null);
});

test("slow mode boundary on the web reply route: T-1 refused with 429 + slow_mode, T allowed", async () => {
  const w = await world();
  const T = now();
  w.db.prepare("INSERT INTO thread_slowmode (post_id, seconds, set_by, set_at) VALUES (?, 60, ?, ?)").run(w.root, w.id.boss, T - 600);
  const bob = w.session("bob");
  insertReply(w.db, { authorId: w.id.bob, parentId: w.root, createdAt: T - 59 });
  await withClock(T, async () => {
    const res = await replyPost(w.env, w.root, "too soon", bob);
    assert.equal(res.status, 429);
    const payload = await res.json();
    assert.equal(payload.code, "slow_mode");
    assert.equal(payload.error, ERROR_CODES.slow_mode);
  });
  assert.equal(count(w.db, "posts WHERE body = 'too soon'"), 0);
  w.db.prepare("UPDATE posts SET created_at = ? WHERE author_id = ? AND body = 'earlier reply'").run(T - 60, w.id.bob);
  await withClock(T, async () => {
    assert.equal((await replyPost(w.env, w.root, "on time", bob)).status, 201);
  });
});

test("slow mode covers level-2 replies both ways, only its own thread, and only non-staff", async () => {
  const w = await world();
  const T = now();
  w.db.prepare("INSERT INTO thread_slowmode (post_id, seconds, set_by, set_at) VALUES (?, 300, ?, ?)").run(w.root, w.id.boss, T);
  const level1 = insertReply(w.db, { authorId: w.id.alice, parentId: w.root, createdAt: T - 1000, body: "level one" });
  // bob's previous reply is a level-2 reply; a new direct reply is refused.
  insertReply(w.db, { authorId: w.id.bob, parentId: level1, createdAt: T - 10 });
  const bob = w.session("bob");
  const carol = forgeSession(w.db, await seedUser(w.db, { username: "carol" }));
  const deputy = w.session("deputy");
  await withClock(T, async () => {
    assert.equal((await replyPost(w.env, w.root, "direct", bob)).status, 429);
    assert.equal((await replyPost(w.env, level1, "nested", bob)).status, 429);
    assert.equal((await replyPost(w.env, w.other, "elsewhere", bob)).status, 201, "another thread is untouched");
    assert.equal((await replyPost(w.env, w.root, "first", carol)).status, 201, "no recent reply, no wait");
    insertReply(w.db, { authorId: w.id.deputy, parentId: w.root, createdAt: T - 1 });
    assert.equal((await replyPost(w.env, w.root, "staff", deputy)).status, 201, "staff are exempt");
  });
  removeRows(w.db, "thread_slowmode");
  await withClock(T, async () => {
    assert.equal((await replyPost(w.env, w.root, "now free", bob)).status, 201, "no slow mode, no wait");
  });
});

test("slow mode on the MCP reply tool: the same boundary, staff agents exempt", async () => {
  const w = await world();
  const T = now();
  w.db.prepare("INSERT INTO thread_slowmode (post_id, seconds, set_by, set_at) VALUES (?, 30, ?, ?)").run(w.root, w.id.boss, T);
  insertReply(w.db, { authorId: w.id.bob, parentId: w.root, createdAt: T - 29 });
  await withClock(T, async () => {
    const refused = await mcpReply(w.env, AGENT_TOKEN, w.root, "agent too soon");
    assert.equal(refused.isError, true);
    assert.equal(refused.content[0].text, ERROR_CODES.slow_mode);
  });
  assert.equal(count(w.db, "posts WHERE body = 'agent too soon'"), 0);
  w.db.prepare("UPDATE posts SET created_at = ? WHERE author_id = ? AND body = 'earlier reply'").run(T - 30, w.id.bob);
  await withClock(T, async () => {
    assert.equal((await mcpReply(w.env, AGENT_TOKEN, w.root, "agent on time")).isError, false);
    insertReply(w.db, { authorId: w.id.deputy, parentId: w.root, createdAt: T });
    assert.equal((await mcpReply(w.env, STAFF_AGENT_TOKEN, w.root, "staff agent")).isError, false);
  });
});

test("slow mode lookup: one statement, bound params only, served by indexes (no table scan)", async () => {
  const source = readFileSync(new URL("../api/staff-tools.mjs", import.meta.url), "utf8");
  const { SLOW_MODE_CHECK_SQL } = await import("../api/staff-tools.mjs");
  assert.ok(source.includes("SLOW_MODE_CHECK_SQL"));
  assert.equal((SLOW_MODE_CHECK_SQL.match(/\?/g) || []).length, 3);
  const w = await world();
  const plan = w.db.prepare("EXPLAIN QUERY PLAN " + SLOW_MODE_CHECK_SQL).all(w.root, w.id.bob, now())
    .map((row) => row.detail).join(" | ");
  assert.doesNotMatch(plan, /\bSCAN (p|par|s|posts|thread_slowmode)\b(?! USING)/, plan);
});

// ---------------------------------------------------------------- cascades

test("cascades: removing the noted member or the note's author removes the note", async () => {
  const w = await world();
  allowUserDeletes(w.db);
  const at = now();
  const insert = w.db.prepare("INSERT INTO member_notes (member_id, author_id, body, created_at) VALUES (?, ?, ?, ?)");
  insert.run(w.id.alice, w.id.boss, "about alice", at);
  insert.run(w.id.bob, w.id.deputy, "about bob by deputy", at);
  removeRows(w.db, "users WHERE id = ?", w.id.alice);
  assert.equal(count(w.db, "member_notes WHERE member_id = ?", w.id.alice), 0, "member removal");
  removeRows(w.db, "users WHERE id = ?", w.id.deputy);
  assert.equal(count(w.db, "member_notes"), 0, "author removal");
});

test("cascades: removing the report or the claiming staff member removes the claim", async () => {
  const w = await world();
  allowUserDeletes(w.db);
  const insert = w.db.prepare("INSERT INTO report_claims (report_id, staff_id, claimed_at) VALUES (?, ?, ?)");
  insert.run(w.report, w.id.deputy, now());
  removeRows(w.db, "reports WHERE id = ?", w.report);
  assert.equal(count(w.db, "report_claims"), 0, "report removal");
  const second = Number(w.db.prepare("INSERT INTO reports (post_id, reporter_id, reason, status, created_at) VALUES (?, ?, 'again', 'open', ?)")
    .run(w.other, w.id.bob, now()).lastInsertRowid);
  insert.run(second, w.id.deputy, now());
  removeRows(w.db, "users WHERE id = ?", w.id.deputy);
  assert.equal(count(w.db, "report_claims"), 0, "staff removal");
});

test("cascades: removing the thread or the staff member who set slow mode removes it", async () => {
  const w = await world();
  allowUserDeletes(w.db);
  const insert = w.db.prepare("INSERT INTO thread_slowmode (post_id, seconds, set_by, set_at) VALUES (?, 60, ?, ?)");
  insert.run(w.root, w.id.boss, now());
  removeRows(w.db, "posts WHERE id = ?", w.root);
  assert.equal(count(w.db, "thread_slowmode"), 0, "thread removal");
  insert.run(w.other, w.id.deputy, now());
  removeRows(w.db, "users WHERE id = ?", w.id.deputy);
  assert.equal(count(w.db, "thread_slowmode"), 0, "setter removal");
});

test("cascades: the member's own account wipe takes notes about them and by them", async () => {
  const w = await world();
  allowUserDeletes(w.db);
  w.db.prepare("INSERT INTO member_notes (member_id, author_id, body, created_at) VALUES (?, ?, 'about alice', ?)").run(w.id.alice, w.id.boss, now());
  const res = await call(w.env, "/api/me/delete", { method: "POST", session: w.session("alice") });
  assert.equal(res.status, 200);
  assert.equal(count(w.db, "member_notes"), 0);
});

test("migration 0069 is CREATE-only and every reference cascades", () => {
  const sql = readFileSync(new URL("../migrations/0069_staff_tools.sql", import.meta.url), "utf8");
  const code = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(code, /\b(ALTER|DROP|DELETE|UPDATE|INSERT)\b/i);
  const references = code.match(/REFERENCES\s+\w+\(\w+\)[^,\n]*/g) || [];
  assert.equal(references.length, 6);
  for (const ref of references) assert.match(ref, /ON DELETE CASCADE/, ref);
  const creates = code.match(/CREATE\s+(TABLE|INDEX)[^(]*/gi) || [];
  assert.ok(creates.length >= 3);
  for (const statement of creates) assert.match(statement, /IF NOT EXISTS/i, statement);
});
