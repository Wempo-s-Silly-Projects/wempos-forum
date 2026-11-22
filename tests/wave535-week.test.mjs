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

// v5.35 — engagement: the "This week" page (/week), the new-member "New 👋"
// chip, the home "Newest members" list, and the staff pick of the week.
// Every read obeys the visibility law (hidden, actively banned, block-paired
// both ways, deleted never show; staff-only records never reach members);
// the staff-pick write is CSRF + requireStaff with a mod-log row per change,
// and its table (migration 0065) cascades on posts and users.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeAssets, makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, ORIGIN, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";
import { FEED_PAGE_SIZE } from "../constants.mjs";

const DAY = 86400;
const SHELL = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const shellAssets = () => makeAssets(() => new Response(SHELL, {
  status: 200, headers: { "Content-Type": "text/html; charset=utf-8" },
}));

async function world() {
  const env = makeEnv({ ASSETS: shellAssets() });
  const db = env.__sqlite;
  const id = {};
  for (const name of ["alice", "bob", "viewer", "zzbanned", "zzexpired", "zzblocker", "zzblocked"]) {
    id[name] = await seedUser(db, { username: name });
  }
  id.boss = await seedUser(db, { username: "boss", role: "admin" });
  seedBan(db, id.zzbanned);
  seedBan(db, id.zzexpired, -3600);
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(id.zzblocker, id.zzblocked, now());
  const session = (name) => forgeSession(db, id[name]);
  return { env, db, id, session };
}

const ageUser = (db, userId, seconds) => db.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(now() - seconds, userId);
const agePost = (db, postId, created, active = created) =>
  db.prepare("UPDATE posts SET created_at = ?, last_activity_at = ? WHERE id = ?").run(now() - created, now() - active, postId);
const getJson = async (env, path, session) => {
  const res = await call(env, path, session ? { session } : {});
  assert.equal(res.status, 200, path);
  return res.json();
};

let attachmentSeq = 0;
function seedImage(db, postId) {
  attachmentSeq += 1;
  const id = "00000000-0000-4000-8535-" + String(attachmentSeq).padStart(12, "0");
  db.prepare(
    "INSERT INTO attachments (id, post_id, created_by, created_at, mime, version, status, hash, source_kind) " +
    "VALUES (?, ?, (SELECT author_id FROM posts WHERE id = ?), ?, 'image/png', 'v1', 'approved', ?, 'upload')",
  ).run(id, postId, postId, now(), "w535-hash-" + attachmentSeq);
  db.prepare("INSERT INTO attachment_chunks (attachment_id, kind, seq, data) VALUES (?, 'approved', 0, ?)")
    .run(id, new Uint8Array([137, 80, 78, 71]));
  return id;
}

const pick = (env, postId, session, method = "POST", headers) =>
  call(env, "/api/admin/threads/" + postId + "/staff-pick", { method, session, headers });

// ---- migration 0065 -----------------------------------------------------------

test("migration 0065 is CREATE-only, makes featured_posts, and every FK cascades", () => {
  const sql = readFileSync(new URL("../migrations/0065_featured_posts.sql", import.meta.url), "utf8");
  const statements = sql.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
  assert.ok(statements.length >= 1);
  for (const statement of statements) assert.match(statement, /^CREATE (TABLE|INDEX) IF NOT EXISTS /i, statement);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS featured_posts/);
  for (const column of ["id INTEGER PRIMARY KEY", "post_id", "picked_by", "picked_at"]) assert.ok(sql.includes(column), column);
  const references = sql.replace(/--.*$/gm, "").match(/REFERENCES [^,)]+\)[^,\n]*/g) || [];
  assert.ok(references.length >= 2, "post_id and picked_by reference posts and users");
  for (const reference of references) assert.match(reference, /ON DELETE CASCADE/, reference);
});

// ---- New 👋 chip ----------------------------------------------------------------

test("New chip: an author younger than 7 days is new on feed, detail and replies; exactly 7 days is not", async () => {
  const w = await world();
  ageUser(w.db, w.id.alice, 7 * DAY - 3600);
  ageUser(w.db, w.id.bob, 7 * DAY);
  const young = seedPost(w.db, { authorId: w.id.alice, body: "young root" });
  const old = seedPost(w.db, { authorId: w.id.bob, body: "old root" });
  seedPost(w.db, { authorId: w.id.alice, body: "young reply", parentId: old });
  seedPost(w.db, { authorId: w.id.bob, body: "old reply", parentId: young });
  const feed = await getJson(w.env, "/api/posts");
  const byId = new Map(feed.posts.map((post) => [post.id, post]));
  assert.equal(byId.get(young).author.isNew, true);
  assert.equal(byId.get(old).author.isNew, false);
  assert.equal((await getJson(w.env, "/api/posts/" + young)).post.author.isNew, true);
  assert.equal((await getJson(w.env, "/api/posts/" + old)).post.author.isNew, false);
  const replies = (await getJson(w.env, "/api/posts/" + old + "/replies")).replies;
  assert.deepEqual(replies.map((reply) => [reply.body, reply.author.isNew]), [["young reply", true]]);
  const underYoung = (await getJson(w.env, "/api/posts/" + young + "/replies")).replies;
  assert.deepEqual(underYoung.map((reply) => [reply.body, reply.author.isNew]), [["old reply", false]]);
  // The join time itself never rides the author object.
  assert.deepEqual(Object.keys(byId.get(young).author).sort(),
    ["avatarUrl", "flair", "id", "isNew", "profileAccent", "role", "username"]);
});

