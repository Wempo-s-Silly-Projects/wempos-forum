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

// v4.0 plan 2, Task 4: the reply routes (read page + reply creation) live in
// api/replies.mjs. It draws its decorations from posts-feed.mjs (the Task-3
// seam: listReplies, attachSubReplyCounts) and its shared creation plumbing
// from posts-write.mjs (the Task-5 ruling: idempotency family, staged
// persistence, staged persistence). This pin holds the module's
// export surface steady.
import test from "node:test";
import assert from "node:assert/strict";
import * as replies from "../api/replies.mjs";

test("replies.mjs exports the reply route handlers", () => {
  for (const name of ["handleRepliesReadRoute", "handleReplyCreateRoute"]) {
    assert.equal(typeof replies[name], "function", `replies.mjs must export ${name}`);
  }
});
