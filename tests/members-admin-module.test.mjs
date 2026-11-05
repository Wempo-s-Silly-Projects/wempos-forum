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
