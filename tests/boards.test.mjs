// Board vocabulary (v4.0 plan 2, Task 2): the category whitelist is the
// feed gate — every board value the API accepts lives here, and unknown
// values 400 before any SQL. These tests pin the exact whitelist ORDER
// (the create form derives its select options from it) and boardField's
// three faces: absent/empty defaults to 'general', whitelisted strings
// pass through unchanged, anything else throws the exact 400.
import test from "node:test";
import assert from "node:assert/strict";
import {
  BOARD_VALUES,
  GENERAL_BOARD_DEFAULT,
  SUGGESTIONS_BOARD,
  UPDATES_BOARD,
  boardField,
} from "../api/boards.mjs";

test("the whitelist carries the exact six categories in form order", () => {
  assert.deepEqual(BOARD_VALUES, ["general", "suggestions", "game-dev", "showcase", "help", "updates"]);
});

test("the named constants are the whitelist members other routes branch on", () => {
  assert.equal(GENERAL_BOARD_DEFAULT, "general");
  assert.equal(SUGGESTIONS_BOARD, "suggestions");
  assert.equal(UPDATES_BOARD, "updates");
});

test("boardField: absent or empty defaults to general", () => {
  assert.equal(boardField(undefined), "general");
  assert.equal(boardField(null), "general");
  assert.equal(boardField(""), "general");
});

test("boardField: whitelisted strings pass through unchanged", () => {
  for (const value of BOARD_VALUES) assert.equal(boardField(value), value);
});

test("boardField: unknown values throw the exact 400", () => {
  for (const value of ["blog", "General", "game dev", "general ", 1, true]) {
    assert.throws(() => boardField(value), (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.message, "That board is not available.");
      return true;
    });
  }
});
