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

// v4.31 group rename (wave 2026-11-21-26): PATCH /api/dm/groups/:id {name}.
// Only the creator (still a member) renames; other members get 403, an
// outsider the SAME 404 as a missing group, a guest 401, a cross-site or
// token-less write 403 (CSRF). The name rides the create path's intake: word
// filter, 60-char cap, and "" clears it back to the member-list title.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DM_GROUP_NAME_MAX_CHARS } from "../constants.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedUser } from "./helpers/seed.mjs";

let env;
let db;
const u = {};
const s = {};
const NAMES = ["alice", "bob", "carol", "dave"];
const SAME_ORIGIN = "https://wempos-forum.com";

before(async () => {
  env = makeEnv();
  db = env.__sqlite;
  for (const name of NAMES) {
    u[name] = await seedUser(db, { username: name });
    s[name] = forgeSession(db, u[name]);
  }
  // The filter list the way api/filterstore.mjs loads it (mcp.test.mjs idiom).
  db.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES ('filtered_words', 'badword', ?)").run(now());
});

beforeEach(() => {
  db.prepare("DELETE FROM bans").run();
  db.prepare("DELETE FROM dm_groups").run();
});

const createGroup = async () => {
  const response = await call(env, "/api/dm/groups",
    { method: "POST", body: { usernames: ["bob", "carol"], name: "Old name" }, session: s.alice });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).id;
};
const rename = (who, id, name) =>
  call(env, "/api/dm/groups/" + id, { method: "PATCH", body: { name }, session: s[who] });
const storedName = (id) => db.prepare("SELECT name FROM dm_groups WHERE id = ?").get(id)?.name;

test("the creator renames; the read and the stored row both carry the new name", async () => {
  const id = await createGroup();
  const response = await rename("alice", id, "  Movie night ");
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { ok: true, name: "Movie night" });
  assert.equal(storedName(id), "Movie night");
  const view = await (await call(env, "/api/dm/groups/" + id, { session: s.bob })).json();
  assert.equal(view.name, "Movie night");
});

test("a member who is not the creator gets 403 and the name is unchanged", async () => {
  const id = await createGroup();
  assert.equal((await rename("bob", id, "Hijacked")).status, 403);
  assert.equal(storedName(id), "Old name");
});

test("an outsider gets the same 404 as a missing group (no existence oracle)", async () => {
  const id = await createGroup();
  const outsider = await rename("dave", id, "Nope");
  const missing = await rename("dave", 999999, "Nope");
  assert.equal(outsider.status, 404);
  assert.equal(missing.status, 404);
  assert.equal((await outsider.json()).error, (await missing.json()).error);
  assert.equal(storedName(id), "Old name");
});

test("a guest gets 401; a write without the CSRF token or from another origin is refused", async () => {
  const id = await createGroup();
  const guest = await call(env, "/api/dm/groups/" + id,
    { method: "PATCH", body: { name: "x" }, headers: { Origin: SAME_ORIGIN } });
  assert.equal(guest.status, 401);
  const noToken = await call(env, "/api/dm/groups/" + id, {
    method: "PATCH", body: { name: "x" },
    headers: { Cookie: s.alice.cookie, Origin: SAME_ORIGIN },
  });
  assert.equal(noToken.status, 403);
  const crossSite = await call(env, "/api/dm/groups/" + id, {
    method: "PATCH", body: { name: "x" },
    headers: { Cookie: s.alice.cookie, Origin: "https://evil.example", "X-CSRF-Token": s.alice.csrf },
  });
  assert.equal(crossSite.status, 403);
  assert.equal(storedName(id), "Old name");
});

test("a banned creator is refused, and a creator who left can no longer rename (404)", async () => {
  const id = await createGroup();
  seedBan(db, u.alice, null);
  assert.equal((await rename("alice", id, "Banned rename")).status, 403);
  assert.equal(storedName(id), "Old name");
  db.prepare("DELETE FROM bans").run();
  const left = await call(env, "/api/dm/groups/" + id + "/leave", { method: "POST", session: s.alice });
  assert.equal(left.status, 200);
  assert.equal((await rename("alice", id, "Ghost rename")).status, 404);
  assert.equal(storedName(id), "Old name");
});

test("the intake: word filter applies, over-long names are refused, an empty name clears", async () => {
  const id = await createGroup();
  assert.equal((await rename("alice", id, "the badword club")).status, 200);
  assert.doesNotMatch(storedName(id), /badword/i);
  assert.equal((await rename("alice", id, "x".repeat(DM_GROUP_NAME_MAX_CHARS + 1))).status, 400);
  assert.equal((await rename("alice", id, "x".repeat(DM_GROUP_NAME_MAX_CHARS))).status, 200);
  assert.equal((await rename("alice", id, "")).status, 200);
  assert.equal(storedName(id), "");
  assert.equal((await rename("alice", id, 42)).status, 400, "a non-string name is refused");
});
