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

// Wave 2026-11-21-39 F1 — Who's Online vs active bans. The lobby count drops
// actively-banned members at read time; the GET /api/presence roster (which
// guests read, and which who-online-groups.js documents as "already without
// banned members") must drop them too. Expired/revoked bans don't count, and
// an unban restores the name with no write.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedUser } from "./helpers/seed.mjs";

async function world() {
  const env = makeEnv();
  const db = env.__sqlite;
  const alice = await seedUser(db, { username: "alice" });
  const banned = await seedUser(db, { username: "banned" });
  const expired = await seedUser(db, { username: "expired" });
  const boss = await seedUser(db, { username: "boss", role: "admin" });
  const hiddenBoss = await seedUser(db, { username: "hiddenboss", role: "moderator" });
  const insert = db.prepare("INSERT INTO presence (user_id, last_seen, invisible) VALUES (?, ?, ?)");
  for (const id of [alice, banned, expired, boss]) insert.run(id, now(), 0);
  insert.run(hiddenBoss, now(), 1);
  seedBan(db, banned);
  seedBan(db, expired, -60);
  return { env, db, alice, banned };
}

const roster = async (env, session) => {
  const res = await call(env, "/api/presence", session ? { session } : undefined);
  assert.equal(res.status, 200);
  return (await res.json()).online;
};

test("presence roster: an actively-banned member is never listed (guest and member reads)", async () => {
  const { env, db, alice } = await world();
  for (const session of [null, forgeSession(db, alice)]) {
    const names = (await roster(env, session)).map((row) => row.username).sort();
    assert.deepEqual(names, ["alice", "boss", "expired"]);
  }
});

test("presence roster: invisible staff stay unlisted; staff carry the public role label", async () => {
  const { env } = await world();
  const online = await roster(env);
  assert.equal(online.find((row) => row.username === "hiddenboss"), undefined);
  assert.equal(online.find((row) => row.username === "boss").role, "owner");
});

test("presence roster: revoking the ban restores the name with no presence write", async () => {
  const { env, db, banned } = await world();
  db.prepare("UPDATE bans SET revoked_at = ? WHERE user_id = ?").run(now(), banned);
  const names = (await roster(env)).map((row) => row.username);
  assert.ok(names.includes("banned"));
});
