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

// v5.34 — private invite links. /join?ref=<username>; after sign-up the new
// member's client claims the ref once (POST /api/me/invite). A claim lands
// only for a NEW account (inside the newcomer window) naming an existing,
// unbanned member who is not the claimant and not block-paired with them in
// either direction; anything else is ignored (200, inviter null, no row, no
// notification). One row per new member (invites.user_id PK), nothing else
// stored, nothing public. The inviter's bell row names the new member and
// drops at read time while that member is banned or block-paired.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedUser } from "./helpers/seed.mjs";

const DAY = 86400;

async function world() {
  const env = makeEnv();
  const db = env.__sqlite;
  const id = {};
  for (const name of ["alice", "bob", "carol", "zzbanned", "zzblocker", "zzblocked"]) id[name] = await seedUser(db, { username: name });
  seedBan(db, id.zzbanned);
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(id.zzblocker, id.bob, now());
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(id.carol, id.zzblocked, now());
  return { env, db, id };
}

const claim = (env, session, ref) => call(env, "/api/me/invite", { method: "POST", session, body: { ref } });
const inviteRows = (db) => db.prepare("SELECT user_id, inviter_id FROM invites ORDER BY user_id").all()
  .map((row) => [Number(row.user_id), Number(row.inviter_id)]);
const bell = (db, userId) => db.prepare("SELECT label FROM notifications WHERE user_id = ?").all(userId).map((r) => r.label);

test("migration 0064 is CREATE-only and makes the invites table", () => {
  const sql = readFileSync(new URL("../migrations/0064_invites.sql", import.meta.url), "utf8");
  const statements = sql.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
  assert.ok(statements.length >= 1);
  for (const statement of statements) assert.match(statement, /^CREATE (TABLE|INDEX) IF NOT EXISTS /i, statement);
  assert.match(sql, /invites/);
  assert.match(sql, /user_id INTEGER PRIMARY KEY/);
});

test("a new member's valid claim stores one row, names the inviter, and notifies them once", async () => {
  const w = await world();
  const bob = forgeSession(w.db, w.id.bob);
  const res = await claim(w.env, bob, "Alice");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { inviter: "alice" });
  assert.deepEqual(inviteRows(w.db), [[w.id.bob, w.id.alice]]);
  assert.deepEqual(bell(w.db, w.id.alice), ["Your friend bob joined using your invite link"]);
  const session = await (await call(w.env, "/api/session", { session: bob })).json();
  assert.equal(session.user.invitedBy, "alice");
  // A second claim (another ref or the same) changes nothing and pings no one.
  assert.deepEqual(await (await claim(w.env, bob, "carol")).json(), { inviter: null });
  assert.deepEqual(await (await claim(w.env, bob, "alice")).json(), { inviter: null });
  assert.deepEqual(inviteRows(w.db), [[w.id.bob, w.id.alice]]);
  assert.equal(bell(w.db, w.id.alice).length, 1);
  assert.equal(bell(w.db, w.id.carol).length, 0);
});

test("unknown, self, banned and block-paired refs are ignored with no row and no notification", async () => {
  const w = await world();
  const cases = [["bob", "nobody_here"], ["bob", "bob"], ["bob", "zzbanned"], ["bob", "zzblocker"], ["carol", "zzblocked"]];
  for (const [member, ref] of cases) {
    const res = await claim(w.env, forgeSession(w.db, w.id[member]), ref);
    assert.equal(res.status, 200, member + " <- " + ref);
    assert.deepEqual(await res.json(), { inviter: null }, member + " <- " + ref);
  }
  assert.deepEqual(inviteRows(w.db), []);
  for (const name of ["bob", "zzbanned", "zzblocker", "zzblocked", "carol"]) assert.deepEqual(bell(w.db, w.id[name]), [], name);
  const session = await (await call(w.env, "/api/session", { session: forgeSession(w.db, w.id.bob) })).json();
  assert.equal(session.user.invitedBy, null);
});

test("an account older than the newcomer window cannot claim an inviter", async () => {
  const w = await world();
  w.db.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(now() - 30 * DAY, w.id.bob);
  assert.deepEqual(await (await claim(w.env, forgeSession(w.db, w.id.bob), "alice")).json(), { inviter: null });
  assert.deepEqual(inviteRows(w.db), []);
  assert.deepEqual(bell(w.db, w.id.alice), []);
});

test("an inviter who joined after the claimant is ignored", async () => {
  const w = await world();
  w.db.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(now() - DAY, w.id.bob);
  assert.deepEqual(await (await claim(w.env, forgeSession(w.db, w.id.bob), "alice")).json(), { inviter: null });
  assert.deepEqual(inviteRows(w.db), []);
});

test("the claim is a guarded write: sign-in, same-origin + CSRF, and a valid username shape", async () => {
  const w = await world();
  assert.equal((await call(w.env, "/api/me/invite", { method: "POST", body: { ref: "alice" } })).status, 403);
  const bob = forgeSession(w.db, w.id.bob);
  const noCsrf = await call(w.env, "/api/me/invite", { method: "POST", session: { cookie: bob.cookie, csrf: "wrong" }, body: { ref: "alice" } });
  assert.equal(noCsrf.status, 403);
  for (const ref of ["", "a b", "x".repeat(40), "<script>", 7, null]) {
    assert.equal((await claim(w.env, bob, ref)).status, 400, String(ref));
  }
  assert.deepEqual(inviteRows(w.db), []);
});

test("the inviter's bell row and the welcome name drop while the other side is banned or block-paired", async () => {
  const w = await world();
  const bob = forgeSession(w.db, w.id.bob);
  await claim(w.env, bob, "alice");
  const alice = forgeSession(w.db, w.id.alice);
  const list = async () => JSON.stringify(await (await call(w.env, "/api/me/notifications", { session: alice })).json());
  assert.ok((await list()).includes("Your friend bob joined"));
  w.db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(w.id.alice, w.id.bob, now());
  assert.ok(!(await list()).includes("bob"), "block pair hides the row");
  assert.equal((await (await call(w.env, "/api/session", { session: bob })).json()).user.invitedBy, null);
  w.db.prepare("DELETE FROM blocks").run();
  seedBan(w.db, w.id.bob);
  assert.ok(!(await list()).includes("bob"), "a banned new member's row hides");
  w.db.prepare("DELETE FROM bans WHERE user_id = ?").run(w.id.bob);
  assert.ok((await list()).includes("Your friend bob joined"), "read-time: the unban restores it");
});

test("nothing about invites is public: profiles and the export of others never show it", async () => {
  const w = await world();
  await claim(w.env, forgeSession(w.db, w.id.bob), "alice");
  for (const path of ["/api/users/bob", "/api/users/alice", "/api/users/" + w.id.bob + "/threads"]) {
    const text = await (await call(w.env, path)).text();
    assert.ok(!/invite/i.test(text), path);
  }
});
