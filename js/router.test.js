import test from "node:test";
import assert from "node:assert/strict";
import { routeForPath } from "./router.js";

test("routeForPath returns the home route without a query", () => {
  assert.deepEqual(routeForPath("/"), { name: "home" });
});

test("routeForPath trims a non-empty search query", () => {
  assert.deepEqual(routeForPath("/", "?q=%20polytoria%20"), {
    name: "search",
    query: "polytoria",
  });
});

test("routeForPath maps an empty search query to home", () => {
  assert.deepEqual(routeForPath("/", "?q=%20%20"), { name: "home" });
});

test("routeForPath recognizes setup and moderation pages", () => {
  assert.deepEqual(routeForPath("/setup"), { name: "setup" });
  assert.deepEqual(routeForPath("/admin/reports"), { name: "admin" });
});

test("routeForPath parses numeric post identifiers", () => {
  assert.deepEqual(routeForPath("/posts/42"), { name: "post", id: 42 });
  assert.deepEqual(routeForPath("/posts/nope"), { name: "not-found" });
});

test("routeForPath decodes profile usernames", () => {
  assert.deepEqual(routeForPath("/users/Wempo%2Dfan"), {
    name: "profile",
    username: "Wempo-fan",
  });
});

test("routeForPath maps malformed encoded usernames to not-found", () => {
  assert.doesNotThrow(() => {
    assert.deepEqual(routeForPath("/users/%E0%A4%A"), { name: "not-found" });
  });
});

test("routeForPath maps unrelated paths to not-found", () => {
  assert.deepEqual(routeForPath("/anything-else"), { name: "not-found" });
});
