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

// v5.38.0 "make it yours" (migration 0066): F1 a pinned thread on your
// profile, F2 a custom status with an expiry, F3 a poll closing time. Every
// write is signed in + CSRF + not banned + rate limited; every read re-checks
// visibility, the ban, the block pair, the expiry and the deadline at read
// time. Time is faked by swapping Date.now (nowSeconds reads it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";
import { normalizeStatusEmoji, statusExpiresAt, STATUS_EXPIRIES } from "../api/user-status.mjs";
import { POLL_DEADLINE_MAX_SECONDS, POLL_DEADLINE_MIN_SECONDS } from "../api/poll-deadlines.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const MIGRATION = "migrations/0066_profile_extras.sql";
const HOUR = 3600;

async function world() {
  const env = makeEnv();
  const db = env.__sqlite;
  const id = {};
  for (const name of ["alice", "bob", "carol"]) id[name] = await seedUser(db, { username: name });
  id.boss = await seedUser(db, { username: "boss", role: "admin" });
  const session = (name) => forgeSession(db, id[name]);
  return { env, db, id, session };
}

const getJson = async (env, path, session) => {
  const res = await call(env, path, session ? { session } : undefined);
  assert.equal(res.status, 200, path);
  return res.json();
};
const profile = (w, name, viewer) => getJson(w.env, "/api/users/" + name, viewer ? w.session(viewer) : undefined);
const pin = (w, session, postId) => call(w.env, "/api/me/profile-pin", { method: "PUT", body: { postId }, session });
const setStatus = (w, session, body) => call(w.env, "/api/me/status", { method: "PUT", body, session });
const count = (db, table) => db.prepare("SELECT COUNT(*) AS n FROM " + table).get().n;

async function withClock(seconds, fn) {
  const real = Date.now;
  Date.now = () => seconds * 1000;
  try {
    return await fn();
  } finally {
    Date.now = real;
  }
}

// ---- migration --------------------------------------------------------------

test("migration 0066 is CREATE-only and every FK cascades", () => {
  const sql = read(MIGRATION).replace(/--.*$/gm, "");
  for (const table of ["profile_pins", "user_status", "poll_deadlines"]) {
    assert.match(sql, new RegExp("CREATE TABLE IF NOT EXISTS " + table));
  }
  assert.doesNotMatch(sql.replace(/ON DELETE CASCADE/g, ""), /\b(DROP|ALTER|INSERT|UPDATE|DELETE|REPLACE)\b/i);
  const references = sql.match(/REFERENCES [^,\n]+/g) || [];
  assert.equal(references.length, 4);
  for (const reference of references) assert.match(reference, /ON DELETE CASCADE/, reference);
  const env = makeEnv();
  for (const table of ["profile_pins", "user_status", "poll_deadlines"]) {
    const fks = env.__sqlite.prepare("PRAGMA foreign_key_list(" + table + ")").all();
    assert.ok(fks.length >= 1, table);
    for (const fk of fks) assert.equal(fk.on_delete, "CASCADE", table + "." + fk.from);
  }
});

// ---- F1 pinned thread -------------------------------------------------------

test("F1 auth: no Origin 403, anon 401, bad CSRF 403, banned 403, rate limit 429; nothing is written", async () => {
  const w = await world();
  const root = seedPost(w.db, { authorId: w.id.alice, body: "PINME" });
  const noOrigin = await call(w.env, "/api/me/profile-pin", { method: "PUT", body: { postId: root } });
  assert.equal(noOrigin.status, 403);
  const anon = await call(w.env, "/api/me/profile-pin", { method: "PUT", body: { postId: root },
    headers: { Origin: "https://wempos-forum.com", "X-CSRF-Token": "x" } });
  assert.equal(anon.status, 401);
  const s = w.session("alice");
  const badCsrf = await call(w.env, "/api/me/profile-pin", { method: "PUT", body: { postId: root },
    session: { ...s, csrf: "wrong-token-wrong-token-wrong" } });
  assert.equal(badCsrf.status, 403);
  seedBan(w.db, w.id.alice);
  assert.equal((await pin(w, s, root)).status, 403);
  assert.equal((await call(w.env, "/api/me/profile-pin", { method: "DELETE", session: s })).status, 403);
  assert.equal(count(w.db, "profile_pins"), 0);
});

