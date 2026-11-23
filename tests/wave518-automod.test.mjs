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

// Wave 5.18: AutoMod server side. The accountless /api/automod/* surface
// (bearer AUTOMOD_KEY, constant-time compare, off unless AUTOMOD_ENABLED is
// exactly "true"), the queue's cursor/limit/staff/DM laws, the action caps
// (staff exempt, 24 h ban cap, reversible hides, AutoMod log rows) and the
// member-facing DM report that is the ONLY way a DM reaches the queue.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedPost, seedUser } from "./helpers/seed.mjs";
import { AUTOMOD_MAX_BAN_HOURS, AUTOMOD_QUEUE_MAX } from "../api/automod.mjs";

// Obviously fake key — never a real one.
const FAKE_KEY = "fake-automod-key-for-tests-only-0000";
const bearer = (key = FAKE_KEY) => ({ Authorization: "Bearer " + key });

let env, db, member, other, admin, owner;

const queue = (query = "", key = FAKE_KEY) => call(env, "/api/automod/queue" + query, { headers: bearer(key) });
const act = (body, key = FAKE_KEY) => call(env, "/api/automod/action", {
  method: "POST", body, headers: { ...bearer(key), "Content-Type": "application/json" },
});
const START = "?after=p0.l0.w0.u0.d0";
const logRows = () => db.prepare("SELECT * FROM automod_actions ORDER BY id").all();

function seedThread(a, b) {
  const [ua, ub] = a < b ? [a, b] : [b, a];
  const info = db.prepare("INSERT INTO dm_threads (user_a, user_b, created_at) VALUES (?, ?, ?)").run(ua, ub, now());
  return Number(info.lastInsertRowid);
}
function seedDm(threadId, userId, body) {
  return Number(db.prepare("INSERT INTO dm_messages (thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?)")
    .run(threadId, userId, body, now()).lastInsertRowid);
}

beforeEach(async () => {
  env = makeEnv({ AUTOMOD_KEY: FAKE_KEY, AUTOMOD_ENABLED: "true" });
  db = env.__sqlite;
  member = await seedUser(db, { username: "member1" });
  other = await seedUser(db, { username: "member2" });
  admin = await seedUser(db, { username: "adminy", role: "moderator" });
  owner = await seedUser(db, { username: "ownery", role: "admin" });
});

test("kill switch: key set but AUTOMOD_ENABLED unset or not exactly 'true' answers 404", async () => {
  for (const value of [undefined, "", "false", "TRUE", "1", "yes"]) {
    env.AUTOMOD_ENABLED = value;
    assert.equal((await queue(START)).status, 404, `AUTOMOD_ENABLED=${value}`);
    assert.equal((await act({ type: "post", id: 1, action: "report", reason: "x" })).status, 404);
  }
});

test("no key configured (missing or blank) answers 404 even when enabled", async () => {
  for (const value of [undefined, "", "   "]) {
    env.AUTOMOD_KEY = value;
    assert.equal((await queue(START)).status, 404);
    assert.equal((await call(env, "/api/automod/anything")).status, 404);
  }
});

test("wrong or missing bearer answers 401 and writes nothing", async () => {
  const postId = seedPost(db, { authorId: member, body: "hello" });
  assert.equal((await call(env, "/api/automod/queue" + START)).status, 401);
  assert.equal((await queue(START, "wrong-key")).status, 401);
  assert.equal((await queue(START, FAKE_KEY + "x")).status, 401);
  assert.equal((await call(env, "/api/automod/queue" + START, { headers: { Authorization: FAKE_KEY } })).status, 401);
  assert.equal((await act({ type: "post", id: postId, action: "hide", reason: "x" }, "nope")).status, 401);
  assert.equal(db.prepare("SELECT visibility FROM posts WHERE id = ?").get(postId).visibility, "public");
  assert.equal(logRows().length, 0);
});

test("a session cookie is not a credential on the AutoMod surface", async () => {
  const session = forgeSession(db, owner);
  assert.equal((await call(env, "/api/automod/queue" + START, { session })).status, 401);
});

