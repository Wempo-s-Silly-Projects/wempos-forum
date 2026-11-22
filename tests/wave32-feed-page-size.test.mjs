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

// Wave 2026-11-21-32 F1 (LOW): the feed's page size is a named constant and
// the per-page decorator statements stay under D1's 100-bound-parameter
// ceiling at that size. listRootPosts used to accept an `options.limit` no
// caller passed; the reply-count rollup binds 2n+11 values for a blocking
// member, so any n >= 45 would 500 the feed on D1. The option is gone, the
// page size lives in constants.mjs, and the worst case is measured by
// spying on every bind() a real signed-in feed read issues.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedPost, seedUser } from "./helpers/seed.mjs";
import { D1_MAX_BOUND_PARAMS, FEED_PAGE_SIZE } from "../constants.mjs";
import { listRootPosts, replyCountsBinds } from "../api/posts-feed.mjs";

const EXTRA_ROOTS = 5;

function spyBinds(env) {
  const real = env.FORUM_DB;
  const counts = [];
  const db = {
    prepare(sql) {
      const statement = real.prepare(sql);
      const bind = statement.bind.bind(statement);
      statement.bind = (...values) => {
        counts.push(values.length);
        return bind(...values);
      };
      return statement;
    },
    batch: (statements) => real.batch(statements),
    exec: (sql) => real.exec(sql),
  };
  return { env: { ...env, FORUM_DB: db }, counts };
}

async function seedWorstCase() {
  const env = makeEnv();
  const db = env.__sqlite;
  const viewer = await seedUser(db, { username: "viewer" });
  const author = await seedUser(db, { username: "author" });
  const blocked = await seedUser(db, { username: "blocked" });
  // An active block pair arms every block-filter bind slot.
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)")
    .run(viewer, blocked, now());
  for (let i = 0; i < FEED_PAGE_SIZE + EXTRA_ROOTS; i += 1) {
    const root = seedPost(db, { authorId: author, body: "root " + i });
    const reply = seedPost(db, { authorId: author, body: "reply " + i, parentId: root });
    seedPost(db, { authorId: author, body: "sub " + i, parentId: reply });
    db.prepare("INSERT INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)").run(viewer, root, now());
  }
  return { env, viewer };
}

test("FEED_PAGE_SIZE is a named constant comfortably under the bind ceiling", () => {
  assert.equal(Number.isInteger(FEED_PAGE_SIZE) && FEED_PAGE_SIZE > 0, true);
  assert.equal(D1_MAX_BOUND_PARAMS, 100);
  const ids = Array.from({ length: FEED_PAGE_SIZE }, (_, i) => i + 1);
  const worst = replyCountsBinds(ids, false, [1, 1]).length;
  assert.equal(worst, 2 * FEED_PAGE_SIZE + 11);
  assert.ok(worst < D1_MAX_BOUND_PARAMS, "rollup binds " + worst + " at page " + FEED_PAGE_SIZE);
});

test("a blocking member's full feed page binds < 100 params on every statement", async () => {
  const { env, viewer } = await seedWorstCase();
  const session = forgeSession(env.__sqlite, viewer);
  const spied = spyBinds(env);
  const res = await call(spied.env, "/api/posts", { session });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.posts.length, FEED_PAGE_SIZE);
  assert.ok(body.nextBefore, "the extra roots page on");
  const worst = Math.max(...spied.counts);
  assert.ok(worst < D1_MAX_BOUND_PARAMS, "worst-case bind count " + worst);
  assert.equal(worst, 2 * FEED_PAGE_SIZE + 11, "the reply-count rollup is the widest statement");
});

test("listRootPosts ignores a caller-supplied limit; every branch caps at FEED_PAGE_SIZE", async () => {
  const { env, viewer } = await seedWorstCase();
  const member = { id: viewer, role: "member" };
  const spied = spyBinds(env);
  const feeds = [
    await listRootPosts(spied.env, member, { byActivity: true, limit: 60 }),
    await listRootPosts(spied.env, member, { limit: 60 }),
    await listRootPosts(spied.env, member, { searchTerm: "root", limit: 60 }),
  ];
  for (const feed of feeds) assert.equal(feed.posts.length, FEED_PAGE_SIZE);
  assert.ok(Math.max(...spied.counts) < D1_MAX_BOUND_PARAMS);
});

