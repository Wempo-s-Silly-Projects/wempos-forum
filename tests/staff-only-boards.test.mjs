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

// v5.15: the owner's Polls board is staff-only like Updates. Everyone reads
// and replies; only the owner (stored "admin") and admins (stored
// "moderator", see api/core/roles.mjs) start topics. Both topic-creating
// paths — POST /api/posts and the MCP create_post tool — share one gate,
// isStaffOnlyBoard() in api/boards.mjs.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, seedPost, seedUser, sha256 } from "./helpers/seed.mjs";
import { BOARD_VALUES, isStaffOnlyBoard } from "../api/boards.mjs";
import { ROLE_ADMIN_DB, ROLE_MEMBER_DB, ROLE_OWNER_DB } from "../api/core/roles.mjs";

const TOKEN = "staff-only-boards-agent-token-ABCDEFGHIJ0123";
const TURNSTILE_HOST = "wempos-forum.com";
const realFetch = globalThis.fetch;
let env;
let db;
const u = {};
const s = {};

before(async () => {
  env = makeEnv({
    AGENT_TOKENS: JSON.stringify({ [sha256(TOKEN)]: "AgentMember" }),
    TURNSTILE_SECRET: "test-turnstile-secret",
    TURNSTILE_HOSTNAMES: TURNSTILE_HOST,
  });
  db = env.__sqlite;
  for (const [name, role] of [["owner", ROLE_OWNER_DB], ["admin", ROLE_ADMIN_DB], ["member", ROLE_MEMBER_DB]]) {
    u[name] = await seedUser(db, { username: name, role });
    s[name] = forgeSession(db, u[name]);
  }
  await seedUser(db, { username: "AgentMember" });
  // Siteverify stub: the token names the action it verifies ("post"/"reply"),
  // so a request only passes Turnstile for the route it was sent to.
  globalThis.fetch = async (url, init) => {
    const token = new URLSearchParams(String(init?.body || "")).get("response");
    return new Response(JSON.stringify({ success: true, action: token, hostname: TURNSTILE_HOST }),
      { headers: { "Content-Type": "application/json" } });
  };
});

after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  db.prepare("DELETE FROM posts").run();
});

const postCount = () => db.prepare("SELECT COUNT(*) AS n FROM posts").get().n;
const startTopic = (who, board) => call(env, "/api/posts", {
  method: "POST",
  session: s[who],
  body: { body: "Which feature next?", board, "cf-turnstile-response": "post" },
});
const mcpCreatePost = async (board) => {
  const response = await call(env, "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_post", arguments: { board, body: "a poll" } } }),
  });
  return response.json();
};

test("isStaffOnlyBoard: true for updates and polls only", () => {
  assert.equal(isStaffOnlyBoard("updates"), true);
  assert.equal(isStaffOnlyBoard("polls"), true);
  for (const board of ["general", "suggestions", "game-dev", "showcase", "help"]) {
    assert.equal(isStaffOnlyBoard(board), false, board);
  }
  assert.ok(BOARD_VALUES.includes("polls"));
});

test("polls: a member cannot start a topic over HTTP (403, zero inserts)", async () => {
  const response = await startTopic("member", "polls");
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /Only admins can start topics on this board/);
  assert.equal(postCount(), 0);
});

test("polls: the owner and an admin can start a topic over HTTP", async () => {
  for (const who of ["owner", "admin"]) {
    const response = await startTopic(who, "polls");
    assert.equal(response.status, 201, who + ": " + (await response.clone().text()));
    const { id } = await response.json();
    const row = db.prepare("SELECT board, author_id, parent_id FROM posts WHERE id = ?").get(id);
    assert.deepEqual({ ...row }, { board: "polls", author_id: u[who], parent_id: null });
  }
});

test("polls: a member can still start a topic on an open board", async () => {
  const response = await startTopic("member", "general");
  assert.equal(response.status, 201, await response.clone().text());
});

test("polls: a member can reply in a Polls topic", async () => {
  const root = seedPost(db, { authorId: u.admin, body: "Poll: dark mode?", board: "polls" });
  const response = await call(env, `/api/posts/${root}/replies`, {
    method: "POST",
    session: s.member,
    body: { body: "Yes please", "cf-turnstile-response": "reply" },
  });
  assert.equal(response.status, 201, await response.clone().text());
  const row = db.prepare("SELECT parent_id, author_id FROM posts WHERE author_id = ?").get(u.member);
  assert.deepEqual({ ...row }, { parent_id: root, author_id: u.member });
});

test("polls: a member agent's MCP create_post is refused with zero inserts", async () => {
  const reply = await mcpCreatePost("polls");
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /Only admins can start topics on this board/);
  assert.equal(postCount(), 0);
});