test("right key: queue returns posts, replies, lobby, wall and profile items with no-store", async () => {
  const root = seedPost(db, { authorId: member, body: "root body" });
  seedPost(db, { authorId: other, body: "reply body", parentId: root });
  db.prepare("INSERT INTO chat_messages (user_id, body, created_at) VALUES (?, ?, ?)").run(member, "lobby hi", now());
  db.prepare("INSERT INTO wall_posts (owner_id, author_id, body, created_at) VALUES (?, ?, ?, ?)").run(member, other, "wall hi", now());
  const session = forgeSession(db, member);
  const patched = await call(env, "/api/me", { method: "PATCH", body: { bio: "my new bio" }, session });
  assert.equal(patched.status, 200);
  const res = await queue(START);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const data = await res.json();
  const types = data.items.map((item) => item.type).sort();
  assert.deepEqual(types, ["lobby", "post", "profile", "reply", "wall"]);
  const profile = data.items.find((item) => item.type === "profile");
  assert.match(profile.body, /my new bio/);
  assert.equal(profile.author.id, member);
  const post = data.items.find((item) => item.type === "post");
  assert.equal(post.body, "root body");
  assert.equal(post.author.username, "member1");
  assert.equal(post.author.role, "member");
  assert.equal(typeof post.createdAt, "string");
  assert.match(data.cursor, /^p\d+\.l\d+\.w\d+\.u\d+\.d\d+$/);
  // Polling again from the returned cursor yields nothing new.
  const again = await (await queue("?after=" + data.cursor)).json();
  assert.equal(again.items.length, 0);
  assert.equal(again.cursor, data.cursor);
});

