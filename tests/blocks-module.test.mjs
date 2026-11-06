// v4.4 member blocks: the core predicate/fragment pins, the canViewPost
// block behavior (member cut off both directions, staff bypass), and the
// route dispatcher's export surface. Everything here is pure SQL over a
// fake FORUM_DB — no real member data, per the repo's family-friendly rule.
import test from "node:test";
import assert from "node:assert/strict";
import * as blocksApi from "../api/blocks.mjs";
import {
  blockFilterSql,
  blockPairExists,
  blockedIdList,
  viewerBlockFilterSql,
} from "../api/core/blocks.mjs";
import { canViewPost } from "../api/core/visibility.mjs";

// Minimal FORUM_DB fake: prepare().bind(...).first()/all() over fixed rows.
// Queries are matched by their SQL text so each shape returns what the real
// D1 would for the recorded bindings.
function fakeDb(routes) {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          const run = routes.find((route) => route.test(sql)) ||
            { first: async () => null, all: async () => ({ results: [] }) };
          return typeof run.make === "function" ? run.make(values) : run;
        },
      };
    },
  };
}

const BLOCK_QUERY_TEST = (sql) => sql.includes("FROM blocks") && sql.includes("LIMIT 1");
const staffViewer = { id: 9, role: "admin" };
const memberViewer = { id: 1, role: "member" };

test("core/blocks.mjs exposes the pair predicate, fragments, and list", () => {
  assert.equal(typeof blockPairExists, "function");
  assert.equal(typeof blockedIdList, "function");
  assert.equal(typeof blockFilterSql, "function");
  assert.equal(typeof viewerBlockFilterSql, "function");
});

test("blockFilterSql hides the column from BOTH directions", () => {
  const fragment = blockFilterSql("p.author_id");
  assert.match(fragment, /p\.author_id NOT IN/);
  assert.match(fragment, /SELECT blocked_id FROM blocks WHERE blocker_id = \?/);
  assert.match(fragment, /SELECT blocker_id FROM blocks WHERE blocked_id = \?/);
});

test("viewerBlockFilterSql: guests and staff read empty, members get the fragment", () => {
  assert.equal(viewerBlockFilterSql(null, "author_id"), "");
  assert.equal(viewerBlockFilterSql({ id: 9, role: "owner" }, "author_id"), "");
  assert.equal(viewerBlockFilterSql({ id: 9, role: "admin" }, "author_id"), "");
  const member = viewerBlockFilterSql({ id: 1, role: "member" }, "author_id");
  assert.match(member, /author_id NOT IN/u);
});

test("blockPairExists finds a pair from either direction", async () => {
  const env = { FORUM_DB: fakeDb([
    { test: BLOCK_QUERY_TEST, first: async () => ({ "1": 1 }) },
  ]) };
  assert.equal(await blockPairExists(env, 1, 2), true);
  const noneEnv = { FORUM_DB: fakeDb([]) };
  assert.equal(await blockPairExists(noneEnv, 1, 2), false);
});

test("blockedIdList merges both directions", async () => {
  // The UNION covers blocker-side and blocked-side: one fixed fake answers
  // both rows regardless of binding — the pin is the merge, not the SQL text.
  const env = { FORUM_DB: fakeDb([
    { test: (sql) => sql.includes("UNION"), make: () => ({
      all: async () => ({ results: [{ id: 2 }, { id: 7 }] }) }),
    },
  ]) };
  assert.deepEqual(await blockedIdList(env, 1), [2, 7]);
});

test("canViewPost: a block pair 404s the post for a member viewer, staff bypass", async () => {
  const row = { id: 10, author_id: 2, parent_id: null, visibility: "public" };
  const env = { FORUM_DB: fakeDb([
    // bans (never), then the block pair (present), then ancestor reads.
    { test: (sql) => sql.includes("FROM bans"), first: async () => null },
    { test: BLOCK_QUERY_TEST, first: async () => ({ "1": 1 }) },
    { test: (sql) => sql.includes("FROM posts WHERE id"), first: async () => null },
  ]) };
  // Member viewer: pair hides the post (author blocked the viewer OR viewer
  // blocked the author — one row either way).
  assert.equal(await canViewPost(env, row, memberViewer), false);
  // Staff viewer bypasses blocks, like the ban check.
  assert.equal(await canViewPost(env, row, staffViewer), true);
});

test("canViewPost: no pair reads clean for a member viewer", async () => {
  const row = { id: 10, author_id: 2, parent_id: null, visibility: "public" };
  const env = { FORUM_DB: fakeDb([
    { test: (sql) => sql.includes("FROM bans"), first: async () => null },
  ]) };
  assert.equal(await canViewPost(env, row, memberViewer), true);
});

test("api/blocks.mjs exports the dispatcher", () => {
  assert.equal(typeof blocksApi.handleBlockRoutes, "function");
});
