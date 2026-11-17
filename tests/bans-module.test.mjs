// Copyright 2026 YourLocalGoober
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

// v4.0 plan 3, Task 3: the "who bans" module — active ban list, ban
// create/revoke (with the timed-ban duration validation and opt-in IP-ban
// rows), and the /api/admin/users/:id/bans mutation route. Moved verbatim
// from moderation.mjs; moderation.mjs re-exports createUserBan because
// worker.mjs imports it from there (surface unchanged).
import test from "node:test";
import assert from "node:assert/strict";
import * as bans from "../api/bans.mjs";

test("bans.mjs exports the ban surface", () => {
  for (const name of ["handleBanListRoute", "createUserBan", "revokeUserBan", "handleBanMutationRoute"]) {
    assert.equal(typeof bans[name], "function", `bans.mjs must export ${name}`);
  }
});

test("createUserBan validates the timed-ban duration with the exact 400", async () => {
  const env = { FILTERED_WORDS: "" };
  // A real Request so readJson's streaming body read works against the fake.
  const request = new Request("https://forum.test/api/admin/users/2/bans", {
    method: "POST",
    body: JSON.stringify({ reason: "x", expiresAt: 1 }),
    headers: { "content-type": "application/json" },
  });
  await assert.rejects(
    () => bans.createUserBan(null, 2, 1, request, env),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.message, "The ban duration must be between a minute and a year from now.");
      return true;
    },
  );
});