test("F1 rate limit: the write tier refuses with 429", async () => {
  const env = makeEnv({ ...makeLimiters(false).bindings });
  const alice = await seedUser(env.__sqlite, { username: "alice" });
  const root = seedPost(env.__sqlite, { authorId: alice, body: "x" });
  const res = await call(env, "/api/me/profile-pin", { method: "PUT", body: { postId: root }, session: forgeSession(env.__sqlite, alice) });
  assert.equal(res.status, 429);
  const status = await call(env, "/api/me/status", { method: "PUT", body: { text: "hi", expiry: "never" }, session: forgeSession(env.__sqlite, alice) });
  assert.equal(status.status, 429);
});

test("F1 validation: only your own public root thread; bad ids 400; others 404; reply/hidden 400", async () => {
  const w = await world();
  const s = w.session("alice");
  const own = seedPost(w.db, { authorId: w.id.alice, body: "mine" });
  const reply = seedPost(w.db, { authorId: w.id.alice, body: "reply", parentId: own });
  const hidden = seedPost(w.db, { authorId: w.id.alice, body: "hidden", visibility: "hidden" });
  const bobs = seedPost(w.db, { authorId: w.id.bob, body: "bobs" });
  for (const bad of ["1", -1, 0, 1.5, null, "abc", 2 ** 60]) {
    assert.equal((await pin(w, s, bad)).status, 400, String(bad));
  }
  assert.equal((await pin(w, s, 999999)).status, 404);
  assert.equal((await pin(w, s, bobs)).status, 404);
  assert.equal((await pin(w, s, reply)).status, 400);
  assert.equal((await pin(w, s, hidden)).status, 400);
  assert.equal(count(w.db, "profile_pins"), 0);
  assert.equal((await pin(w, s, own)).status, 200);
  assert.equal(count(w.db, "profile_pins"), 1);
});

test("F1: the pin shows on the profile; re-pin replaces; DELETE unpins", async () => {
  const w = await world();
  const s = w.session("alice");
  const first = seedPost(w.db, { authorId: w.id.alice, body: "FIRSTPIN" });
  const second = seedPost(w.db, { authorId: w.id.alice, body: "SECONDPIN", board: "showcase" });
  assert.equal((await profile(w, "alice")).pinnedThread, null);
  await pin(w, s, first);
  const p1 = (await profile(w, "alice")).pinnedThread;
  assert.equal(p1.id, first);
  assert.equal(p1.body, "FIRSTPIN");
  assert.equal(p1.board, "general");
  assert.ok(!Number.isNaN(Date.parse(p1.createdAt)));
  await pin(w, s, second);
  assert.equal(count(w.db, "profile_pins"), 1);
  assert.equal((await profile(w, "alice", "bob")).pinnedThread.id, second);
  const res = await call(w.env, "/api/me/profile-pin", { method: "DELETE", session: s });
  assert.equal(res.status, 200);
  assert.equal((await profile(w, "alice")).pinnedThread, null);
});

test("F1 read re-checks: hidden later, author banned, block pair; unban restores with no write", async () => {
  const w = await world();
  const root = seedPost(w.db, { authorId: w.id.alice, body: "PINNEDTXT" });
  await pin(w, w.session("alice"), root);
  w.db.prepare("UPDATE posts SET visibility = 'hidden' WHERE id = ?").run(root);
  for (const viewer of [undefined, "bob", "alice", "boss"]) {
    assert.equal((await profile(w, "alice", viewer)).pinnedThread, null, "hidden: " + viewer);
  }
  w.db.prepare("UPDATE posts SET visibility = 'public' WHERE id = ?").run(root);
  seedBan(w.db, w.id.alice);
  assert.equal((await profile(w, "alice")).pinnedThread, null, "banned author");
  w.db.prepare("UPDATE bans SET revoked_at = ? WHERE user_id = ?").run(now(), w.id.alice);
  assert.equal((await profile(w, "alice")).pinnedThread.id, root, "unban restores");
  // A row pointing at someone else's thread (forged/stale) never shows.
  const bobs = seedPost(w.db, { authorId: w.id.bob, body: "NOTALICE" });
  w.db.prepare("UPDATE profile_pins SET post_id = ? WHERE user_id = ?").run(bobs, w.id.alice);
  assert.equal((await profile(w, "alice")).pinnedThread, null, "not the member's own thread");
  w.db.prepare("UPDATE profile_pins SET post_id = ? WHERE user_id = ?").run(root, w.id.alice);
  w.db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(w.id.alice, w.id.bob, now());
  const blockedSide = await (await call(w.env, "/api/users/alice", { session: w.session("bob") })).text();
  assert.ok(!blockedSide.includes("PINNEDTXT"), "block pair: blocked side");
  assert.equal((await profile(w, "alice", "boss")).pinnedThread.id, root, "staff keep the public pin");
  await pin(w, w.session("bob"), seedPost(w.db, { authorId: w.id.bob, body: "BOBPINTXT" }));
  const reverse = await (await call(w.env, "/api/users/bob", { session: w.session("alice") })).text();
  assert.ok(!reverse.includes("BOBPINTXT"), "block pair: blocker side");
});

