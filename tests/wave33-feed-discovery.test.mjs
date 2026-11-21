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
// Wave 2026-11-21-33 — feed discovery: the Unanswered filter (unanswered=1)
// and the Newest sort (sort=new). Both ride listRootPosts' existing root
// WHERE (public root, banFilterSql, viewer block pair), and "answered" is
// judged by the same visibility law the card's replyCount uses: a reply only
// counts when it is public, its author has no active ban, and it is not from
// a block pair with the viewer. RED first; driven through worker.fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";
import { FEED_PAGE_SIZE } from "../constants.mjs";

const ids = (body) => body.posts.map((post) => post.id);

async function seedWorld() {
  const env = makeEnv();
  const db = env.__sqlite;
  const viewer = await seedUser(db, { username: "viewer" });
  const author = await seedUser(db, { username: "author" });
  const replier = await seedUser(db, { username: "replier" });
  const banned = await seedUser(db, { username: "banned" });
  const lapsed = await seedUser(db, { username: "lapsed" });
  const blocked = await seedUser(db, { username: "blocked" });
  seedBan(db, banned);
  seedBan(db, lapsed, -60);
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)")
    .run(viewer, blocked, now());
  const root = (body, extra = {}) => seedPost(db, { authorId: author, body, ...extra });
  const reply = (parentId, authorId, extra = {}) =>
    seedPost(db, { authorId, body: "re", parentId, ...extra });
  const w = {
    bare: root("bare"),
    answered: root("answered"),
    hiddenOnly: root("hidden reply only"),
    bannedOnly: root("banned reply only"),
    lapsedReply: root("lapsed-ban reply"),
    blockedOnly: root("blocked reply only"),
    hiddenRoot: root("hidden root", { visibility: "hidden" }),
    bannedRoot: seedPost(db, { authorId: banned, body: "banned root" }),
    blockedRoot: seedPost(db, { authorId: blocked, body: "blocked root" }),
    otherBoard: root("other board", { board: "help" }),
  };
  reply(w.answered, replier);
  reply(w.hiddenOnly, replier, { visibility: "hidden" });
  reply(w.bannedOnly, banned);
  reply(w.lapsedReply, lapsed);
  reply(w.blockedOnly, blocked);
  return { env, db, viewer, author, w };
}

test("unanswered (anonymous): only public, unbanned replies answer a thread", async () => {
  const { env, w } = await seedWorld();
  const res = await call(env, "/api/posts?unanswered=1");
  assert.equal(res.status, 200);
  const shown = ids(await res.json());
  for (const key of ["bare", "hiddenOnly", "bannedOnly", "otherBoard"]) {
    assert.ok(shown.includes(w[key]), key + " should read as unanswered");
  }
  // An anonymous viewer has no block pair: the blocked member's reply answers.
  for (const key of ["answered", "lapsedReply", "blockedOnly", "hiddenRoot", "bannedRoot"]) {
    assert.ok(!shown.includes(w[key]), key + " must not appear");
  }
});

test("unanswered (member): a reply from a blocked member does not answer it for the blocker", async () => {
  const { env, db, viewer, w } = await seedWorld();
  const res = await call(env, "/api/posts?unanswered=1", { session: forgeSession(db, viewer) });
  assert.equal(res.status, 200);
  const body = await res.json();
  const shown = ids(body);
  assert.ok(shown.includes(w.blockedOnly), "blocked-only replies read as unanswered for the blocker");
  assert.ok(!shown.includes(w.blockedRoot), "the blocked member's own root stays out");
  assert.ok(!shown.includes(w.answered));
  // Every card the filter returns agrees with its own replyCount.
  for (const post of body.posts) assert.equal(post.replyCount, 0, "post " + post.id);
});

test("unanswered (admin): staff get the same nuke-rule answer, never hidden roots", async () => {
  const { env, db, w } = await seedWorld();
  const owner = await seedUser(db, { username: "boss", role: "admin" });
  const res = await call(env, "/api/posts?unanswered=1", { session: forgeSession(db, owner) });
  const shown = ids(await res.json());
  assert.ok(shown.includes(w.hiddenOnly) && shown.includes(w.bannedOnly));
  assert.ok(!shown.includes(w.hiddenRoot) && !shown.includes(w.bannedRoot));
});

test("unanswered scopes to a board and combines with the newest sort", async () => {
  const { env, w } = await seedWorld();
  const board = ids(await (await call(env, "/api/posts?unanswered=1&board=help")).json());
  assert.deepEqual(board, [w.otherBoard]);
  const newest = ids(await (await call(env, "/api/posts?unanswered=1&sort=new")).json());
  assert.deepEqual(newest, [w.otherBoard, w.blockedRoot, w.bannedOnly, w.hiddenOnly, w.bare]);
});

