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

// Owner, Nov 21: QOTD is the owner's and admins' job ("there is only owner
// me and admins", "admins can do it to"). Only a QOTD written by an owner or
// admin becomes "Today's question"; a member's post that starts with "QOTD"
// stays an ordinary thread and never takes over the banner. Stored roles:
// the owner is stored as ROLE_OWNER_DB ("admin"), site admins as
// ROLE_ADMIN_DB ("moderator") — see api/core/roles.mjs.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, seedPost, seedUser } from "./helpers/seed.mjs";
import { ROLE_ADMIN_DB, ROLE_MEMBER_DB, ROLE_OWNER_DB } from "../api/core/roles.mjs";

let env;
let db;
const u = {};
const s = {};

before(async () => {
  env = makeEnv();
  db = env.__sqlite;
  for (const [name, role] of [["owner", ROLE_OWNER_DB], ["admin", ROLE_ADMIN_DB], ["member", ROLE_MEMBER_DB]]) {
    u[name] = await seedUser(db, { username: name, role });
    s[name] = forgeSession(db, u[name]);
  }
});

beforeEach(() => {
  db.prepare("DELETE FROM posts").run();
});

const qotd = async (who) => (await call(env, "/api/traditions/qotd", who ? { session: s[who] } : {})).json();

test("qotd staff-only: a member's QOTD post never becomes today's question", async () => {
  seedPost(db, { authorId: u.member, body: "QOTD: members can't set the banner" });
  for (const who of [null, "member", "admin", "owner"]) {
    assert.equal((await qotd(who)).qotd, null, String(who));
  }
});

test("qotd staff-only: owner and admin QOTDs both count, newest wins", async () => {
  const fromOwner = seedPost(db, { authorId: u.owner, body: "QOTD: from the owner" });
  assert.equal((await qotd(null)).qotd.id, fromOwner);
  const fromAdmin = seedPost(db, { authorId: u.admin, body: "QOTD: from an admin" });
  assert.equal((await qotd(null)).qotd.id, fromAdmin);
});

test("qotd staff-only: a newer member QOTD does not displace the staff one", async () => {
  const staff = seedPost(db, { authorId: u.admin, body: "QOTD: the real one" });
  seedPost(db, { authorId: u.member, body: "QOTD: an impostor" });
  assert.equal((await qotd(null)).qotd.id, staff);
  assert.equal((await qotd("member")).qotd.id, staff);
});