test("profile edits are not recorded while AutoMod is switched off", async () => {
  env.AUTOMOD_ENABLED = "false";
  const session = forgeSession(db, member);
  assert.equal((await call(env, "/api/me", { method: "PATCH", body: { bio: "quiet" }, session })).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automod_profile_edits").get().n, 0);
});

test("no cursor starts at the current tail: nothing old is returned", async () => {
  seedPost(db, { authorId: member, body: "old" });
  const data = await (await queue()).json();
  assert.equal(data.items.length, 0);
  const newer = seedPost(db, { authorId: member, body: "new" });
  const next = await (await queue("?after=" + data.cursor)).json();
  assert.deepEqual(next.items.map((item) => item.id), [newer]);
});

test("queue cursor pages forward with limit and never repeats; limit is capped", async () => {
  const ids = [];
  for (let i = 0; i < 7; i += 1) ids.push(seedPost(db, { authorId: member, body: "post " + i }));
  const seen = [];
  let cursor = "p0.l0.w0.u0.d0";
  for (let page = 0; page < 5; page += 1) {
    const data = await (await queue(`?after=${cursor}&limit=3`)).json();
    assert.ok(data.items.length <= 3);
    seen.push(...data.items.map((item) => item.id));
    cursor = data.cursor;
    if (!data.items.length) break;
  }
  assert.deepEqual(seen, ids);
  assert.equal(AUTOMOD_QUEUE_MAX, 50);
  for (let i = 0; i < 60; i += 1) seedPost(db, { authorId: member, body: "bulk " + i });
  const big = await (await queue(`?after=${cursor}&limit=500`)).json();
  assert.equal(big.items.length, 50);
  for (const bad of ["?after=garbage", "?after=p1.l1", "?after=p0.l0.w0.u0.d0&limit=0", "?after=p0.l0.w0.u0.d0&limit=abc"]) {
    assert.equal((await queue(bad)).status, 400, bad);
  }
});

test("queue statements bind fewer than 100 params", async () => {
  const real = env.FORUM_DB;
  let maxBinds = 0;
  env.FORUM_DB = Object.create(real);
  env.FORUM_DB.prepare = (sql) => {
    const statement = real.prepare(sql);
    const bind = statement.bind.bind(statement);
    statement.bind = (...values) => { maxBinds = Math.max(maxBinds, values.length); return bind(...values); };
    return statement;
  };
  const thread = seedThread(member, other);
  seedDm(thread, member, "hey");
  for (let i = 0; i < 60; i += 1) {
    db.prepare("INSERT INTO dm_reports (thread_id, reporter_id, reason, status, created_at) VALUES (?, ?, ?, 'resolved', ?)")
      .run(thread, member, "r" + i, now());
  }
  assert.equal((await queue(START + "&limit=50")).status, 200);
  assert.ok(maxBinds > 0 && maxBinds < 100, "max binds " + maxBinds);
});

test("staff-authored items never appear in the queue", async () => {
  seedPost(db, { authorId: admin, body: "admin post" });
  seedPost(db, { authorId: owner, body: "owner post" });
  db.prepare("INSERT INTO chat_messages (user_id, body, created_at) VALUES (?, ?, ?)").run(admin, "admin lobby", now());
  db.prepare("INSERT INTO wall_posts (owner_id, author_id, body, created_at) VALUES (?, ?, ?, ?)").run(member, owner, "owner wall", now());
  db.prepare("INSERT INTO automod_profile_edits (user_id, created_at) VALUES (?, ?)").run(admin, now());
  const memberPost = seedPost(db, { authorId: member, body: "member post" });
  const data = await (await queue(START)).json();
  assert.deepEqual(data.items.map((item) => [item.type, item.id]), [["post", memberPost]]);
});

test("unreported DMs never appear; a reported conversation does", async () => {
  const thread = seedThread(member, other);
  seedDm(thread, member, "secret unreported words");
  seedDm(thread, other, "rude message");
  const before = await (await queue(START)).json();
  assert.equal(before.items.length, 0);
  assert.ok(!JSON.stringify(before).includes("secret unreported"));
  const session = forgeSession(db, member);
  const reported = await call(env, `/api/dm/threads/${thread}/reports`, {
    method: "POST", body: { reason: "they were rude" }, session,
  });
  assert.equal(reported.status, 201);
  const after = await (await queue(START)).json();
  assert.equal(after.items.length, 1);
  const item = after.items[0];
  assert.equal(item.type, "dm");
  assert.equal(item.threadId, thread);
  assert.equal(item.reason, "they were rude");
  assert.deepEqual(item.messages.map((m) => m.body), ["secret unreported words", "rude message"]);
});

test("DM report: participants only, no duplicate open report, needs CSRF", async () => {
  const thread = seedThread(member, other);
  const outsider = await seedUser(db, { username: "outsider" });
  const outsiderSession = forgeSession(db, outsider);
  assert.equal((await call(env, `/api/dm/threads/${thread}/reports`, {
    method: "POST", body: { reason: "x" }, session: outsiderSession,
  })).status, 403);
  const session = forgeSession(db, other);
  const noCsrf = await call(env, `/api/dm/threads/${thread}/reports`, {
    method: "POST", body: { reason: "x" }, headers: { Cookie: session.cookie, Origin: "https://wempos-forum.com" },
  });
  assert.equal(noCsrf.status, 403);
  assert.equal((await call(env, `/api/dm/threads/${thread}/reports`, { method: "POST", body: { reason: "x" }, session })).status, 201);
  assert.equal((await call(env, `/api/dm/threads/${thread}/reports`, { method: "POST", body: { reason: "x" }, session })).status, 409);
  assert.equal((await call(env, `/api/dm/threads/${thread}/reports`, { method: "POST", body: { reason: "" }, session })).status, 400);
});

test("AutoMod cannot act on an unreported DM message", async () => {
  const thread = seedThread(member, other);
  const message = seedDm(thread, other, "hi");
  assert.equal((await act({ type: "dm", id: message, action: "report", reason: "x" })).status, 404);
  assert.equal((await act({ type: "dm", id: message, action: "ban", reason: "x", ban_hours: 1 })).status, 404);
  db.prepare("INSERT INTO dm_reports (thread_id, reporter_id, reason, created_at) VALUES (?, ?, ?, ?)").run(thread, member, "r", now());
  assert.equal((await act({ type: "dm", id: message, action: "report", reason: "x" })).status, 200);
});

test("staff targets are refused with 403 for every action", async () => {
  const adminPost = seedPost(db, { authorId: admin, body: "a" });
  const ownerPost = seedPost(db, { authorId: owner, body: "o" });
  for (const id of [adminPost, ownerPost]) {
    for (const action of ["hide", "ban", "report"]) {
      const res = await act({ type: "post", id, action, reason: "test", ban_hours: 1 });
      assert.equal(res.status, 403, `${action} ${id}`);
    }
  }
  assert.equal((await act({ type: "profile", id: owner, action: "ban", reason: "x", ban_hours: 1 })).status, 403);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bans").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM posts WHERE visibility = 'hidden'").get().n, 0);
  assert.equal(logRows().length, 0);
});

