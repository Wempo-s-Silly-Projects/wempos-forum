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

// Wave 2026-11-21-29 F1: the feed's reply-count rollup was rewritten from one
// OR-armed join (whose level-1 arm grouped every level-1 reply in the table)
// into two id-scoped arms under UNION ALL. Zero behavior change is the law:
// this suite keeps a FROZEN copy of the pre-v4.34 SQL and diffs its counts
// against the live replyCountsSql over a seeded thread forest holding hidden,
// banned (active, expired, revoked), blocked and deleted replies, for anon,
// a member, both sides of a block pair, an admin and the owner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";
import { banFilterSql, replyCountsBinds, replyCountsSql } from "../api/posts-feed.mjs";
import { viewerBlockFilterSql } from "../api/core/blocks.mjs";

// Pre-v4.34 rollup, verbatim in effect (member branch; withReplyMetadata
// always runs it with showAll = false).
function frozenOldSql(ids, viewer) {
  const placeholders = ids.map(() => "?").join(", ");
  return "SELECT COALESCE(l1.parent_id, r.parent_id) AS thread_root, COUNT(*) AS reply_count " +
    "FROM posts r JOIN posts l1 ON l1.id = r.parent_id " +
    "WHERE (l1.parent_id IS NULL OR l1.parent_id IN (" + placeholders + ")) " +
    "AND ((r.visibility = 'public' AND " + banFilterSql("r") + ") OR r.author_id = ?) " +
    "AND (l1.parent_id IS NULL OR (l1.visibility = 'public' AND " + banFilterSql("l1") + ") OR l1.author_id = ?) " +
    viewerBlockFilterSql(viewer, "r.author_id") + viewerBlockFilterSql(viewer, "l1.author_id") +
    "GROUP BY thread_root";
}

function blockBindsFor(viewer) {
  return viewerBlockFilterSql(viewer, "r.author_id") ? [Number(viewer.id), Number(viewer.id)] : [];
}

function countsByRoot(rows, ids) {
  const wanted = new Set(ids);
  const map = {};
  for (const row of rows) {
    if (wanted.has(Number(row.thread_root))) map[Number(row.thread_root)] = Number(row.reply_count);
  }
  return map;
}

function oldCounts(db, ids, viewer) {
  const blockBinds = blockBindsFor(viewer);
  const rows = db.prepare(frozenOldSql(ids, viewer)).all(...ids, -1, -1, ...blockBinds, ...blockBinds);
  return countsByRoot(rows, ids);
}

function newCounts(db, ids, viewer) {
  const rows = db.prepare(replyCountsSql(ids, false, viewer))
    .all(...replyCountsBinds(ids, false, blockBindsFor(viewer)));
  return countsByRoot(rows, ids);
}

// Deterministic forest: 40 roots, ~260 level-1 replies, ~180 sub-replies.
async function seedForest() {
  const env = makeEnv();
  const db = env.__sqlite;
  const users = [];
  for (let index = 0; index < 24; index += 1) users.push(await seedUser(db, { username: "w29u" + index }));
  const admin = await seedUser(db, { username: "w29admin", role: "admin" });
  // "owner" is a session-side role (users.role CHECK has no such value, and
  // only one admin row may exist); the filters read only viewer.role.
  const owner = await seedUser(db, { username: "w29owner" });
  const moderator = await seedUser(db, { username: "w29mod", role: "moderator" });
  let state = 2029;
  const rand = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const visibility = () => (rand() < 0.12 ? "hidden" : "public");
  const roots = [];
  const levelOnes = [];
  const levelTwos = [];
  for (let index = 0; index < 40; index += 1) {
    roots.push(seedPost(db, { authorId: pick(users), body: "root " + index, visibility: visibility() }));
  }
  for (let index = 0; index < 260; index += 1) {
    levelOnes.push(seedPost(db, { authorId: pick(users), body: "l1 " + index, parentId: pick(roots), visibility: visibility() }));
  }
  for (let index = 0; index < 180; index += 1) {
    levelTwos.push(seedPost(db, { authorId: pick(users), body: "l2 " + index, parentId: pick(levelOnes), visibility: visibility() }));
  }
  // Bans: two active (one permanent, one timed), one expired, one revoked.
  seedBan(db, users[3]);
  seedBan(db, users[4], 3600);
  seedBan(db, users[5], -3600);
  seedBan(db, users[6]);
  db.prepare("UPDATE bans SET revoked_at = ? WHERE user_id = ?").run(now(), users[6]);
  // Block pair: users[0] blocks users[1]; users[2] blocks users[0].
  const block = db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)");
  block.run(users[0], users[1], now());
  block.run(users[2], users[0], now());
  // Deletions: a level-1 reply (its sub-replies cascade) and a sub-reply.
  const remove = db.prepare("DELETE FROM posts WHERE id = ?");
  remove.run(levelOnes[0]);
  remove.run(levelOnes[7]);
  remove.run(levelTwos.at(-1));
  const viewers = {
    anon: null,
    member: { id: users[10], role: "member" },
    blocker: { id: users[0], role: "member" },
    blocked: { id: users[1], role: "member" },
    bannedMember: { id: users[3], role: "member" },
    moderator: { id: moderator, role: "moderator" },
    admin: { id: admin, role: "admin" },
    owner: { id: owner, role: "owner" },
  };
  const liveRoots = db.prepare("SELECT id FROM posts WHERE parent_id IS NULL ORDER BY id").all().map((row) => Number(row.id));
  const liveLevelOnes = db.prepare("SELECT p.id FROM posts p JOIN posts root ON root.id = p.parent_id WHERE root.parent_id IS NULL ORDER BY p.id")
    .all().map((row) => Number(row.id));
  return { env, db, users, viewers, roots: liveRoots, levelOnes: liveLevelOnes };
}

