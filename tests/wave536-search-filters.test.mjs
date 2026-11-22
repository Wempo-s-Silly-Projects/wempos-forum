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

// Wave 5.36 F1: search date range (`since`) and sort (`sort`) on /api/search.
// since ∈ {any, week, month, year} keeps roots and replies created inside
// the window (a bound cutoff); sort ∈ {relevant, new} — relevant is the
// classic order, new is created_at DESC, id DESC. Anything else is a 400.
// Every visibility filter (public only, active-ban, viewer blocks) still
// applies under every combination.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";

const DAY = 86400;

async function seedWorld() {
  const env = makeEnv();
  const db = env.__sqlite;
  const id = {};
  for (const name of ["viewer", "alice", "banned", "blocked"]) id[name] = await seedUser(db, { username: name });
  const at = now();
  const age = (postId, days) => db.prepare("UPDATE posts SET created_at = ?, last_activity_at = ? WHERE id = ?")
    .run(at - days * DAY, at - days * DAY, postId);
  const post = {};
  post.fresh = seedPost(db, { authorId: id.alice, body: "zzfind FRESHTXT" });
  post.tenDays = seedPost(db, { authorId: id.alice, body: "zzfind TENDAYSTXT" });
  age(post.tenDays, 10);
  post.twoMonths = seedPost(db, { authorId: id.alice, body: "zzfind TWOMONTHSTXT" });
  age(post.twoMonths, 60);
  post.twoYears = seedPost(db, { authorId: id.alice, body: "zzfind TWOYEARSTXT" });
  age(post.twoYears, 800);
  // An older-dated row with a HIGHER id: relevant (id order) puts it first,
  // sort=new (created_at) puts it after the fresher rows.
  post.backdated = seedPost(db, { authorId: id.alice, body: "zzfind BACKDATEDTXT" });
  age(post.backdated, 3);
  post.reply = seedPost(db, { authorId: id.alice, body: "zzfind OLDREPLYTXT", parentId: post.fresh });
  age(post.reply, 400);
  post.freshReply = seedPost(db, { authorId: id.alice, body: "zzfind FRESHREPLYTXT", parentId: post.fresh });
  seedPost(db, { authorId: id.alice, body: "zzfind HIDDENTXT", visibility: "hidden" });
  seedPost(db, { authorId: id.banned, body: "zzfind BANNEDTXT" });
  seedPost(db, { authorId: id.blocked, body: "zzfind BLOCKEDTXT" });
  seedPost(db, { authorId: id.banned, body: "zzfind BANNEDREPLYTXT", parentId: post.fresh });
  seedBan(db, id.banned);
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(id.viewer, id.blocked, at);
  return { env, db, id, post, session: forgeSession(db, id.viewer) };
}

const bodies = (list) => list.map((row) => row.body);

async function search(w, query) {
  const res = await call(w.env, "/api/search?q=zzfind&in=replies" + query, { session: w.session });
  assert.equal(res.status, 200, query);
  return res.json();
}

test("since/sort: unknown values are a 400; absent params keep the classic answer", async () => {
  const w = await seedWorld();
  for (const query of ["&since=day", "&since=", "&since=WEEK2", "&sort=old", "&sort=", "&sort=new&since=decade",
    "&since=week&sort=1"]) {
    const res = await call(w.env, "/api/search?q=zzfind" + query, { session: w.session });
    assert.equal(res.status, 400, query);
  }
  const plain = await search(w, "");
  const defaults = await search(w, "&since=any&sort=relevant");
  assert.deepEqual(defaults, plain);
});

test("since windows keep only roots and replies created inside the window", async () => {
  const w = await seedWorld();
  const expect = {
    any: ["FRESHTXT", "TENDAYSTXT", "TWOMONTHSTXT", "TWOYEARSTXT", "BACKDATEDTXT"],
    year: ["FRESHTXT", "TENDAYSTXT", "TWOMONTHSTXT", "BACKDATEDTXT"],
    month: ["FRESHTXT", "TENDAYSTXT", "BACKDATEDTXT"],
    week: ["FRESHTXT", "BACKDATEDTXT"],
  };
  for (const [since, wanted] of Object.entries(expect)) {
    const body = await search(w, "&since=" + since);
    const shown = bodies(body.posts).map((text) => text.split(" ")[1]).sort();
    assert.deepEqual(shown, [...wanted].sort(), since);
    const replies = bodies(body.replies);
    assert.ok(replies.includes("zzfind FRESHREPLYTXT"), since + " fresh reply");
    assert.equal(replies.includes("zzfind OLDREPLYTXT"), since === "any", since + " old reply");
  }
});

test("sort=new orders by created_at DESC, id DESC; relevant keeps the id order", async () => {
  const w = await seedWorld();
  const relevant = bodies((await search(w, "")).posts);
  assert.equal(relevant[0], "zzfind BACKDATEDTXT", "relevant = newest id first (classic)");
  const newest = bodies((await search(w, "&sort=new")).posts);
  assert.deepEqual(newest, ["zzfind FRESHTXT", "zzfind BACKDATEDTXT", "zzfind TENDAYSTXT",
    "zzfind TWOMONTHSTXT", "zzfind TWOYEARSTXT"]);
  const replies = bodies((await search(w, "&sort=new")).replies);
  assert.deepEqual(replies, ["zzfind FRESHREPLYTXT", "zzfind OLDREPLYTXT"]);
});

test("filters never widen visibility: hidden, banned and block-paired stay out under every combination", async () => {
  const w = await seedWorld();
  for (const since of ["any", "week", "month", "year"]) {
    for (const sort of ["relevant", "new"]) {
      for (const session of [w.session, undefined]) {
        const res = await call(w.env, "/api/search?q=zzfind&in=replies&since=" + since + "&sort=" + sort, { session });
        assert.equal(res.status, 200);
        const text = await res.text();
        for (const needle of ["HIDDENTXT", "BANNEDTXT", "BANNEDREPLYTXT"]) assert.ok(!text.includes(needle), needle);
        if (session) assert.ok(!text.includes("BLOCKEDTXT"), "block pair " + since + sort);
      }
    }
  }
  const guest = await (await call(w.env, "/api/search?q=zzfind&sort=new")).text();
  assert.ok(guest.includes("BLOCKEDTXT"), "the block filter is the viewer's own, not global");
});
