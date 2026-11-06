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

// Wall-read route pins (v4.4): the owner's wall refuses block pairs for
// member viewers, staff reads bypass, and rows by a pair-paired AUTHOR drop
// from an otherwise-viewable wall. All through the fake FORUM_DB above —
// no real member data.
import { handleWallRoutes } from "../api/wall.mjs";

const WALL_TOKEN = "w".repeat(43); // matches readSession's 40-50 char format
function wallRequest() {
  return new Request("http://x/api/users/2/wall", {
    headers: { cookie: "wempo_session=" + WALL_TOKEN },
  });
}
function wallEnv({ sessionId = null, dbRole = "member", pairRow = false, capture = null } = {}) {
  return { FORUM_DB: {
    prepare(sql) {
      if (capture) capture.push(sql);
      return { bind: () => ({
        first: async () => {
          if (sql.includes("FROM sessions")) return sessionId && {
            token_hash: "h", user_id: sessionId, csrf_token: "c", expires_at: 99999999999,
            username: "paircheck", role: dbRole, bio: "", avatar_status: null,
            avatar_mime: null, avatar_updated_at: null, avatar_version: null, totp_enabled: 0,
          };
          if (sql.includes("FROM blocks WHERE")) return pairRow ? { 1: 1 } : null;
          return null;
        },
        all: async () => ({ results: [] }),
      }) };
    },
  } };
}

test("wall read: an active pair 403s a member viewer", async () => {
  // The handler throws HttpError(403); the worker entry converts it.
  await assert.rejects(
    handleWallRoutes(wallRequest(), wallEnv({ sessionId: 1, pairRow: true }),
      new URL("http://x/api/users/2/wall"), "/api/users/2/wall", "GET", undefined),
    (error) => error.status === 403,
  );
});

test("wall read: staff bypasses the pair (desk reads never break)", async () => {
  const response = await handleWallRoutes(wallRequest(),
    wallEnv({ sessionId: 2, dbRole: "admin", pairRow: true }),
    new URL("http://x/api/users/2/wall"), "/api/users/2/wall", "GET", undefined);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { wall: [] });
});

test("wall read: a member's page filters pair-paired AUTHORS off the wall", async () => {
  const capture = [];
  await handleWallRoutes(wallRequest(), wallEnv({ sessionId: 1, capture }),
    new URL("http://x/api/users/2/wall"), "/api/users/2/wall", "GET", undefined);
  const wallSql = capture.find((sql) => sql.includes("FROM wall_posts"));
  assert.match(wallSql, /FROM blocks bk/u);
});

test("wall read: guests and staff never carry the author block filter", async () => {
  const capture = [];
  // Guest: sessionId null makes readSession null.
  await handleWallRoutes(new Request("http://x/api/users/2/wall"), wallEnv({ capture }),
    new URL("http://x/api/users/2/wall"), "/api/users/2/wall", "GET", undefined);
  const guestSql = capture.find((sql) => sql.includes("FROM wall_posts"));
  assert.doesNotMatch(guestSql, /FROM blocks bk/u);
  const staffCapture = [];
  await handleWallRoutes(wallRequest(), wallEnv({ sessionId: 2, dbRole: "admin", capture: staffCapture }),
    new URL("http://x/api/users/2/wall"), "/api/users/2/wall", "GET", undefined);
  const staffSql = staffCapture.find((sql) => sql.includes("FROM wall_posts"));
  assert.doesNotMatch(staffSql, /FROM blocks bk/u);
});
