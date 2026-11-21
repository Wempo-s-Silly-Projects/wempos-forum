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

// Wave 2026-11-21-36 F1 — Saved posts by board. GET /api/me/bookmarks takes
// an optional ?board=<slug> (whitelisted) and DELETE /api/me/bookmarks?board=
// removes the caller's OWN saved rows in that board — only the rows the list
// would show (visible, unbanned, unblocked, visible ancestors), so a hidden
// row comes back on unban exactly like the rest of the site. Real worker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import worker from "../worker.mjs";
import { ORIGIN, call, forgeSession, now, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";

const save = (db, userId, postId, at = now()) =>
  db.prepare("INSERT INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)").run(userId, postId, at);
const savedIds = (db, userId) => db.prepare(
  "SELECT post_id FROM bookmarks WHERE user_id = ? ORDER BY post_id",
).all(userId).map((row) => Number(row.post_id));

async function world() {
  const env = makeEnv();
  const db = env.__sqlite;
  const alice = await seedUser(db, { username: "alice" });
  const bob = await seedUser(db, { username: "bob" });
  const banned = await seedUser(db, { username: "banned" });
  const blocked = await seedUser(db, { username: "blocked" });
  const helpRoot = seedPost(db, { authorId: bob, body: "help root", board: "help" });
  const helpReply = seedPost(db, { authorId: bob, body: "help reply", parentId: helpRoot, board: "help" });
  const generalRoot = seedPost(db, { authorId: bob, body: "general root", board: "general" });
  const hiddenHelp = seedPost(db, { authorId: bob, body: "hidden help", board: "help", visibility: "hidden" });
  const bannedHelp = seedPost(db, { authorId: banned, body: "banned help", board: "help" });
  const blockedHelp = seedPost(db, { authorId: blocked, body: "blocked help", board: "help" });
  const hiddenRoot = seedPost(db, { authorId: bob, body: "hidden root", board: "help", visibility: "hidden" });
  const orphanReply = seedPost(db, { authorId: bob, body: "reply under hidden root", parentId: hiddenRoot, board: "help" });
  const deepReply = seedPost(db, { authorId: bob, body: "level-2 under hidden root", parentId: orphanReply, board: "help" });
  seedBan(db, banned);
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(alice, blocked, now());
  let at = now() - 100;
  for (const id of [helpRoot, helpReply, generalRoot, hiddenHelp, bannedHelp, blockedHelp, orphanReply, deepReply]) {
    save(db, alice, id, at++);
  }
  save(db, bob, helpRoot);
  return {
    env, db, alice, bob, banned,
    ids: { helpRoot, helpReply, generalRoot, hiddenHelp, bannedHelp, blockedHelp, orphanReply, deepReply },
    session: forgeSession(db, alice),
  };
}

const listIds = async (env, session, query = "") => {
  const res = await call(env, "/api/me/bookmarks" + query, { session });
  assert.equal(res.status, 200);
  return (await res.json()).bookmarks.map((row) => row.id).sort((a, b) => a - b);
};

test("saved by board: ?board= narrows the list to that board's visible rows", async () => {
  const { env, session, ids } = await world();
  assert.deepEqual(await listIds(env, session, "?board=help"), [ids.helpRoot, ids.helpReply]);
  assert.deepEqual(await listIds(env, session, "?board=general"), [ids.generalRoot]);
  assert.deepEqual(await listIds(env, session, "?board=showcase"), []);
});

test("saved list (any board): hidden, banned, blocked and hidden-ancestor rows never show", async () => {
  const { env, session, ids } = await world();
  assert.deepEqual(await listIds(env, session), [ids.helpRoot, ids.helpReply, ids.generalRoot]);
});

test("saved by board: an unknown or malformed board is a 400", async () => {
  const { env, session } = await world();
  for (const bad of ["nope", "HELP", "help'--", ""]) {
    const res = await call(env, "/api/me/bookmarks?board=" + encodeURIComponent(bad), { session });
    assert.equal(res.status, 400, bad);
  }
});

test("saved by board: the cursor keeps walking inside the board", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  const alice = await seedUser(db, { username: "alice" });
  const help = [];
  for (let i = 0; i < 23; i += 1) {
    const id = seedPost(db, { authorId: alice, body: "h" + i, board: "help" });
    save(db, alice, id, 1000 + i);
    help.push(id);
    save(db, alice, seedPost(db, { authorId: alice, body: "g" + i, board: "general" }), 1000 + i);
  }
  const session = forgeSession(db, alice);
  const first = await (await call(env, "/api/me/bookmarks?board=help", { session })).json();
  assert.equal(first.bookmarks.length, 20);
  assert.ok(first.nextBefore);
  const second = await (await call(env, "/api/me/bookmarks?board=help&before=" + first.nextBefore, { session })).json();
  const all = [...first.bookmarks, ...second.bookmarks].map((row) => row.id).sort((a, b) => a - b);
  assert.deepEqual(all, help);
  assert.equal(second.nextBefore, null);
});