test("the fixture exercises every filter the rollup applies", async () => {
  const { db, roots, viewers } = await seedForest();
  const hidden = db.prepare("SELECT COUNT(*) AS c FROM posts WHERE parent_id IS NOT NULL AND visibility = 'hidden'").get().c;
  assert.ok(hidden > 10, "hidden replies seeded");
  const anon = oldCounts(db, roots, null);
  const blocker = oldCounts(db, roots, viewers.blocker);
  const admin = oldCounts(db, roots, viewers.admin);
  const total = (map) => Object.values(map).reduce((sum, value) => sum + value, 0);
  assert.ok(total(blocker) < total(anon), "the block pair removes rows for the blocker");
  assert.equal(total(admin), total(anon), "staff skip blocks but never see hidden/banned (nuke rule)");
});

test("new rollup matches the frozen old SQL for every viewer, page by page", async () => {
  const { db, roots, viewers } = await seedForest();
  for (const [name, viewer] of Object.entries(viewers)) {
    for (let start = 0; start < roots.length; start += 20) {
      const page = roots.slice(start, start + 20);
      assert.deepEqual(newCounts(db, page, viewer), oldCounts(db, page, viewer), name + " page@" + start);
    }
  }
});

test("new rollup matches the old SQL even when the id list mixes in level-1 reply ids", async () => {
  const { db, roots, levelOnes, viewers } = await seedForest();
  const mixed = [...roots.slice(0, 12), ...levelOnes.slice(0, 12)];
  for (const [name, viewer] of Object.entries(viewers)) {
    assert.deepEqual(newCounts(db, mixed, viewer), oldCounts(db, mixed, viewer), name);
  }
});

test("showAll binds line up with the showAll SQL", async () => {
  const { db, roots } = await seedForest();
  const page = roots.slice(0, 20);
  const sql = replyCountsSql(page, true, null);
  assert.equal((sql.match(/\?/g) || []).length, replyCountsBinds(page, true, []).length);
  const rows = db.prepare(sql).all(...replyCountsBinds(page, true, []));
  const raw = db.prepare(
    "SELECT COALESCE(l1.parent_id, r.parent_id) AS thread_root, COUNT(*) AS reply_count FROM posts r " +
    "JOIN posts l1 ON l1.id = r.parent_id GROUP BY thread_root",
  ).all();
  assert.deepEqual(countsByRoot(rows, page), countsByRoot(raw, page));
});

test("GET /api/posts replyCount equals the old SQL count for anon, member and the blocker", async () => {
  const { env, db, viewers } = await seedForest();
  for (const name of ["anon", "member", "blocker"]) {
    const viewer = viewers[name];
    const session = viewer ? forgeSession(db, viewer.id) : undefined;
    const response = await call(env, "/api/posts", { session });
    assert.equal(response.status, 200);
    const body = await response.json();
    const ids = body.posts.map((post) => Number(post.id));
    assert.ok(ids.length > 0, name + " sees a feed page");
    const expected = oldCounts(db, ids, viewer);
    for (const post of body.posts) {
      assert.equal(post.replyCount, expected[Number(post.id)] || 0, name + " root " + post.id);
    }
  }
});

test("the rollup never scans posts: both arms search by the page's ids", async () => {
  const { db, roots, viewers } = await seedForest();
  db.exec("ANALYZE");
  const page = roots.slice(0, 20);
  for (const viewer of [null, viewers.blocker]) {
    const plan = db.prepare("EXPLAIN QUERY PLAN " + replyCountsSql(page, false, viewer))
      .all(...replyCountsBinds(page, false, blockBindsFor(viewer))).map((row) => row.detail);
    assert.ok(!plan.some((detail) => /^SCAN (r|l1|posts)\b/.test(detail)), plan.join(" | "));
    assert.ok(plan.some((detail) => /^SEARCH l1 USING INDEX idx_posts_parent_replies/.test(detail)), plan.join(" | "));
  }
});
