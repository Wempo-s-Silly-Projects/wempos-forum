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

// Wave 5.36 F2: search inside one DM or group conversation.
// GET /api/dm/threads/:id/search?q= and GET /api/dm/groups/:id/search?q=.
// Signed-in only; a non-participant gets the same 404 as a missing thread
// (existence is never revealed); q is 2–100 chars, matched with a bound,
// wildcard-escaped LIKE ... ESCAPE '\'; newest 50; banned and block-paired
// authors' messages are excluded exactly as the chat view excludes them;
// each hit is { id, authorUsername, createdAt, maskedExcerpt } (no raw body).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedUser } from "./helpers/seed.mjs";
import { GROWTH_FACTOR, LINEAR_GROWTH_CEILING, growthRatio } from "./helpers/timing.mjs";
import {
  CONVERSATION_SEARCH_LIMIT, conversationLikePattern, matchExcerpt,
} from "../api/conversation-search.mjs";

async function seedWorld() {
  const env = makeEnv();
  const db = env.__sqlite;
  const id = {};
  for (const name of ["ann", "bob", "cat", "dan", "outsider"]) id[name] = await seedUser(db, { username: name });
  const at = now();
  const run = (sql, ...args) => Number(db.prepare(sql).run(...args).lastInsertRowid);
  const dm = (threadId, userId, body, when = at) =>
    run("INSERT INTO dm_messages (thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?)", threadId, userId, body, when);
  const gm = (groupId, userId, body, when = at) =>
    run("INSERT INTO dm_group_messages (group_id, user_id, body, created_at) VALUES (?, ?, ?, ?)", groupId, userId, body, when);
  const w = { env, db, id, at, dm, gm };
  w.thread = run("INSERT INTO dm_threads (user_a, user_b, created_at) VALUES (?, ?, ?)",
    Math.min(id.ann, id.bob), Math.max(id.ann, id.bob), at);
  w.group = run("INSERT INTO dm_groups (creator_id, name, created_at) VALUES (?, 'crew', ?)", id.ann, at);
  for (const name of ["ann", "bob", "cat", "dan"]) {
    run("INSERT INTO dm_group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)", w.group, id[name], at);
  }
  return w;
}

const search = (w, base, q, who) =>
  call(w.env, base + "/search?q=" + encodeURIComponent(q), who ? { session: forgeSession(w.db, w.id[who]) } : {});

test("non-participants get the missing-thread 404 (same body), guests 401", async () => {
  const w = await seedWorld();
  w.dm(w.thread, w.id.ann, "SECRETTXT hello");
  w.gm(w.group, w.id.bob, "SECRETTXT hi crew");
  const missingDm = await search(w, "/api/dm/threads/999999", "hello", "outsider");
  const missingGroup = await search(w, "/api/dm/groups/999999", "hello", "outsider");
  for (const [base, missing] of [["/api/dm/threads/" + w.thread, missingDm], ["/api/dm/groups/" + w.group, missingGroup]]) {
    const res = await search(w, base, "SECRETTXT", "outsider");
    assert.equal(res.status, 404, base);
    assert.equal(missing.status, 404);
    const text = await res.text();
    assert.equal(text, await missing.text(), "a real thread answers exactly like a missing one");
    assert.ok(!text.includes("SECRETTXT") && !text.includes("ann") && !text.includes("bob"));
    assert.equal((await search(w, base, "SECRETTXT")).status, 401, base + " guest");
  }
  // A member of the group who is not in the 1:1 thread is still an outsider there.
  assert.equal((await search(w, "/api/dm/threads/" + w.thread, "SECRETTXT", "cat")).status, 404);
});

test("participants get id, author, time and a masked excerpt around the match (no raw body)", async () => {
  const w = await seedWorld();
  const filler = "x".repeat(200);
  const hit = w.dm(w.thread, w.id.bob, filler + " the NEEDLE is here ||spoiler secret|| " + filler);
  w.dm(w.thread, w.id.ann, "nothing to see");
  const res = await search(w, "/api/dm/threads/" + w.thread, "needle", "ann");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.results.length, 1);
  const [row] = body.results;
  assert.deepEqual(Object.keys(row).sort(), ["authorUsername", "createdAt", "id", "maskedExcerpt"]);
  assert.equal(row.id, hit);
  assert.equal(row.authorUsername, "bob");
  assert.equal(row.createdAt, new Date(w.at * 1000).toISOString());
  assert.ok(row.maskedExcerpt.includes("NEEDLE"), row.maskedExcerpt);
  assert.ok(!row.maskedExcerpt.includes("spoiler secret"), "spoilers stay masked");
  assert.ok(row.maskedExcerpt.length < 200, "an excerpt, not the body");
  assert.ok(row.maskedExcerpt.startsWith("…") && row.maskedExcerpt.endsWith("…"));
  const group = await (await search(w, "/api/dm/groups/" + w.group, "nothing", "ann")).json();
  assert.deepEqual(group.results, []);
});

test("q must be 2–100 characters", async () => {
  const w = await seedWorld();
  for (const base of ["/api/dm/threads/" + w.thread, "/api/dm/groups/" + w.group]) {
    for (const q of ["", "a", " b ", "y".repeat(101)]) {
      assert.equal((await search(w, base, q, "ann")).status, 400, base + " q=" + JSON.stringify(q));
    }
    assert.equal((await search(w, base, "ab", "ann")).status, 200);
    assert.equal((await search(w, base, "y".repeat(100), "ann")).status, 200);
  }
});