// ---- Newest members ------------------------------------------------------------

test("newest members: five newest, newest first, no active ban, blocks both ways, no join time", async () => {
  const w = await world();
  const list = async (who) => (await getJson(w.env, "/api/members/newest", who ? w.session(who) : null)).members;
  const guest = await list(null);
  assert.equal(guest.length, 5);
  assert.deepEqual(guest.map((m) => m.username), ["boss", "zzblocked", "zzblocker", "zzexpired", "viewer"]);
  assert.deepEqual(Object.keys(guest[0]).sort(), ["avatarUrl", "username"]);
  assert.ok(!guest.some((m) => m.username === "zzbanned"), "an actively banned member is never listed");
  assert.ok(guest.some((m) => m.username === "zzexpired"), "an expired ban does not hide a member");
  assert.ok(!(await list("zzblocker")).some((m) => m.username === "zzblocked"), "blocker never sees the blocked member");
  assert.ok(!(await list("zzblocked")).some((m) => m.username === "zzblocker"), "blocked member never sees the blocker");
  assert.doesNotMatch(JSON.stringify(guest), /created|joined|password|salt|email/i);
});

// ---- /week ----------------------------------------------------------------------

test("/api/week threads: last-7-days public roots by reply count; hidden, banned, blocked, deleted and stale never appear", async () => {
  const w = await world();
  const busy = seedPost(w.db, { authorId: w.id.alice, body: "busy WEEKOKTXT" });
  for (let i = 0; i < 3; i++) seedPost(w.db, { authorId: w.id.bob, body: "r" + i, parentId: busy });
  const quiet = seedPost(w.db, { authorId: w.id.bob, body: "quiet WEEKOKTXT" });
  seedPost(w.db, { authorId: w.id.alice, body: "r", parentId: quiet });
  // Hidden and banned replies never count toward the tally.
  for (let i = 0; i < 5; i++) seedPost(w.db, { authorId: w.id.zzbanned, body: "BANNEDTXT reply", parentId: quiet });
  for (let i = 0; i < 5; i++) seedPost(w.db, { authorId: w.id.bob, body: "HIDDENTXT reply", parentId: quiet, visibility: "hidden" });
  const revived = seedPost(w.db, { authorId: w.id.alice, body: "revived WEEKOKTXT" });
  agePost(w.db, revived, 30 * DAY, DAY);
  const stale = seedPost(w.db, { authorId: w.id.alice, body: "STALETXT" });
  agePost(w.db, stale, 8 * DAY);
  seedPost(w.db, { authorId: w.id.alice, body: "HIDDENTXT root", visibility: "hidden" });
  seedPost(w.db, { authorId: w.id.zzbanned, body: "BANNEDTXT root" });
  const expired = seedPost(w.db, { authorId: w.id.zzexpired, body: "EXPIREDOKTXT root" });
  seedPost(w.db, { authorId: w.id.zzblocker, body: "BLOCKERTXT root" });
  seedPost(w.db, { authorId: w.id.zzblocked, body: "BLOCKEDTXT root" });
  const doomed = seedPost(w.db, { authorId: w.id.alice, body: "DELETEDTXT root" });
  assert.equal((await call(w.env, "/api/posts/" + doomed, { method: "DELETE", session: w.session("alice") })).status, 200);

  const guest = await getJson(w.env, "/api/week");
  assert.deepEqual(guest.threads.slice(0, 2).map((t) => [t.id, t.replyCount]), [[busy, 3], [quiet, 1]]);
  const ids = guest.threads.map((t) => t.id);
  assert.ok(ids.includes(revived), "an old thread active this week counts");
  assert.ok(ids.includes(expired), "an expired ban does not hide a thread");
  for (const [who, forbidden] of [[null, []], ["viewer", []], ["zzblocker", ["BLOCKEDTXT"]], ["zzblocked", ["BLOCKERTXT"]], ["boss", []]]) {
    const text = JSON.stringify(await getJson(w.env, "/api/week", who ? w.session(who) : null));
    for (const needle of ["HIDDENTXT", "BANNEDTXT", "STALETXT", "DELETEDTXT", "zzbanned", ...forbidden]) {
      assert.ok(!text.includes(needle), (who || "guest") + " /api/week leaks " + needle);
    }
  }
  assert.deepEqual(Object.keys(guest.threads[0]).sort(),
    ["authorName", "board", "createdAt", "excerpt", "id", "lastActivityAt", "replyCount"]);
});