test("F1 cascade: deleting the pinned post and deleting the account both succeed", async () => {
  const w = await world();
  w.db.exec("CREATE TABLE IF NOT EXISTS gc_messages (id INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS gc_channels (id INTEGER PRIMARY KEY)");
  const s = w.session("alice");
  const root = seedPost(w.db, { authorId: w.id.alice, body: "doomed" });
  await pin(w, s, root);
  assert.equal((await call(w.env, "/api/posts/" + root, { method: "DELETE", session: s })).status, 200);
  assert.equal(count(w.db, "profile_pins"), 0);
  await pin(w, s, seedPost(w.db, { authorId: w.id.alice, body: "again" }));
  assert.equal((await setStatus(w, s, { text: "bye", expiry: "never" })).status, 200);
  assert.equal((await call(w.env, "/api/me/delete", { method: "POST", session: s })).status, 200);
  assert.equal(count(w.db, "profile_pins"), 0);
  assert.equal(count(w.db, "user_status"), 0);
});

// ---- F2 custom status -------------------------------------------------------

test("F2 auth: no Origin 403, anon 401, banned 403 on PUT and DELETE", async () => {
  const w = await world();
  assert.equal((await call(w.env, "/api/me/status", { method: "PUT", body: { text: "hi", expiry: "never" } })).status, 403);
  const anon = await call(w.env, "/api/me/status", { method: "PUT", body: { text: "hi", expiry: "never" },
    headers: { Origin: "https://wempos-forum.com", "X-CSRF-Token": "x" } });
  assert.equal(anon.status, 401);
  const s = w.session("alice");
  seedBan(w.db, w.id.alice);
  assert.equal((await setStatus(w, s, { text: "hi", expiry: "never" })).status, 403);
  assert.equal((await call(w.env, "/api/me/status", { method: "DELETE", session: s })).status, 403);
  assert.equal(count(w.db, "user_status"), 0);
});

test("F2 validation: text <= 60 after trim, one allowlisted emoji, expiry allowlist, something to show", async () => {
  const w = await world();
  const s = w.session("alice");
  const ok = async (body) => assert.equal((await setStatus(w, s, body)).status, 200, JSON.stringify(body));
  const bad = async (body) => assert.equal((await setStatus(w, s, body)).status, 400, JSON.stringify(body));
  await ok({ text: "  " + "a".repeat(60) + "  ", expiry: "never" });
  assert.equal(w.db.prepare("SELECT text FROM user_status").get().text, "a".repeat(60));
  await bad({ text: "a".repeat(61), expiry: "never" });
  await bad({ text: "line\nbreak", expiry: "never" });
  await bad({ text: 42, expiry: "never" });
  await bad({ text: "", emoji: "", expiry: "never" });
  await bad({ text: "hi", expiry: "forever" });
  await bad({ text: "hi" });
  await bad({ text: "hi", expiry: "today", tzOffset: 9999 });
  await ok({ emoji: "🎮", expiry: "1h" });
  await ok({ text: "hi", emoji: "👍🏽", expiry: "4h" });
  await ok({ text: "hi", emoji: "👩‍💻", expiry: "week" });
  await ok({ text: "hi", emoji: "🇫🇷", expiry: "today", tzOffset: -60 });
  for (const emoji of ["ab", "🎮🎮", "1", "<", "á", 7]) await bad({ text: "hi", emoji, expiry: "never" });
});

