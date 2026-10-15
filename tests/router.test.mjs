import test from "node:test";
import assert from "node:assert/strict";
import { isPlainLeftClick } from "../public/js/router.js";

test("only unmodified primary clicks become internal navigation", () => {
  assert.equal(isPlainLeftClick({ button: 0 }), true);
  assert.equal(isPlainLeftClick({ button: 1 }), false);
  assert.equal(isPlainLeftClick({ button: 2 }), false);
  assert.equal(isPlainLeftClick({ button: 0, metaKey: true }), false);
  assert.equal(isPlainLeftClick({ button: 0, ctrlKey: true }), false);
  assert.equal(isPlainLeftClick({ button: 0, shiftKey: true }), false);
  assert.equal(isPlainLeftClick({ button: 0, altKey: true }), false);
});