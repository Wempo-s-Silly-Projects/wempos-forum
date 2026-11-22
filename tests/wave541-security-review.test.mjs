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

// Wave 5.41 security review of 0007c10..6a3cd5b (v5.37-v5.40), see
// docs/security-reviews/2026-11-22-v5.37-v5.40.md.
//   L1  a status line refuses bidi override/embedding/isolate controls
//       (U+202A-202E, U+2066-2069): "‮drowdab" passes the word filter
//       as logical text but renders reversed as the filtered word.
//   L2  the 200-follow cap was a COUNT then an INSERT: a request racing past
//       the read could store a 201st follow. The cap now rides the INSERT.
//   L3  the 20-folder cap had the same read-then-write shape.
// The race tests make the separate cap read report "room left" (a stale read
// from a concurrent request) and require the write itself to refuse.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedUser } from "./helpers/seed.mjs";
import { FOLDERS_MAX } from "../api/bookmark-folders.mjs";
import { FOLLOWING_MAX } from "../api/follows.mjs";
import { normalizeStatusText } from "../api/user-status.mjs";

const FOLDERS = "/api/me/bookmark-folders";
const count = (db, sql, ...args) => db.prepare("SELECT COUNT(*) AS n FROM " + sql).get(...args).n;

async function world() {
  const env = makeEnv();
  const db = env.__sqlite;
  const alice = await seedUser(db, { username: "alice" });
  const bob = await seedUser(db, { username: "bob" });
  return { env, db, alice, bob, session: forgeSession(db, alice) };
}

// Any cap read matching `pattern` answers n = 0, as a read that ran before a
// concurrent request's write would. Every other statement runs for real.
function staleCapRead(env, pattern) {
  const real = env.FORUM_DB.prepare.bind(env.FORUM_DB);
  env.FORUM_DB.prepare = (sql) => (pattern.test(sql)
    ? { bind: () => ({ first: async () => ({ n: 0 }) }) }
    : real(sql));
}

test("L1: bidi override, embedding and isolate controls are refused in a status", async () => {
  const w = await world();
  for (const ch of ["‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩"]) {
    assert.equal(normalizeStatusText("hi " + ch + "there"), null, "U+" + ch.codePointAt(0).toString(16));
  }
  const res = await call(w.env, "/api/me/status", {
    method: "PUT", body: { text: "‮drowdab", expiry: "never" }, session: w.session,
  });
  assert.equal(res.status, 400);
  assert.equal(count(w.db, "user_status"), 0);
});

test("L1: right-to-left text and the plain direction marks still work", async () => {
  const w = await world();
  for (const text of ["שלום עולם", "مرحبا بالعالم", "hi ‏:)", "‎ok"]) {
    assert.equal(normalizeStatusText(text), text, JSON.stringify(text));
    const res = await call(w.env, "/api/me/status", { method: "PUT", body: { text, expiry: "1h" }, session: w.session });
    assert.equal(res.status, 200, JSON.stringify(text));
  }
});

test("L2: the follow cap holds inside the write even when the cap read is stale", async () => {
  const w = await world();
  const at = now();
  for (let i = 0; i < FOLLOWING_MAX; i++) {
    const other = await seedUser(w.db, { username: "cap" + i });
    w.db.prepare("INSERT INTO user_follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)").run(w.alice, other, at);
  }
  staleCapRead(w.env, /COUNT\(\*\) AS n FROM user_follows/);
  const res = await call(w.env, "/api/users/bob/follow", { method: "POST", session: w.session });
  assert.equal(res.status, 400);
  assert.equal(count(w.db, "user_follows WHERE follower_id = ?", w.alice), FOLLOWING_MAX);
});

test("L2: a follow below the cap and a repeated follow still answer following", async () => {
  const w = await world();
  for (let i = 0; i < 2; i++) {
    const res = await call(w.env, "/api/users/bob/follow", { method: "POST", session: w.session });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { following: true });
  }
  assert.equal(count(w.db, "user_follows WHERE follower_id = ?", w.alice), 1);
});

test("L3: the folder cap holds inside the write even when the cap read is stale", async () => {
  const w = await world();
  for (let i = 0; i < FOLDERS_MAX; i++) {
    w.db.prepare("INSERT INTO bookmark_folders (user_id, name, created_at) VALUES (?, ?, ?)").run(w.alice, "f" + i, now());
  }
  staleCapRead(w.env, /COUNT\(\*\) AS n FROM bookmark_folders/);
  const res = await call(w.env, FOLDERS, { method: "POST", body: { name: "one too many" }, session: w.session });
  assert.equal(res.status, 400);
  assert.equal(count(w.db, "bookmark_folders WHERE user_id = ?", w.alice), FOLDERS_MAX);
});

test("L3: a duplicate name is still a 409 and a new folder still a 201", async () => {
  const w = await world();
  const make = (name) => call(w.env, FOLDERS, { method: "POST", body: { name }, session: w.session });
  assert.equal((await make("Recipes")).status, 201);
  assert.equal((await make("Recipes")).status, 409);
  assert.equal(count(w.db, "bookmark_folders WHERE user_id = ?", w.alice), 1);
});