test("hide: hides via the moderation path, logs AutoMod, idempotent, reversed by the normal mod unhide", async () => {
  const postId = seedPost(db, { authorId: member, body: "spam spam" });
  const res = await act({ type: "post", id: postId, action: "hide", reason: "spam link" });
  assert.equal(res.status, 200);
  assert.equal(db.prepare("SELECT visibility FROM posts WHERE id = ?").get(postId).visibility, "hidden");
  const rows = logRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor, "AutoMod");
  assert.equal(rows[0].action, "hide");
  assert.equal(rows[0].target_type, "post");
  assert.equal(rows[0].target_id, postId);
  assert.equal(rows[0].target_user_id, member);
  assert.equal(rows[0].reason, "spam link");
  const repeat = await act({ type: "post", id: postId, action: "hide", reason: "spam link" });
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).already, true);
  assert.equal(logRows().length, 1);
  // The normal mod unhide (desk Restore) reverses it.
  const session = forgeSession(db, admin);
  const restore = await call(env, "/api/admin/posts/unhide", { method: "POST", body: { ids: [postId] }, session });
  assert.equal(restore.status, 200);
  assert.equal(db.prepare("SELECT visibility FROM posts WHERE id = ?").get(postId).visibility, "public");
  // Staff see it labeled on the hidden desk while hidden.
  await act({ type: "post", id: postId, action: "hide", reason: "again" });
  const hidden = await (await call(env, "/api/admin/hidden", { session })).json();
  assert.equal(hidden.hidden.find((row) => row.id === postId).autoModReason, "again");
});

test("hide is refused for types without a hide path", async () => {
  const chat = Number(db.prepare("INSERT INTO chat_messages (user_id, body, created_at) VALUES (?, ?, ?)").run(member, "x", now()).lastInsertRowid);
  assert.equal((await act({ type: "lobby", id: chat, action: "hide", reason: "x" })).status, 400);
});

test("ban: capped at AUTOMOD_MAX_BAN_HOURS (clamped), appealable, logged, reversible by the normal unban", async () => {
  assert.equal(AUTOMOD_MAX_BAN_HOURS, 24);
  const postId = seedPost(db, { authorId: member, body: "abuse" });
  const res = await act({ type: "post", id: postId, action: "ban", reason: "harassment", ban_hours: 9999 });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.banHours, 24);
  const ban = db.prepare("SELECT * FROM bans WHERE user_id = ?").get(member);
  assert.ok(ban.expires_at <= now() + 24 * 3600 + 5 && ban.expires_at >= now() + 24 * 3600 - 5);
  assert.equal(ban.created_by, null);
  assert.match(ban.reason, /^AutoMod: harassment$/);
  const rows = logRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor, "AutoMod");
  assert.equal(rows[0].action, "ban");
  assert.equal(rows[0].ban_hours, 24);
  assert.equal(rows[0].ban_id, ban.id);
  // Repeat while active: idempotent, no new ban or log row.
  const repeat = await act({ type: "post", id: postId, action: "ban", reason: "harassment", ban_hours: 2 });
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).already, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bans").get().n, 1);
  assert.equal(logRows().length, 1);
  // The normal mod unban reverses it.
  const session = forgeSession(db, admin);
  const unban = await call(env, `/api/admin/users/${member}/bans`, { method: "DELETE", body: { reason: "false positive" }, session });
  assert.equal(unban.status, 200);
});

test("ban hours must be a positive number", async () => {
  const postId = seedPost(db, { authorId: member, body: "x" });
  for (const hours of [undefined, 0, -3, "abc", null]) {
    assert.equal((await act({ type: "post", id: postId, action: "ban", reason: "x", ban_hours: hours })).status, 400, String(hours));
  }
});

test("AutoMod bans flow into the existing appeals flow", async () => {
  const password = "correct horse battery staple";
  const target = await seedUser(db, { username: "appealer", password });
  const postId = seedPost(db, { authorId: target, body: "x" });
  assert.equal((await act({ type: "post", id: postId, action: "ban", reason: "x", ban_hours: 3 })).status, 200);
  const appeal = await call(env, "/api/appeals", {
    method: "POST", body: { username: "appealer", password, body: "please review" },
    headers: { Origin: "https://wempos-forum.com" },
  });
  assert.equal(appeal.status, 201);
});

test("report: logs an AutoMod report row, idempotent, visible on the staff AutoMod log", async () => {
  const chat = Number(db.prepare("INSERT INTO chat_messages (user_id, body, created_at) VALUES (?, ?, ?)").run(member, "x", now()).lastInsertRowid);
  assert.equal((await act({ type: "lobby", id: chat, action: "report", reason: "borderline" })).status, 200);
  const repeat = await act({ type: "lobby", id: chat, action: "report", reason: "borderline" });
  assert.equal((await repeat.json()).already, true);
  assert.equal(logRows().length, 1);
  const session = forgeSession(db, admin);
  const log = await (await call(env, "/api/admin/automod", { session })).json();
  assert.equal(log.actions.length, 1);
  assert.equal(log.actions[0].actor, "AutoMod");
  assert.equal(log.actions[0].action, "report");
  assert.equal(log.actions[0].reason, "borderline");
  assert.equal(log.actions[0].target.username, "member1");
  const memberSession = forgeSession(db, member);
  assert.equal((await call(env, "/api/admin/automod", { session: memberSession })).status, 403);
});