test("LIKE wildcards match literally: % and _ are escaped, as is the escape char", async () => {
  assert.equal(conversationLikePattern("50%_off\\"), "%50\\%\\_off\\\\%");
  const w = await seedWorld();
  w.dm(w.thread, w.id.ann, "plain words only");
  w.dm(w.thread, w.id.bob, "save 50% today");
  w.dm(w.thread, w.id.ann, "snake_case name");
  w.dm(w.thread, w.id.bob, "back\\slash path");
  const texts = async (q) => (await (await search(w, "/api/dm/threads/" + w.thread, q, "ann")).json())
    .results.map((row) => row.maskedExcerpt);
  assert.deepEqual(await texts("0%"), ["save 50% today"]);
  assert.deepEqual(await texts("e_c"), ["snake_case name"]);
  assert.deepEqual(await texts("%%"), []);
  assert.deepEqual(await texts("__"), []);
  assert.deepEqual(await texts("k\\s"), ["back\\slash path"]);
  w.gm(w.group, w.id.cat, "100% sure");
  w.gm(w.group, w.id.dan, "1000 sure");
  const group = await (await search(w, "/api/dm/groups/" + w.group, "0%", "ann")).json();
  assert.deepEqual(group.results.map((row) => row.maskedExcerpt), ["100% sure"]);
});

test("banned and block-paired authors are excluded both ways, like the chat view", async () => {
  const w = await seedWorld();
  w.gm(w.group, w.id.bob, "zzhit from bob");
  w.gm(w.group, w.id.cat, "zzhit from cat");
  w.gm(w.group, w.id.dan, "zzhit from dan");
  w.dm(w.thread, w.id.bob, "zzhit dm bob");
  seedBan(w.db, w.id.dan);
  w.db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(w.id.cat, w.id.ann, w.at);
  const authors = async (base, who) => (await (await search(w, base, "zzhit", who)).json())
    .results.map((row) => row.authorUsername).sort();
  assert.deepEqual(await authors("/api/dm/groups/" + w.group, "ann"), ["bob"], "ann: cat blocked her, dan banned");
  assert.deepEqual(await authors("/api/dm/groups/" + w.group, "cat"), ["bob", "cat"], "cat: blocker loses ann too");
  assert.deepEqual(await authors("/api/dm/groups/" + w.group, "bob"), ["bob", "cat"], "bob: only the ban applies");
  w.db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(w.id.ann, w.id.bob, w.at);
  assert.deepEqual(await authors("/api/dm/threads/" + w.thread, "ann"), []);
  // The chat view hides only the PAIRED member's lines: bob still finds his own.
  assert.deepEqual(await authors("/api/dm/threads/" + w.thread, "bob"), ["bob"]);
  w.dm(w.thread, w.id.ann, "zzhit dm ann");
  assert.deepEqual(await authors("/api/dm/threads/" + w.thread, "bob"), ["bob"], "ann's line is hidden from bob");
  assert.deepEqual(await authors("/api/dm/threads/" + w.thread, "ann"), ["ann"], "bob's line is hidden from ann");
  // Read-time only: an unban restores with no write.
  w.db.prepare("DELETE FROM bans WHERE user_id = ?").run(w.id.dan);
  assert.deepEqual(await authors("/api/dm/groups/" + w.group, "bob"), ["bob", "cat", "dan"]);
});

test("LIMIT 50 newest first, binds far under the D1 ceiling", async () => {
  assert.equal(CONVERSATION_SEARCH_LIMIT, 50);
  const w = await seedWorld();
  const ids = [];
  for (let i = 0; i < 70; i += 1) ids.push(w.gm(w.group, w.id.bob, "zzmany " + i, w.at - 70 + i));
  const body = await (await search(w, "/api/dm/groups/" + w.group, "zzmany", "ann")).json();
  assert.equal(body.results.length, 50);
  assert.deepEqual(body.results.map((row) => row.id), ids.slice(-50).reverse());
  for (let i = 0; i < 60; i += 1) w.dm(w.thread, w.id.ann, "zzmany dm " + i);
  const dm = await (await search(w, "/api/dm/threads/" + w.thread, "zzmany", "bob")).json();
  assert.equal(dm.results.length, 50);
});

test("queries are never logged or stored: the module has no console and no writes", () => {
  const source = readFileSync(new URL("../api/conversation-search.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /console\.|INSERT|UPDATE|DELETE|REPLACE INTO/);
  assert.match(source, /LIKE \? ESCAPE '\\\\'/);
});

test("matchExcerpt stays linear on long bodies", () => {
  const body = (units) => "ab ".repeat(units) + "needle" + " cd".repeat(units);
  const small = body(250);
  const large = body(250 * GROWTH_FACTOR);
  const { ratio } = growthRatio((text) => matchExcerpt(text, "needle"), small, large);
  assert.ok(ratio < LINEAR_GROWTH_CEILING, "4x input cost " + ratio.toFixed(1) + "x");
  assert.equal(matchExcerpt("short body", "zzz"), "short body");
});