test("/api/week threads page by FEED_PAGE_SIZE and previews mask spoilers", async () => {
  const w = await world();
  for (let i = 0; i < FEED_PAGE_SIZE + 4; i++) seedPost(w.db, { authorId: w.id.alice, body: "thread " + i + " ||SECRETTXT||" });
  const body = await getJson(w.env, "/api/week");
  assert.equal(body.threads.length, FEED_PAGE_SIZE);
  assert.ok(!JSON.stringify(body).includes("SECRETTXT"), "spoilers are masked before they leave the server");
});

test("/api/week showcase: the newest showcase builds of the last 7 days only", async () => {
  const w = await world();
  const fresh = seedPost(w.db, { authorId: w.id.alice, body: "fresh build", board: "showcase" });
  seedImage(w.db, fresh);
  const old = seedPost(w.db, { authorId: w.id.bob, body: "old build", board: "showcase" });
  seedImage(w.db, old);
  agePost(w.db, old, 9 * DAY);
  const banned = seedPost(w.db, { authorId: w.id.zzbanned, body: "BANNEDTXT build", board: "showcase" });
  seedImage(w.db, banned);
  const body = await getJson(w.env, "/api/week");
  assert.deepEqual(body.showcase.map((item) => item.id), [fresh]);
  // The gallery itself still shows every build (no week window there).
  const gallery = await getJson(w.env, "/api/traditions/showcase");
  assert.deepEqual(gallery.items.map((item) => item.id), [old, fresh].sort((a, b) => b - a));
});

test("/week answers 200 with a 'This week on <site>' head, and the sitemap lists it", async () => {
  const w = await world();
  const res = await call(w.env, "/week");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<title>This week on [^<]+<\/title>/);
  assert.match(html, /<link rel="canonical" href="[^"]+\/week">/);
  const sitemap = await (await call(w.env, "/sitemap.xml")).text();
  assert.match(sitemap, /<loc>[^<]+\/week<\/loc>/);
});

// ---- staff pick ----------------------------------------------------------------

test("staff pick auth: anonymous 401, member 403, staff 200; CSRF and origin are enforced", async () => {
  const w = await world();
  const build = seedPost(w.db, { authorId: w.id.alice, body: "a build", board: "showcase" });
  assert.equal((await pick(w.env, build, undefined, "POST", { Origin: ORIGIN })).status, 401);
  assert.equal((await pick(w.env, build, w.session("alice"))).status, 403);
  const boss = w.session("boss");
  assert.equal((await pick(w.env, build, { ...boss, csrf: "wrong-token-wrong-token-wrong" })).status, 403, "bad CSRF token");
  const noOrigin = await call(w.env, "/api/admin/threads/" + build + "/staff-pick",
    { method: "POST", headers: { Cookie: boss.cookie, "X-CSRF-Token": boss.csrf } });
  assert.equal(noOrigin.status, 403, "no Origin header");
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM featured_posts").get().n, 0, "refused writes store nothing");
  const ok = await pick(w.env, build, boss);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, staffPick: true });
  assert.equal((await pick(w.env, build, boss)).status, 409, "the current pick cannot be picked twice");
  assert.equal((await pick(w.env, build, w.session("alice"), "DELETE")).status, 403);
  assert.equal((await pick(w.env, build, undefined, "DELETE", { Origin: ORIGIN })).status, 401);
});

test("staff pick: only a public showcase root can be picked", async () => {
  const w = await world();
  const boss = w.session("boss");
  const general = seedPost(w.db, { authorId: w.id.alice, body: "general", board: "general" });
  const build = seedPost(w.db, { authorId: w.id.alice, body: "build", board: "showcase" });
  const reply = seedPost(w.db, { authorId: w.id.bob, body: "reply", parentId: build, board: "showcase" });
  const hidden = seedPost(w.db, { authorId: w.id.alice, body: "hidden", board: "showcase", visibility: "hidden" });
  const banned = seedPost(w.db, { authorId: w.id.zzbanned, body: "banned", board: "showcase" });
  for (const postId of [general, reply, hidden, banned]) assert.equal((await pick(w.env, postId, boss)).status, 400, String(postId));
  assert.equal((await pick(w.env, 999999, boss)).status, 404);
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM featured_posts").get().n, 0);
});