test("F2 pure helpers: emoji allowlist and expiry math", () => {
  assert.equal(normalizeStatusEmoji(""), "");
  assert.equal(normalizeStatusEmoji(undefined), "");
  assert.equal(normalizeStatusEmoji("🔥"), "🔥");
  assert.equal(normalizeStatusEmoji(" ☕ "), "☕");
  assert.equal(normalizeStatusEmoji("🔥🔥"), null);
  assert.equal(normalizeStatusEmoji("x"), null);
  assert.deepEqual([...STATUS_EXPIRIES].sort(), ["1h", "4h", "never", "today", "week"]);
  const t0 = 1_800_000_000; // 2027-01-15T08:00:00Z
  assert.equal(statusExpiresAt("never", t0, 0), null);
  assert.equal(statusExpiresAt("1h", t0, 0), t0 + HOUR);
  assert.equal(statusExpiresAt("4h", t0, 0), t0 + 4 * HOUR);
  assert.equal(statusExpiresAt("week", t0, 0), t0 + 7 * 24 * HOUR);
  // today = the next local midnight: UTC midnight for offset 0; UTC+1 (offset -60) ends an hour earlier.
  const utcMidnight = Math.floor(t0 / 86400 + 1) * 86400;
  assert.equal(statusExpiresAt("today", t0, 0), utcMidnight);
  assert.equal(statusExpiresAt("today", t0, -60), utcMidnight - HOUR);
  assert.equal(statusExpiresAt("bogus", t0, 0), undefined);
});

test("F2 content filter: a filtered word is refused (the post filter), never stored", async () => {
  const w = await world();
  w.env.FILTERED_WORDS = "badword"; // the filter source before any desk row exists
  const res = await setStatus(w, w.session("alice"), { text: "such badword wow", expiry: "never" });
  assert.equal(res.status, 400);
  assert.equal(count(w.db, "user_status"), 0);
});

test("F2: shown on the profile; expiry boundary computed at read (fake clock); DELETE clears", async () => {
  const w = await world();
  const s = w.session("alice");
  const t0 = now();
  await withClock(t0, async () => {
    assert.equal((await setStatus(w, s, { text: "STATUSTXT", emoji: "🎮", expiry: "1h" })).status, 200);
  });
  const shown = (await profile(w, "alice", "bob")).status;
  assert.equal(shown.text, "STATUSTXT");
  assert.equal(shown.emoji, "🎮");
  assert.equal(Date.parse(shown.expiresAt) / 1000, t0 + HOUR);
  await withClock(t0 + HOUR - 1, async () => assert.ok((await profile(w, "alice")).status));
  await withClock(t0 + HOUR, async () => assert.equal((await profile(w, "alice")).status, null));
  await setStatus(w, s, { text: "forever", expiry: "never" });
  assert.equal((await profile(w, "alice")).status.expiresAt, null);
  assert.equal((await call(w.env, "/api/me/status", { method: "DELETE", session: s })).status, 200);
  assert.equal((await profile(w, "alice")).status, null);
  assert.equal(count(w.db, "user_status"), 0);
});

test("F2 read re-checks: banned member never shows a status (staff too); block pair hides it; filter masks later words", async () => {
  const w = await world();
  await setStatus(w, w.session("alice"), { text: "STATUSTXT", expiry: "never" });
  w.db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(w.id.bob, w.id.alice, now());
  const blocked = await (await call(w.env, "/api/users/alice", { session: w.session("bob") })).text();
  assert.ok(!blocked.includes("STATUSTXT"));
  seedBan(w.db, w.id.alice);
  for (const viewer of [undefined, "carol", "boss", "alice"]) {
    assert.equal((await profile(w, "alice", viewer)).status, null, "banned: " + viewer);
  }
  w.db.prepare("UPDATE bans SET revoked_at = ? WHERE user_id = ?").run(now(), w.id.alice);
  assert.equal((await profile(w, "alice", "carol")).status.text, "STATUSTXT");
  w.env.FILTERED_WORDS = "statustxt"; // a word added after the save
  assert.ok(!(await profile(w, "alice", "carol")).status?.text?.includes("STATUSTXT"));
});

// ---- F3 poll closing time ---------------------------------------------------

async function pollWorld() {
  const w = await world();
  w.thread = seedPost(w.db, { authorId: w.id.alice, body: "poll thread" });
  const create = await call(w.env, "/api/posts/" + w.thread + "/poll", { method: "POST",
    body: { question: "Best?", options: ["A", "B"], closesIn: HOUR }, session: w.session("alice") });
  w.createStatus = create.status;
  w.options = w.db.prepare("SELECT o.id FROM poll_options o JOIN polls p ON p.id = o.poll_id WHERE p.post_id = ? ORDER BY o.position")
    .all(w.thread).map((row) => Number(row.id));
  w.path = "/api/posts/" + w.thread + "/poll";
  w.vote = (name, option = w.options[0]) => call(w.env, w.path, { method: "PUT", body: { optionId: option }, session: w.session(name) });
  w.deadline = () => w.db.prepare("SELECT closes_at FROM poll_deadlines WHERE post_id = ?").get(w.thread)?.closes_at ?? null;
  return w;
}