// Wave 33: the discovery variants (Unanswered filter, Newest sort) ride the
// same pin. Bare roots (no replies) give the unanswered views a full page.
test("discovery variants (unanswered, sort=new) bind < 100 params at a full page", async () => {
  const { env, viewer } = await seedWorstCase();
  const db = env.__sqlite;
  const author = db.prepare("SELECT id FROM users WHERE username = 'author'").get().id;
  for (let i = 0; i < FEED_PAGE_SIZE + EXTRA_ROOTS; i += 1) {
    const root = seedPost(db, { authorId: author, body: "open " + i });
    db.prepare("INSERT INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)").run(viewer, root, now());
  }
  const session = forgeSession(db, viewer);
  for (const query of ["unanswered=1", "sort=new", "sort=new&unanswered=1", "unanswered=1&board=general",
    "sort=new&board=general"]) {
    const spied = spyBinds(env);
    const res = await call(spied.env, "/api/posts?" + query, { session });
    assert.equal(res.status, 200, query);
    const body = await res.json();
    assert.equal(body.posts.length, FEED_PAGE_SIZE, query);
    const worst = Math.max(...spied.counts);
    assert.ok(worst < D1_MAX_BOUND_PARAMS, query + " worst-case bind count " + worst);
    assert.equal(worst, 2 * FEED_PAGE_SIZE + 11, query + ": the rollup stays the widest statement");
  }
});

// Wave 34: Suggestions pages on its own vote-score branch; page 1 and the
// score-cursor page 2 ride the same pin (a full reply forest arms the rollup).
test("Suggestions (score sort, both pages, unanswered) bind < 100 params", async () => {
  const { env, viewer } = await seedWorstCase();
  const db = env.__sqlite;
  const author = db.prepare("SELECT id FROM users WHERE username = 'author'").get().id;
  for (let i = 0; i < FEED_PAGE_SIZE + EXTRA_ROOTS; i += 1) {
    const root = seedPost(db, { authorId: author, body: "idea " + i, board: "suggestions" });
    const reply = seedPost(db, { authorId: author, body: "re " + i, parentId: root, board: "suggestions" });
    seedPost(db, { authorId: author, body: "sub " + i, parentId: reply, board: "suggestions" });
    seedPost(db, { authorId: author, body: "open idea " + i, board: "suggestions" });
    db.prepare("INSERT INTO reactions (post_id, user_id, value, created_at) VALUES (?, ?, 'like', ?)").run(root, viewer, now());
    db.prepare("INSERT INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)").run(viewer, root, now());
  }
  const session = forgeSession(db, viewer);
  const first = await call(env, "/api/posts?board=suggestions", { session });
  const cursor = (await first.json()).nextBefore;
  assert.match(cursor, /^-?[0-9]+_[0-9]+$/);
  for (const query of ["board=suggestions", "board=suggestions&before=" + cursor,
    "board=suggestions&unanswered=1"]) {
    const spied = spyBinds(env);
    const res = await call(spied.env, "/api/posts?" + query, { session });
    assert.equal(res.status, 200, query);
    const body = await res.json();
    assert.equal(body.posts.length, FEED_PAGE_SIZE, query);
    const worst = Math.max(...spied.counts);
    assert.ok(worst < D1_MAX_BOUND_PARAMS, query + " worst-case bind count " + worst);
    assert.equal(worst, 2 * FEED_PAGE_SIZE + 11, query + ": the rollup stays the widest statement");
  }
});

