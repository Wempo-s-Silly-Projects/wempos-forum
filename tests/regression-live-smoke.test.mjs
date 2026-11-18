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

// Regression pins for the two live deletion-adjacent bugs the live smoke
// test caught (2026-11-15): the archive deletedAt type guard demanded a
// string while the schema and every caller use epoch-seconds numbers (all
// author deletions 500'd before the batch ran), and resolveAvatarPending
// built its UPDATE statements without ever calling .run() (the moderation
// desk 409s forever and pending avatars can never be cleared).

import test from "node:test";
import assert from "node:assert/strict";

import { archivePostRowsStatement } from "../api/core/archive.mjs";
import { resolveAvatarPending } from "../api/avatars.mjs";

function fakeDb() {
  const calls = { prepared: 0, runs: 0, changes: 1 };
  const statement = {
    run() {
      calls.runs += 1;
      return Promise.resolve({ meta: { changes: calls.changes } });
    },
    bind() {
      return statement;
    },
  };
  return {
    calls,
    prepare() {
      calls.prepared += 1;
      return statement;
    },
  };
}

test("archivePostRowsStatement accepts an epoch-seconds deletedAt", () => {
  const db = fakeDb();
  const statement = archivePostRowsStatement(
    db,
    "WHERE p.id = ?",
    [4],
    "post-delete",
    1700000000,
    1,
    "wempo",
  );
  // The statement is a bindable/awaitable db.prepare result, not a throw.
  assert.ok(statement);
});

test("archivePostRowsStatement refuses non-epoch deletedAt shapes", () => {
  for (const bad of [null, "", "  ", -1, 0, 17.5, "1700000000"]) {
    assert.throws(
      () => archivePostRowsStatement(fakeDb(), "WHERE p.id = ?", [4], "post-delete", bad),
      TypeError,
    );
  }
});

test("resolveAvatarPending executes its approve UPDATE", async () => {
  const db = fakeDb();
  await resolveAvatarPending(db, 5, true, "version-1");
  assert.equal(db.calls.runs, 1, "the approve UPDATE must actually .run()");
});

test("resolveAvatarPending executes its reject UPDATE", async () => {
  const db = fakeDb();
  await resolveAvatarPending(db, 5, false);
  assert.equal(db.calls.runs, 1, "the reject UPDATE must actually .run()");
});

test("resolveAvatarPending 409s when nothing was pending (0 changes)", async () => {
  const db = fakeDb();
  db.calls.changes = 0;
  await assert.rejects(() => resolveAvatarPending(db, 5, true, "version-1"), (error) =>
    error?.message === "That avatar changed since it was reviewed — reload the desk and review the current upload.",
  );
  await assert.rejects(() => resolveAvatarPending(db, 5, false), (error) =>
    error?.message === "That avatar is not awaiting review.",
  );
});
