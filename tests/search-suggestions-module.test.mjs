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
