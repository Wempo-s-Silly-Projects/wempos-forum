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

// v4.0 plan 2, Task 6: search and suggestion-status split out of the posts
// composer. SUGGESTION_SCORE_SQL's home was resolved to boards.mjs at Task 2
// (ledger) — suggestions.mjs consumes only the board constants, so nothing
// moves between them. This pin holds both modules' export surfaces steady.
import test from "node:test";
import assert from "node:assert/strict";
import * as search from "../api/search.mjs";
import * as suggestions from "../api/suggestions.mjs";

test("search.mjs exports the search surface", () => {
  for (const name of ["handleSearchRoute", "searchReplies", "threadRootId"]) {
    assert.equal(typeof search[name], "function", `search.mjs must export ${name}`);
  }
});

test("suggestions.mjs exports the suggestion-status handler", () => {
  assert.equal(typeof suggestions.handleSuggestionStatusRoute, "function");
});
