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

// The member-picked profile header (Batch I, migration 0084) rides every
// surface its sibling profile fields do: the owner's "Download my data"
// export carries their own pick, and /openapi.json documents it on the
// public User profile (which already serves it on visible profiles only).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, seedUser } from "./helpers/seed.mjs";
import { PROFILE_HEADER_STYLES } from "../constants.mjs";

async function member(env, username = "alice") {
  const id = await seedUser(env.__sqlite, { username });
  return { id, session: forgeSession(env.__sqlite, id) };
}

const putHeader = (env, session, style) =>
  call(env, "/api/me/profile-header", { method: "PUT", body: { style }, session });

const exportOf = async (env, session) =>
  (await call(env, "/api/me/export", { session })).json();

test("Download my data carries profileHeader: \"\" before a pick, the pick after, \"\" after clearing", async () => {
  const env = makeEnv();
  const alice = await member(env);
  assert.equal((await exportOf(env, alice.session)).profile.profileHeader, "");
  assert.equal((await putHeader(env, alice.session, "dots")).status, 200);
  assert.equal((await exportOf(env, alice.session)).profile.profileHeader, "dots");
  assert.equal((await putHeader(env, alice.session, "")).status, 200);
  assert.equal((await exportOf(env, alice.session)).profile.profileHeader, "");
});

test("the export holds only the caller's own header, never another member's", async () => {
  const env = makeEnv();
  const alice = await member(env, "alice");
  const bob = await member(env, "bob");
  await putHeader(env, bob.session, "grid");
  assert.equal((await exportOf(env, alice.session)).profile.profileHeader, "");
  assert.equal((await exportOf(env, bob.session)).profile.profileHeader, "grid");
});

test("/openapi.json documents profileHeader on the User schema with the whitelisted keys", async () => {
  const doc = await (await call(makeEnv(), "/openapi.json")).json();
  const field = doc.components.schemas.User.properties.profileHeader;
  assert.ok(field, "User.profileHeader is declared");
  assert.equal(field.type, "string");
  assert.deepEqual(field.enum, [...PROFILE_HEADER_STYLES]);
});

test("the public profile payload still serves profileHeader beside profileAccent", async () => {
  const env = makeEnv();
  const alice = await member(env);
  await putHeader(env, alice.session, "stripes");
  const body = await (await call(env, "/api/users/alice")).json();
  assert.equal(body.profileHeader, "stripes");
  assert.ok("profileAccent" in body);
});