test("posts-feed.mjs has no options.limit and no bare page-size literals", () => {
  const source = readFileSync(new URL("../api/posts-feed.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /options\.limit/);
  assert.doesNotMatch(source, /LIMIT 21|slice\(0, 20\)|> 20;/);
  assert.match(source, /FEED_PAGE_SIZE/);
});

// Wave 5.35: the This-week page's thread list is a new feed-shaped query —
// a full FEED_PAGE_SIZE page for a blocking member (every block slot armed in
// the root filter and the reply tally) stays far under the bind ceiling.
test("/api/week binds < 100 params at a full page for a blocking member", async () => {
  const { env, viewer } = await seedWorstCase();
  const session = forgeSession(env.__sqlite, viewer);
  const spied = spyBinds(env);
  const res = await call(spied.env, "/api/week", { session });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.threads.length, FEED_PAGE_SIZE);
  const worst = Math.max(...spied.counts);
  assert.ok(worst < D1_MAX_BOUND_PARAMS, "worst-case bind count " + worst);
});

// Wave 5.36: search's date-range + sort filters (and a by-author filter, and
// the deep reply search) ride the same pin — a blocking member's full search
// page keeps every statement under the bind ceiling, rollup still widest.
test("filtered search (since, sort, by, in=replies) binds < 100 params at a full page", async () => {
  const { env, viewer } = await seedWorstCase();
  const session = forgeSession(env.__sqlite, viewer);
  for (const query of ["q=root&since=week&sort=new&in=replies", "q=root&since=year&sort=relevant",
    "q=root&by=author&since=month&sort=new&in=replies"]) {
    const spied = spyBinds(env);
    const res = await call(spied.env, "/api/search?" + query, { session });
    assert.equal(res.status, 200, query);
    const body = await res.json();
    assert.equal(body.posts.length, FEED_PAGE_SIZE, query);
    const worst = Math.max(...spied.counts);
    assert.ok(worst < D1_MAX_BOUND_PARAMS, query + " worst-case bind count " + worst);
    assert.equal(worst, 2 * FEED_PAGE_SIZE + 11, query + ": the rollup stays the widest statement");
  }
});

// Wave 5.44: the tag listing (GET /api/tags/:slug/posts) is a feed variant —
// a full FEED_PAGE_SIZE page for a blocking member (viewablePostSql's six
// viewer binds, the root block filter and the reply tally's block filters
// all armed) keeps every statement under the bind ceiling, page 2 too.
test("/api/tags/:slug/posts binds < 100 params at a full page for a blocking member (both pages)", async () => {
  const { env, viewer } = await seedWorstCase();
  const db = env.__sqlite;
  const tagId = Number(db.prepare("INSERT INTO forum_tags (slug, label, created_by, created_at) VALUES ('pin', 'Pin', ?, ?)")
    .run(viewer, now()).lastInsertRowid);
  for (const row of db.prepare("SELECT id FROM posts WHERE parent_id IS NULL").all()) {
    db.prepare("INSERT INTO thread_tags (post_id, tag_id) VALUES (?, ?)").run(row.id, tagId);
  }
  const session = forgeSession(db, viewer);
  const first = await call(env, "/api/tags/pin/posts", { session });
  const cursor = (await first.json()).nextBefore;
  assert.ok(Number.isInteger(cursor), "the extra roots page on");
  for (const path of ["/api/tags/pin/posts", "/api/tags/pin/posts?before=" + cursor]) {
    const spied = spyBinds(env);
    const res = await call(spied.env, path, { session });
    assert.equal(res.status, 200, path);
    const body = await res.json();
    assert.equal(body.threads.length, path.includes("before") ? EXTRA_ROOTS : FEED_PAGE_SIZE, path);
    const worst = Math.max(...spied.counts);
    assert.ok(worst < D1_MAX_BOUND_PARAMS, path + " worst-case bind count " + worst);
  }
  const source = readFileSync(new URL("../api/tags.mjs", import.meta.url), "utf8");
  assert.match(source, /FEED_PAGE_SIZE \+ 1/);
  assert.doesNotMatch(source, /searchParams\.get\("limit"\)/);
});
