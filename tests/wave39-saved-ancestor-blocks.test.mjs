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

// Wave 2026-11-21-39 F1 — saved list vs ancestor blocks. canViewPost refuses a
// reply when the viewer and the PARENT or ROOT author are block-paired (either
// direction), and POST_SELECT ships the parent's body as `parent.body`. The
// saved list (and the board removal sharing its filter) must apply the same
// ancestor block test, or a blocked member's text leaks through a saved reply.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedPost, seedUser } from "./helpers/seed.mjs";

const block = (db, blocker, blocked) =>
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(blocker, blocked, now());
const save = (db, userId, postId, at) =>
  db.prepare("INSERT INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)").run(userId, postId, at);

async function world() {
  const env = makeEnv();
  const db = env.__sqlite;
  const alice = await seedUser(db, { username: "alice" });
  const bob = await seedUser(db, { username: "bob" });
  const muted = await seedUser(db, { username: "muted" }); // alice blocked them
  const blocker = await seedUser(db, { username: "blocker" }); // they blocked alice
  const owner = await seedUser(db, { username: "boss", role: "admin" });
  const mutedRoot = seedPost(db, { authorId: muted, body: "SECRET-MUTED-ROOT", board: "help" });
  const underMuted = seedPost(db, { authorId: bob, body: "bob under muted", parentId: mutedRoot, board: "help" });
  const deepMuted = seedPost(db, { authorId: bob, body: "bob deep", parentId: underMuted, board: "help" });
  const blockerRoot = seedPost(db, { authorId: blocker, body: "SECRET-BLOCKER-ROOT", board: "help" });
  const underBlocker = seedPost(db, { authorId: bob, body: "bob under blocker", parentId: blockerRoot, board: "help" });
  const okRoot = seedPost(db, { authorId: bob, body: "ok root", board: "help" });
  const okReply = seedPost(db, { authorId: bob, body: "ok reply", parentId: okRoot, board: "help" });
  block(db, alice, muted);
  block(db, blocker, alice);
  let at = now() - 100;
  for (const id of [underMuted, deepMuted, underBlocker, okReply]) {
    save(db, alice, id, at);
    save(db, owner, id, at);
    at += 1;
  }
  return {
    env, db, alice, owner, muted,
    ids: { underMuted, deepMuted, underBlocker, okReply },
    session: forgeSession(db, alice),
  };
}

const listBody = async (env, session, query = "") => {
  const res = await call(env, "/api/me/bookmarks" + query, { session });
  assert.equal(res.status, 200);
  return res.json();
};
const ids = (payload) => payload.bookmarks.map((row) => row.id).sort((a, b) => a - b);

test("saved list: a reply under a block-paired parent/root author never shows (both directions, both depths)", async () => {
  const { env, session, ids: seeded } = await world();
  for (const query of ["", "?board=help"]) {
    const payload = await listBody(env, session, query);
    assert.deepEqual(ids(payload), [seeded.okReply], query);
    const text = JSON.stringify(payload);
    assert.doesNotMatch(text, /SECRET-MUTED-ROOT|SECRET-BLOCKER-ROOT/, query);
  }
});

test("saved list: the hidden rows match canViewPost (thread detail refuses each one)", async () => {
  const { env, session, ids: seeded } = await world();
  for (const id of [seeded.underMuted, seeded.deepMuted, seeded.underBlocker]) {
    const res = await call(env, "/api/posts/" + id + "/bookmark", { method: "PUT", session });
    assert.equal(res.status, 404, "PUT " + id);
  }
});

test("remove board: ancestor-blocked rows stay saved (only what the list showed goes)", async () => {
  const { env, db, alice, session, ids: seeded } = await world();
  const res = await call(env, "/api/me/bookmarks?board=help", { method: "DELETE", session });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).removed, 1);
  const left = db.prepare("SELECT post_id FROM bookmarks WHERE user_id = ? ORDER BY post_id").all(alice)
    .map((row) => Number(row.post_id));
  assert.deepEqual(left, [seeded.underMuted, seeded.deepMuted, seeded.underBlocker]);
});

test("saved list: unblocking restores the row with no write; staff bypass the block", async () => {
  const { env, db, alice, owner, muted, ids: seeded } = await world();
  const staff = await listBody(env, forgeSession(db, owner));
  assert.deepEqual(ids(staff), [seeded.underMuted, seeded.deepMuted, seeded.underBlocker, seeded.okReply]);
  db.prepare("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?").run(alice, muted);
  const after = await listBody(env, forgeSession(db, alice));
  assert.deepEqual(ids(after), [seeded.underMuted, seeded.deepMuted, seeded.okReply]);
});
