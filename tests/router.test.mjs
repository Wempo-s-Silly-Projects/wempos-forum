import test from "node:test";
import assert from "node:assert/strict";
import { isPlainLeftClick, routeForPath } from "../public/js/router.js";

test("only unmodified primary clicks become internal navigation", () => {
  assert.equal(isPlainLeftClick({ button: 0 }), true);
  assert.equal(isPlainLeftClick({ button: 1 }), false);
  assert.equal(isPlainLeftClick({ button: 2 }), false);
  assert.equal(isPlainLeftClick({ button: 0, metaKey: true }), false);
  assert.equal(isPlainLeftClick({ button: 0, ctrlKey: true }), false);
  assert.equal(isPlainLeftClick({ button: 0, shiftKey: true }), false);
  assert.equal(isPlainLeftClick({ button: 0, altKey: true }), false);
});

// Suggestions board (v2.4.1): the /suggestions path registers its own route
// while every existing path resolves exactly as before.
test("the router registry resolves /suggestions and leaves existing routes intact", () => {
  assert.deepEqual(routeForPath("/suggestions"), { name: "suggestions" });
  assert.deepEqual(routeForPath("/suggestions/extra"), { name: "not-found" });
  assert.deepEqual(routeForPath("/"), { name: "home" });
  assert.deepEqual(routeForPath("/posts/12"), { name: "post", id: 12 });
  assert.deepEqual(routeForPath("/users/wempo"), { name: "profile", username: "wempo" });
  assert.deepEqual(routeForPath("/notifications"), { name: "notifications" });
  assert.deepEqual(routeForPath("/admin/reports"), { name: "admin" });
});