test("remove board: guests are refused (requireUser checks Origin/CSRF first) and nothing changes", async () => {
  const { env, db, alice } = await world();
  const before = savedIds(db, alice);
  const res = await call(env, "/api/me/bookmarks?board=help", { method: "DELETE" });
  assert.equal(res.status, 403);
  const sameOrigin = new Request(ORIGIN + "/api/me/bookmarks?board=help", {
    method: "DELETE", headers: { Origin: ORIGIN, "X-CSRF-Token": "x".repeat(32) },
  });
  assert.ok([401, 403].includes((await worker.fetch(sameOrigin, env, { waitUntil() {} })).status));
  assert.deepEqual(savedIds(db, alice), before);
});

test("remove board: a missing CSRF token or a foreign Origin is refused", async () => {
  const { env, db, alice, session } = await world();
  const before = savedIds(db, alice);
  const noCsrf = new Request(ORIGIN + "/api/me/bookmarks?board=help", {
    method: "DELETE", headers: { Cookie: session.cookie, Origin: ORIGIN },
  });
  assert.equal((await worker.fetch(noCsrf, env, { waitUntil() {} })).status, 403);
  const foreign = new Request(ORIGIN + "/api/me/bookmarks?board=help", {
    method: "DELETE",
    headers: { Cookie: session.cookie, Origin: "https://evil.example", "X-CSRF-Token": session.csrf },
  });
  assert.equal((await worker.fetch(foreign, env, { waitUntil() {} })).status, 403);
  assert.deepEqual(savedIds(db, alice), before);
});

test("remove board: the board is required and whitelisted", async () => {
  const { env, db, alice, session } = await world();
  const before = savedIds(db, alice);
  for (const query of ["", "?board=", "?board=nope", "?board=help%27%20OR%201%3D1"]) {
    const res = await call(env, "/api/me/bookmarks" + query, { method: "DELETE", session });
    assert.equal(res.status, 400, query);
  }
  assert.deepEqual(savedIds(db, alice), before);
});

test("remove board: removes only the caller's visible rows in that board", async () => {
  const { env, db, alice, bob, session, ids } = await world();
  const res = await call(env, "/api/me/bookmarks?board=help", { method: "DELETE", session });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, removed: 2 });
  // Other board kept; rows the list never showed stay (they return on unban /
  // unhide / unblock exactly like the rest of the site); bob untouched.
  assert.deepEqual(savedIds(db, alice), [
    ids.generalRoot, ids.hiddenHelp, ids.bannedHelp, ids.blockedHelp, ids.orphanReply, ids.deepReply,
  ].sort((a, b) => a - b));
  assert.deepEqual(savedIds(db, bob), [ids.helpRoot]);
  // Idempotent: a second run removes nothing.
  const again = await call(env, "/api/me/bookmarks?board=help", { method: "DELETE", session });
  assert.deepEqual(await again.json(), { ok: true, removed: 0 });
});

test("remove board: an actively banned member is refused", async () => {
  const { env, db, banned } = await world();
  save(db, banned, seedPost(db, { authorId: banned, body: "x", board: "help" }));
  const res = await call(env, "/api/me/bookmarks?board=help", { method: "DELETE", session: forgeSession(db, banned) });
  assert.equal(res.status, 403);
  assert.equal(savedIds(db, banned).length, 1);
});

test("saved list: other methods on /api/me/bookmarks are a 405", async () => {
  const { env, session } = await world();
  const res = await call(env, "/api/me/bookmarks", { method: "PATCH", session });
  assert.equal(res.status, 405);
});
