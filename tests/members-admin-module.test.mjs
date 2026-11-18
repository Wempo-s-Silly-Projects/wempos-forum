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

// v4.0 plan 3, Task 5: the "who manages roles" module — promote/demote
// (owner-only gate) and the member search that feeds the desk's unban flow.
// Moved verbatim from moderation.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import * as members from "../api/members-admin.mjs";

test("members-admin.mjs exports the role-admin surface", () => {
  for (const name of ["handleRoleChangeRoute", "handleMemberSearchRoute", "ROLE_CHANGE_ADMIN_403", "ROLE_UNCHANGED_409"]) {
    assert.ok(members[name] !== undefined, `members-admin.mjs must export ${name}`);
  }
  assert.equal(members.ROLE_CHANGE_ADMIN_403, "Owner accounts cannot be modified here.");
  assert.equal(members.ROLE_UNCHANGED_409, "That member already has this role.");
});
