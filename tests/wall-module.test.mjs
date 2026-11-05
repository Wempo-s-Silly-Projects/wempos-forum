// Profile wall (v4.0, owner's ask): module surface pin for api/wall.mjs —
// the read/create/pin dispatcher, the 280-char cap, and the pagination limit.
// The behavioral pins live elsewhere: the word filter and text auto-mod have
// their own suites; the pin guard's ownership check follows chat's handler
// shape.
import test from "node:test";
import assert from "node:assert/strict";
import * as wall from "../api/wall.mjs";

test("wall.mjs exports the dispatcher + caps", () => {
  assert.equal(typeof wall.handleWallRoutes, "function");
  assert.equal(wall.WALL_MAX_CHARS, 280);
  assert.equal(wall.WALL_PAGE_LIMIT, 50);
});

test("wall.mjs reads every route shape from the dispatcher without matching", async () => {
  const noMatch = async (path, method) =>
    wall.handleWallRoutes(new Request("http://x" + path, { method }), {}, new URL("http://x" + path), path, method, undefined);
  // None of these patterns claim the route — the dispatcher must pass through.
  assert.equal(await noMatch("/api/users/1/wall", "DELETE"), null);
  assert.equal(await noMatch("/api/users/abc/wall", "GET"), null);
  assert.equal(await noMatch("/api/wall/12", "POST"), null);
  assert.equal(await noMatch("/api/wall/12/pin", "PUT"), null);
});