test("staff pick shows on /week and atop the gallery; newest wins; unpick clears; mod log records both", async () => {
  const w = await world();
  const boss = w.session("boss");
  const first = seedPost(w.db, { authorId: w.id.alice, body: "first build", board: "showcase" });
  seedImage(w.db, first);
  const second = seedPost(w.db, { authorId: w.id.bob, body: "second build ||PICKSECRET||", board: "showcase" });
  assert.equal((await pick(w.env, first, boss)).status, 200);
  assert.equal((await getJson(w.env, "/api/week")).staffPick.id, first);
  assert.equal((await pick(w.env, second, boss)).status, 200);
  const week = await getJson(w.env, "/api/week");
  assert.equal(week.staffPick.id, second, "the newest pick wins");
  assert.deepEqual(Object.keys(week.staffPick).sort(), ["authorName", "createdAt", "excerpt", "id", "image"]);
  assert.ok(!JSON.stringify(week).includes("PICKSECRET"), "the pick preview is masked");
  assert.equal((await getJson(w.env, "/api/traditions/showcase")).staffPick.id, second);
  assert.equal((await getJson(w.env, "/api/posts/" + second)).post.staffPick, true);
  assert.equal((await getJson(w.env, "/api/posts/" + first)).post.staffPick, false);
  const off = await pick(w.env, second, boss, "DELETE");
  assert.equal(off.status, 200);
  assert.deepEqual(await off.json(), { ok: true, staffPick: false });
  assert.equal((await pick(w.env, second, boss, "DELETE")).status, 409, "nothing left to unpick");
  assert.equal((await getJson(w.env, "/api/week")).staffPick?.id, first, "the previous pick takes over");
  // The mod log: staff only, newest first, names the actor.
  assert.equal((await call(w.env, "/api/admin/staff-picks", { session: w.session("alice") })).status, 403);
  const log = (await getJson(w.env, "/api/admin/staff-picks", boss)).log;
  assert.deepEqual(log.map((entry) => [entry.action, entry.postId, entry.actor]),
    [["unpick", second, "boss"], ["pick", second, "boss"], ["pick", first, "boss"]]);
});

test("staff pick re-checks visibility on every read: hidden, banned or block-paired picks don't show", async () => {
  const w = await world();
  const boss = w.session("boss");
  const build = seedPost(w.db, { authorId: w.id.zzblocked, body: "PICKTXT build", board: "showcase" });
  assert.equal((await pick(w.env, build, boss)).status, 200);
  assert.equal((await getJson(w.env, "/api/week")).staffPick.id, build);
  assert.equal((await getJson(w.env, "/api/week", w.session("zzblocker"))).staffPick, null, "block pair hides the pick");
  assert.equal((await getJson(w.env, "/api/traditions/showcase", w.session("zzblocker"))).staffPick, null);
  w.db.prepare("UPDATE posts SET visibility = 'hidden' WHERE id = ?").run(build);
  for (const who of [null, "viewer", "boss"]) {
    const session = who ? w.session(who) : null;
    assert.equal((await getJson(w.env, "/api/week", session)).staffPick, null, (who || "guest") + " hidden pick");
    assert.equal((await getJson(w.env, "/api/traditions/showcase", session)).staffPick, null);
  }
  w.db.prepare("UPDATE posts SET visibility = 'public' WHERE id = ?").run(build);
  seedBan(w.db, w.id.zzblocked);
  assert.equal((await getJson(w.env, "/api/week")).staffPick, null, "banned author's pick doesn't show");
});

// D1 enforces foreign keys. The harness schema lacks the retired gc tables
// 0043 still references (the known gap that blocks every users DELETE here),
// so test-local stubs stand in for them, as in wave534-invites.
test("deleting the picked post and deleting the picking staff account both succeed (ON DELETE CASCADE)", async () => {
  const w = await world();
  w.db.exec("CREATE TABLE IF NOT EXISTS gc_messages (id INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS gc_channels (id INTEGER PRIMARY KEY)");
  const boss = w.session("boss");
  const build = seedPost(w.db, { authorId: w.id.alice, body: "build", board: "showcase" });
  assert.equal((await pick(w.env, build, boss)).status, 200);
  const deleted = await call(w.env, "/api/posts/" + build, { method: "DELETE", session: w.session("alice") });
  assert.equal(deleted.status, 200);
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM featured_posts").get().n, 0);
  const again = seedPost(w.db, { authorId: w.id.alice, body: "build two", board: "showcase" });
  assert.equal((await pick(w.env, again, boss)).status, 200);
  const gone = await call(w.env, "/api/me/delete", { method: "POST", session: boss });
  assert.equal(gone.status, 200);
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM featured_posts").get().n, 0);
  assert.equal((await getJson(w.env, "/api/week")).staffPick, null);
});
