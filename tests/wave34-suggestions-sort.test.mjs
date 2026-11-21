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

// Wave 2026-11-21-34 F1 (bug): /api/posts?board=suggestions went down the
// activity-order branch (the route always passed byActivity), so the
// vote-score sort never ran and the score cursor was read by the activity
// branch. Suggestions now order by net score (likes minus dislikes), id
// DESC as the tiebreak, paging on the score_id cursor by FEED_PAGE_SIZE,
// with the exact same root visibility clauses as every other feed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";
import { FEED_PAGE_SIZE } from "../constants.mjs";

const EXTRA = 7;

async function seedVoters(db, count) {
  const ids = [];
  for (let i = 0; i < count; i += 1) ids.push(await seedUser(db, { username: "voter" + i }));
  return ids;
}

function react(db, postId, userId, value) {
  db.prepare("INSERT INTO reactions (post_id, user_id, value, created_at) VALUES (?, ?, ?, ?)")
    .run(postId, userId, value, now());
}

function vote(db, postId, voters, net) {
  const value = net >= 0 ? "like" : "dislike";
  for (let i = 0; i < Math.abs(net); i += 1) react(db, postId, voters[i], value);
}

const suggestion = (db, authorId, body) => seedPost(db, { authorId, body, board: "suggestions" });
const ids = (body) => body.posts.map((post) => post.id);

test("a well-liked older suggestion sorts above a newer one", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  const author = await seedUser(db, { username: "author" });
  const voters = await seedVoters(db, 4);
  const old = suggestion(db, author, "old and loved");
  const mid = suggestion(db, author, "middling");
  const fresh = suggestion(db, author, "brand new");
  const disliked = suggestion(db, author, "disliked");
  vote(db, old, voters, 3);
  vote(db, mid, voters, 1);
  vote(db, disliked, voters, -2);
  react(db, mid, voters[3], "dislike");
  react(db, mid, voters[2], "like");
  const res = await call(env, "/api/posts?board=suggestions");
  assert.equal(res.status, 200);
  const body = await res.json();
  // old +3, mid (1 like + 1 like + 1 dislike) = +1, fresh 0, disliked -2.
  assert.deepEqual(ids(body), [old, mid, fresh, disliked]);
  assert.equal(body.nextBefore, null);
});

test("equal scores break ties by newest id first, deterministically", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  const author = await seedUser(db, { username: "author" });
  const voters = await seedVoters(db, 2);
  const a = suggestion(db, author, "a");
  const b = suggestion(db, author, "b");
  const c = suggestion(db, author, "c");
  vote(db, a, voters, 2);
  vote(db, c, voters, 2);
  const first = ids(await (await call(env, "/api/posts?board=suggestions")).json());
  const second = ids(await (await call(env, "/api/posts?board=suggestions")).json());
  assert.deepEqual(first, [c, a, b]);
  assert.deepEqual(second, first);
});

test("paging by the score cursor has no duplicates and no gaps", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  const author = await seedUser(db, { username: "author" });
  const voters = await seedVoters(db, 4);
  const expected = [];
  for (let i = 0; i < FEED_PAGE_SIZE + EXTRA; i += 1) {
    const id = suggestion(db, author, "s" + i);
    const net = (i % 5) - 2; // -2..+2: many ties straddle the page edge
    vote(db, id, voters, net);
    expected.push({ id, net });
  }
  expected.sort((x, y) => y.net - x.net || y.id - x.id);
  const page1 = await (await call(env, "/api/posts?board=suggestions")).json();
  assert.equal(page1.posts.length, FEED_PAGE_SIZE);
  assert.match(page1.nextBefore, /^-?[0-9]+_[0-9]+$/);
  const res2 = await call(env, "/api/posts?board=suggestions&before=" + page1.nextBefore);
  assert.equal(res2.status, 200);
  const page2 = await res2.json();
  assert.equal(page2.posts.length, EXTRA);
  assert.equal(page2.nextBefore, null);
  const walked = [...ids(page1), ...ids(page2)];
  assert.equal(new Set(walked).size, walked.length, "no duplicates");
  assert.deepEqual(walked, expected.map((row) => row.id), "no gaps, score order kept");
});

test("an activity cursor on Suggestions is a 400, not a misread page", async () => {
  const env = makeEnv();
  const res = await call(env, "/api/posts?board=suggestions&before=1_1700000000_5");
  assert.equal(res.status, 400);
});

test("score sort keeps every visibility clause: hidden, banned, blocked stay out", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  const viewer = await seedUser(db, { username: "viewer" });
  const author = await seedUser(db, { username: "author" });
  const banned = await seedUser(db, { username: "banned" });
  const lapsed = await seedUser(db, { username: "lapsed" });
  const blocked = await seedUser(db, { username: "blocked" });
  const voters = await seedVoters(db, 3);
  const shown = suggestion(db, author, "fine");
  const hidden = seedPost(db, { authorId: author, body: "hidden", board: "suggestions", visibility: "hidden" });
  const fromBanned = suggestion(db, banned, "banned");
  const fromLapsed = suggestion(db, lapsed, "lapsed");
  const fromBlocked = suggestion(db, blocked, "blocked");
  const general = seedPost(db, { authorId: author, body: "general board" });
  for (const id of [hidden, fromBanned, fromBlocked, general]) vote(db, id, voters, 3);
  seedBan(db, banned);
  seedBan(db, lapsed, -60);
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(blocked, viewer, now());
  const anon = ids(await (await call(env, "/api/posts?board=suggestions")).json());
  assert.deepEqual(anon, [fromBlocked, fromLapsed, shown]);
  const session = forgeSession(db, viewer);
  const member = ids(await (await call(env, "/api/posts?board=suggestions", { session })).json());
  assert.deepEqual(member, [fromLapsed, shown]);
});

test("unanswered=1 on Suggestions keeps the score order", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  const author = await seedUser(db, { username: "author" });
  const voters = await seedVoters(db, 2);
  const low = suggestion(db, author, "low");
  const high = suggestion(db, author, "high");
  const answered = suggestion(db, author, "answered");
  vote(db, low, voters, 1);
  vote(db, high, voters, 2);
  seedPost(db, { authorId: author, body: "reply", parentId: answered });
  const body = await (await call(env, "/api/posts?board=suggestions&unanswered=1")).json();
  assert.deepEqual(ids(body), [high, low]);
});
