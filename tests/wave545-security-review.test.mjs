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

// Wave 5.45 security review of v5.41-v5.44 (docs/security-reviews/
// 2026-11-22-v5.41-v5.44.md). No CRITICAL or HIGH finding: these pins lock
// behaviour the review verified by hand, plus the MEDIUM slow-mode
// check-then-insert gap (M1), recorded as a `todo` and fixed in v5.54.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedPost, seedUser } from "./helpers/seed.mjs";
import { D1_MAX_BOUND_PARAMS, FEED_PAGE_SIZE } from "../constants.mjs";
import { SLOW_MODE_CHECK_SQL } from "../api/staff-tools.mjs";

const NOTE_MARKER = "W545NOTEMARKER";

async function world() {
  const env = makeEnv();
  const db = env.__sqlite;
  const id = {
    boss: await seedUser(db, { username: "boss", role: "admin" }),
    alice: await seedUser(db, { username: "alice" }),
    bob: await seedUser(db, { username: "bob" }),
  };
  const root = seedPost(db, { authorId: id.alice, body: "alice's thread" });
  const session = (name) => forgeSession(db, id[name]);
  return { env, db, id, root, session };
}

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

const sourceFiles = (dir) => readdirSync(new URL(dir, import.meta.url), { recursive: true })
  .map(String)
  .filter((name) => /\.m?js$/.test(name) && !name.startsWith("vendor"))
  .map((name) => dir + name);

const count = (db, sql) => Number(db.prepare("SELECT COUNT(*) AS n FROM " + sql).get().n);

test("staff notes: member_notes is read only by api/staff-tools.mjs (no member-facing join)", () => {
  const files = [...sourceFiles("../api/"), ...sourceFiles("../public/js/"), "../worker.mjs", "../constants.mjs"];
  const readers = files.filter((file) => readFileSync(new URL(file, import.meta.url), "utf8").includes("member_notes"));
  assert.deepEqual(readers, ["../api/staff-tools.mjs"]);
});

test("staff notes never reach the member's profile, their export or the noting staff member's export", async () => {
  const w = await world();
  w.db.prepare("INSERT INTO member_notes (member_id, author_id, body, created_at) VALUES (?, ?, ?, ?)")
    .run(w.id.alice, w.id.boss, NOTE_MARKER, now());
  const reads = [
    await call(w.env, "/api/users/alice"),
    await call(w.env, "/api/users/alice", { session: w.session("alice") }),
    await call(w.env, "/api/me/export", { session: w.session("alice") }),
    await call(w.env, "/api/me/export", { session: w.session("boss") }),
  ];
  for (const res of reads) {
    assert.equal(res.status, 200);
    assert.doesNotMatch(await res.text(), new RegExp(NOTE_MARKER));
  }
});

test("slow mode: the thread payload carries the seconds only, never who set it or when", async () => {
  const w = await world();
  w.db.prepare("INSERT INTO thread_slowmode (post_id, seconds, set_by, set_at) VALUES (?, 300, ?, ?)")
    .run(w.root, w.id.boss, 1234567);
  const res = await call(w.env, "/api/posts/" + w.root);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /"slowModeSeconds":300/);
  assert.doesNotMatch(text, /set_?by|set_?at|1234567/i);
});

test("tag listing: a blocking member's full page with a cursor stays under D1_MAX_BOUND_PARAMS", async () => {
  const w = await world();
  w.db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(w.id.bob, w.id.boss, now());
  const tagId = Number(w.db.prepare(
    "INSERT INTO forum_tags (slug, label, created_by, created_at) VALUES ('alpha', 'Alpha', ?, ?)",
  ).run(w.id.boss, now()).lastInsertRowid);
  for (let i = 0; i < FEED_PAGE_SIZE + 5; i += 1) {
    const post = seedPost(w.db, { authorId: w.id.alice, body: "tagged " + i });
    w.db.prepare("INSERT INTO thread_tags (post_id, tag_id) VALUES (?, ?)").run(post, tagId);
  }
  const spied = spyBinds(w.env);
  const res = await call(spied.env, "/api/tags/alpha/posts?before=999999", { session: w.session("bob") });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).threads.length, FEED_PAGE_SIZE);
  assert.ok(spied.counts.length > 0);
  for (const n of spied.counts) assert.ok(n < D1_MAX_BOUND_PARAMS, "binds " + n);
});

test("tag page head: a staff label with markup is escaped in <title> and meta tags", async () => {
  const w = await world();
  w.db.prepare("INSERT INTO forum_tags (slug, label, created_by, created_at) VALUES ('xss', ?, ?, ?)")
    .run("</title><script>x\"", w.id.boss, now());
  const html = await (await call(w.env, "/tag/xss")).text();
  assert.doesNotMatch(html, /<script>x/);
  assert.match(html, /<title>&lt;\/title&gt;&lt;script&gt;x&quot;/);
});

test("DM reactions: a non-participant's 404 is byte-identical to a missing message's 404", async () => {
  const w = await world();
  const [a, b] = [w.id.alice, w.id.bob].sort((x, y) => x - y);
  const thread = Number(w.db.prepare("INSERT INTO dm_threads (user_a, user_b, created_at) VALUES (?, ?, ?)")
    .run(a, b, now()).lastInsertRowid);
  const message = Number(w.db.prepare("INSERT INTO dm_messages (thread_id, user_id, body, created_at) VALUES (?, ?, 'hi', ?)")
    .run(thread, w.id.alice, now()).lastInsertRowid);
  const put = (messageId) => call(w.env, "/api/dm/messages/" + messageId + "/reaction",
    { method: "PUT", body: { value: "like" }, session: w.session("boss") });
  const real = await put(message);
  const missing = await put(message + 1000);
  assert.equal(real.status, 404);
  assert.equal(missing.status, 404);
  assert.equal(await real.text(), await missing.text());
  assert.equal(count(w.db, "dm_message_reactions"), 0);
});

// A burst of parallel replies all run the cooldown check before any of them
// inserts. The harness serialises requests, so the race is modelled the way
// wave 5.41 modelled the cap races: the check reads stale (no hit) while an
// earlier reply already sits inside the cooldown.
// v5.54: only the FIRST check read is stale (the early fast-path read raced);
// a later read sees the committed reply, as it would in production.
function staleSlowModeCheck(env) {
  const real = env.FORUM_DB;
  let stale = true;
  return {
    ...env,
    FORUM_DB: {
      prepare(sql) {
        if (sql === SLOW_MODE_CHECK_SQL && stale) {
          stale = false;
          return { bind: () => ({ first: async () => null }) };
        }
        return real.prepare(sql);
      },
      batch: (statements) => real.batch(statements),
      exec: (sql) => real.exec(sql),
    },
  };
}

// M1 fixed in v5.54: the cooldown rides inside the reply INSERT itself.
test("slow mode: a reply whose cooldown check read stale is still refused", async () => {
  const w = await world();
  w.db.prepare("INSERT INTO thread_slowmode (post_id, seconds, set_by, set_at) VALUES (?, 900, ?, ?)").run(w.root, w.id.boss, now());
  const bob = w.session("bob");
  const send = (env, i) => call(env, "/api/posts/" + w.root + "/replies", { method: "POST", body: { body: "burst " + i }, session: bob });
  assert.equal((await send(w.env, 0)).status, 201);
  const raced = await send(staleSlowModeCheck(w.env), 1);
  assert.equal(count(w.db, "posts WHERE body LIKE 'burst %'"), 1);
  assert.equal(raced.status, 429);
  assert.equal((await raced.json()).code, "slow_mode");
});