test("F3 bounds: 1 hour to 30 days", () => {
  assert.equal(POLL_DEADLINE_MIN_SECONDS, HOUR);
  assert.equal(POLL_DEADLINE_MAX_SECONDS, 30 * 24 * HOUR);
});

test("F3 create: closesIn sets the deadline; out-of-range closesIn is 400 and creates no poll", async () => {
  const t0 = now();
  const w = await withClock(t0, () => pollWorld());
  assert.equal(w.createStatus, 201);
  assert.equal(w.deadline(), t0 + HOUR);
  const other = seedPost(w.db, { authorId: w.id.alice, body: "second" });
  for (const closesIn of [HOUR - 1, 30 * 24 * HOUR + 1, "3600", 1.5, -1]) {
    const res = await call(w.env, "/api/posts/" + other + "/poll", { method: "POST",
      body: { question: "Q?", options: ["A", "B"], closesIn }, session: w.session("alice") });
    assert.equal(res.status, 400, String(closesIn));
  }
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM polls WHERE post_id = ?").get(other).n, 0);
});

test("F3 deadline boundary: votes before closes_at land; at/after closes_at refused 409 like a closed poll", async () => {
  const t0 = now();
  const w = await withClock(t0, () => pollWorld());
  await withClock(t0 + HOUR - 1, async () => {
    assert.equal((await w.vote("bob")).status, 200);
    const detail = await getJson(w.env, "/api/posts/" + w.thread);
    assert.equal(detail.poll.closed, false);
    assert.equal(Date.parse(detail.poll.closesAt) / 1000, t0 + HOUR);
  });
  await withClock(t0 + HOUR, async () => {
    assert.equal((await w.vote("carol")).status, 409);
    assert.equal((await w.vote("bob", w.options[1])).status, 409, "no changing a vote after the deadline");
    assert.equal((await call(w.env, w.path, { method: "DELETE", session: w.session("bob") })).status, 409);
    const detail = await getJson(w.env, "/api/posts/" + w.thread, w.session("bob"));
    assert.equal(detail.poll.closed, true);
    assert.equal(detail.poll.totalVotes, 1, "results stay");
  });
});

test("F3 manage: author or staff set/clear while open; others 403; anon 401; bad values 400; closed 409", async () => {
  const t0 = now();
  const w = await withClock(t0, () => pollWorld());
  const patch = (name, body) => call(w.env, w.path, { method: "PATCH", body, session: name ? w.session(name) : undefined });
  assert.equal((await call(w.env, w.path, { method: "PATCH", body: { closesIn: null },
    headers: { Origin: "https://wempos-forum.com", "X-CSRF-Token": "x" } })).status, 401);
  assert.equal((await patch("bob", { closesIn: 2 * HOUR })).status, 403);
  assert.equal(w.deadline(), t0 + HOUR);
  for (const closesIn of [10, 31 * 24 * HOUR, "x", true]) assert.equal((await patch("alice", { closesIn })).status, 400);
  await withClock(t0, async () => assert.equal((await patch("alice", { closesIn: 2 * HOUR })).status, 200));
  assert.equal(w.deadline(), t0 + 2 * HOUR);
  assert.equal((await patch("alice", { closesIn: null })).status, 200);
  assert.equal(w.deadline(), null);
  assert.equal((await getJson(w.env, "/api/posts/" + w.thread)).poll.closesAt, null);
  await withClock(t0, async () => assert.equal((await patch("boss", { closesIn: 3 * HOUR })).status, 200));
  assert.equal(w.deadline(), t0 + 3 * HOUR);
  // The existing close/reopen body still works and still demands a boolean.
  assert.equal((await patch("alice", { closed: true })).status, 200);
  assert.equal((await patch("alice", { closesIn: 2 * HOUR })).status, 409, "a closed poll takes no deadline");
  assert.equal((await patch("alice", {})).status, 400);
  // Past its deadline the poll is closed too: no new deadline.
  assert.equal((await patch("alice", { closed: false })).status, 200);
  await withClock(t0 + 3 * HOUR + 5, async () => assert.equal((await patch("alice", { closesIn: 2 * HOUR })).status, 409));
});

test("F3 cascade: deleting the poll's thread removes the deadline row", async () => {
  const w = await pollWorld();
  assert.equal(count(w.db, "poll_deadlines"), 1);
  assert.equal((await call(w.env, "/api/posts/" + w.thread, { method: "DELETE", session: w.session("alice") })).status, 200);
  assert.equal(count(w.db, "poll_deadlines"), 0);
});