test("action input validation and rate limit", async () => {
  const postId = seedPost(db, { authorId: member, body: "x" });
  assert.equal((await act({ type: "nope", id: postId, action: "hide", reason: "x" })).status, 400);
  assert.equal((await act({ type: "post", id: postId, action: "delete", reason: "x" })).status, 400);
  assert.equal((await act({ type: "post", id: "1; DROP", action: "hide", reason: "x" })).status, 400);
  assert.equal((await act({ type: "post", id: postId, action: "hide", reason: "" })).status, 400);
  assert.equal((await act({ type: "post", id: 999999, action: "hide", reason: "x" })).status, 404);
  env.WRITE_RATE_LIMITER = { limit: async () => ({ success: false }) };
  assert.equal((await act({ type: "post", id: postId, action: "report", reason: "x" })).status, 429);
});

test("staff DM report desk lists open reports and resolves them", async () => {
  const thread = seedThread(member, other);
  const session = forgeSession(db, member);
  await call(env, `/api/dm/threads/${thread}/reports`, { method: "POST", body: { reason: "spam" }, session });
  const staff = forgeSession(db, admin);
  const list = await (await call(env, "/api/admin/dm-reports", { session: staff })).json();
  assert.equal(list.dmReports.length, 1);
  assert.equal(list.dmReports[0].reporter, "member1");
  assert.equal(list.dmReports[0].other, "member2");
  const id = list.dmReports[0].id;
  assert.equal((await call(env, `/api/admin/dm-reports/${id}/resolve`, { method: "POST", session: staff })).status, 200);
  assert.equal((await (await call(env, "/api/admin/dm-reports", { session: staff })).json()).dmReports.length, 0);
  assert.equal((await call(env, "/api/admin/dm-reports", { session })).status, 403);
});

// Client pins: the member-facing DM report and the desk's two new sections.
import { readFileSync } from "node:fs";
import { findByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";
import { createAutoModLog, createDmReportQueue } from "../public/js/desk/automod.js";

const read = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");

test("client: 1:1 conversations carry Report conversation; groups do not; textContent only", () => {
  const extras = read("public/js/dm-extras.js");
  assert.match(extras, /export const buildDmReport/);
  assert.match(extras, /\$\{conversationBase\(conversation\)\}\/reports/);
  assert.match(extras, /t\("dm\.reportConversation"\)/);
  assert.ok(!extras.includes("innerHTML"));
  const composer = read("public/js/chat-widget-composer.js");
  assert.match(composer, /\} else \{\n\s+ui\.conversationEl\.append\(buildDmReport\(/);
});

test("client: the desk lists DM reports and the AutoMod log, with Restore on live hides", () => {
  const admin = read("public/js/routes/admin.js");
  // v5.92: DM reports are the DMs part of the merged Reports tab.
  assert.match(admin, /slug: "reports"/);
  const merged = read("public/js/desk/merged-sections.js");
  assert.match(merged, /\{ view: "dms", url: "\/api\/admin\/dm-reports", field: "dmReports"/);
  assert.match(merged, /createDmReportQueue\(items, document\)/);
  assert.match(admin, /slug: "automod"/);
  assert.match(admin, /"resolve-dm-report": async/);
  const doc = makeFakeDocument();
  const log = createAutoModLog([
    { id: 2, action: "hide", type: "post", targetId: 7, target: { id: 3, username: "m" }, reason: "spam", stillHidden: true, createdAt: new Date().toISOString() },
    { id: 1, action: "ban", type: "post", targetId: 8, target: { id: 3, username: "m" }, reason: "abuse", banHours: 24, stillHidden: false, createdAt: new Date().toISOString() },
  ], doc);
  const restore = findByClass(log, "button");
  assert.equal(restore.dataset.action, "post-restore");
  assert.equal(restore.dataset.postId, "7");
  const queue = createDmReportQueue([{ id: 5, reporter: "a", other: "b", reason: "<b>x</b>" }], doc);
  assert.equal(findByClass(queue, "report-queue-reason").textContent, "<b>x</b>");
  assert.equal(findByClass(queue, "button").dataset.action, "resolve-dm-report");
  assert.equal(findByClass(createAutoModLog([], doc), "empty-state").className, "empty-state");
});