test("unanswered pages by FEED_PAGE_SIZE on the activity cursor", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  const author = await seedUser(db, { username: "author" });
  for (let i = 0; i < FEED_PAGE_SIZE + 3; i += 1) {
    const root = seedPost(db, { authorId: author, body: "q" + i });
    if (i % 2 === 0) seedPost(db, { authorId: author, body: "a", parentId: root });
  }
  for (let i = 0; i < FEED_PAGE_SIZE; i += 1) seedPost(db, { authorId: author, body: "open" + i });
  const first = await (await call(env, "/api/posts?unanswered=1")).json();
  assert.equal(first.posts.length, FEED_PAGE_SIZE);
  assert.ok(first.nextBefore);
  const second = await (await call(env, "/api/posts?unanswered=1&before=" +
    encodeURIComponent(first.nextBefore))).json();
  const total = FEED_PAGE_SIZE + Math.floor((FEED_PAGE_SIZE + 3) / 2);
  assert.equal(first.posts.length + second.posts.length, total);
  assert.equal(new Set([...ids(first), ...ids(second)]).size, total);
  for (const post of [...first.posts, ...second.posts]) assert.equal(post.replyCount, 0);
});

test("newest orders roots by creation, ignoring bumps and pins", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  const author = await seedUser(db, { username: "author" });
  const old = seedPost(db, { authorId: author, body: "old" });
  const mid = seedPost(db, { authorId: author, body: "mid" });
  const fresh = seedPost(db, { authorId: author, body: "fresh" });
  db.prepare("UPDATE posts SET last_activity_at = ? WHERE id = ?").run(now() + 500, old);
  db.prepare("UPDATE posts SET pinned_at = ? WHERE id = ?").run(now(), mid);
  const active = ids(await (await call(env, "/api/posts")).json());
  assert.deepEqual(active.slice(0, 2), [mid, old], "control: the default view pins then bumps");
  const newest = ids(await (await call(env, "/api/posts?sort=new")).json());
  assert.deepEqual(newest, [fresh, mid, old]);
});

test("newest keeps the visibility law (hidden, banned, blocked)", async () => {
  const { env, db, viewer, w } = await seedWorld();
  const guest = ids(await (await call(env, "/api/posts?sort=new")).json());
  assert.ok(!guest.includes(w.hiddenRoot) && !guest.includes(w.bannedRoot));
  assert.ok(guest.includes(w.blockedRoot));
  const member = ids(await (await call(env, "/api/posts?sort=new",
    { session: forgeSession(db, viewer) })).json());
  assert.ok(!member.includes(w.blockedRoot) && !member.includes(w.hiddenRoot));
  assert.ok(member.includes(w.answered));
});

test("newest pages on a bare id cursor and scopes to a board", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  const author = await seedUser(db, { username: "author" });
  const made = [];
  for (let i = 0; i < FEED_PAGE_SIZE + 4; i += 1) made.push(seedPost(db, { authorId: author, body: "n" + i }));
  const elsewhere = seedPost(db, { authorId: author, body: "x", board: "help" });
  const first = await (await call(env, "/api/posts?sort=new&board=general")).json();
  assert.equal(first.posts.length, FEED_PAGE_SIZE);
  assert.equal(first.nextBefore, made[4]);
  assert.ok(!ids(first).includes(elsewhere));
  const second = await (await call(env, "/api/posts?sort=new&board=general&before=" + first.nextBefore)).json();
  assert.deepEqual(ids(second), made.slice(0, 4).reverse());
  assert.equal(second.nextBefore, null);
});

test("discovery params are validated before any database work", async () => {
  const { env, db, viewer } = await seedWorld();
  const session = forgeSession(db, viewer);
  for (const [path, opts] of [
    ["/api/posts?unanswered=2"],
    ["/api/posts?unanswered=yes"],
    ["/api/posts?sort=old"],
    ["/api/posts?sort="],
    ["/api/posts?sort=new&board=suggestions"],
    ["/api/posts?sort=new&before=1700000000_5"],
    ["/api/posts?mine=1&unanswered=1", { session }],
    ["/api/posts?mine=1&sort=new", { session }],
  ]) {
    const res = await call(env, path, opts);
    assert.equal(res.status, 400, path);
  }
  assert.equal((await call(env, "/api/posts?unanswered=0")).status, 200);
  assert.equal((await call(env, "/api/posts?unanswered=1&board=suggestions")).status, 200);
});
