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

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { call, now, seedPost, seedUser, sha256 } from "./helpers/seed.mjs";

const TOKEN = "agent-token-for-tests-ABCDEFGHIJ0123456789";
const READ_TOOLS = ["search_posts", "recent_posts", "list_board", "get_post", "lobby_read"];
const WRITE_TOOLS = ["create_post", "reply", "create_suggestion", "list_mentions", "lobby_post"];
const bodies = [];
let env;
let claudeId;
let aliceId;
let publicRoot;
let hiddenRoot;

before(async () => {
  env = makeEnv({ AGENT_TOKENS: JSON.stringify({ [sha256(TOKEN)]: "WemposClaude" }) });
  const db = env.__sqlite;
  claudeId = await seedUser(db, { username: "WemposClaude" });
  aliceId = await seedUser(db, { username: "Alice" });
  publicRoot = seedPost(db, { authorId: aliceId, body: "A public topic" });
  hiddenRoot = seedPost(db, { authorId: aliceId, body: "A hidden topic", visibility: "hidden" });
  // The filter list the way api/filterstore.mjs loads it: site_settings "filtered_words".
  db.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES ('filtered_words', 'frobnicate', ?)").run(now());
});

after(() => {
  for (const text of bodies) assert.ok(!text.includes(TOKEN), "bearer token echoed in a response body");
});

async function rpc(message, { token = null, raw = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const response = await call(env, "/mcp", { method: "POST", body: raw ? message : JSON.stringify(message), headers });
  const text = await response.text();
  bodies.push(text);
  return { status: response.status, text, json: text ? JSON.parse(text) : null };
}

const tool = (id, name, args, token) => rpc({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, { token });
const postCount = () => env.__sqlite.prepare("SELECT COUNT(*) AS n FROM posts").get().n;
const toolData = (reply) => JSON.parse(reply.json.result.content[0].text);

test("initialize answers the protocol shape", async () => {
  const { status, json } = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
  assert.equal(status, 200);
  assert.equal(json.jsonrpc, "2.0");
  assert.equal(json.id, 1);
  assert.equal(json.result.protocolVersion, "2025-03-26");
  assert.equal(json.result.serverInfo.name, "wempos-forum");
  assert.equal(json.result.serverInfo.version, "9.9.9-test");
  assert.deepEqual(json.result.capabilities, { tools: { listChanged: false } });
});

test("initialize falls back to the default protocol version for an unknown one", async () => {
  const { json } = await rpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal(json.result.protocolVersion, "2025-06-18");
});

test("tools/list: 5 anonymous, 10 with a valid bearer, 5 with a wrong token", async () => {
  const names = async (token) => (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" }, { token })).json.result.tools.map((t) => t.name);
  assert.deepEqual(await names(null), READ_TOOLS);
  assert.deepEqual(await names(TOKEN), [...READ_TOOLS, ...WRITE_TOOLS]);
  assert.deepEqual(await names(TOKEN.replace("A", "B")), READ_TOOLS);
});

test("every write tool without a token answers -32001 and inserts nothing", async () => {
  const before = postCount();
  const args = { create_post: { board: "general", body: "x" }, reply: { post_id: publicRoot, body: "x" }, create_suggestion: { body: "x" }, list_mentions: {}, lobby_post: { body: "x" } };
  for (const name of WRITE_TOOLS) {
    for (const token of [null, "wrong-token-but-long-enough-1234"]) {
      const { json } = await tool(10, name, args[name], token);
      assert.equal(json.error?.code, -32001, name);
    }
  }
  assert.equal(postCount(), before);
});

test("create_post writes as the agent user, word filter masks", async () => {
  const reply = await tool(20, "create_post", { board: "general", body: "Hello frobnicate world" }, TOKEN);
  assert.equal(reply.json.result.isError, false, reply.text);
  const data = toolData(reply);
  assert.equal(data.board, "general");
  const row = env.__sqlite.prepare("SELECT author_id, body, visibility, parent_id FROM posts WHERE id = ?").get(data.id);
  assert.equal(row.author_id, claudeId);
  assert.equal(row.visibility, "public");
  assert.equal(row.parent_id, null);
  assert.doesNotMatch(row.body, /frobnicate/i);
  assert.match(row.body, /^Hello .+ world$/);
});

test("create_post refuses the staff-only updates board for a member agent", async () => {
  const before = postCount();
  const reply = await tool(21, "create_post", { board: "updates", body: "announcement" }, TOKEN);
  assert.equal(reply.json.result.isError, true);
  assert.equal(postCount(), before);
});

test("reply to a public post lands; reply to a hidden post is refused with zero inserts", async () => {
  const ok = await tool(30, "reply", { post_id: publicRoot, body: "agent reply" }, TOKEN);
  assert.equal(ok.json.result.isError, false, ok.text);
  const replyRow = env.__sqlite.prepare("SELECT author_id, parent_id FROM posts WHERE id = ?").get(toolData(ok).id);
  assert.deepEqual({ ...replyRow }, { author_id: claudeId, parent_id: publicRoot });

  const before = postCount();
  const refused = await tool(31, "reply", { post_id: hiddenRoot, body: "should not land" }, TOKEN);
  assert.equal(refused.json.result.isError, true);
  assert.equal(postCount(), before);
});

test("create_suggestion lands on the suggestions board", async () => {
  const reply = await tool(40, "create_suggestion", { body: "Add dark mode" }, TOKEN);
  assert.equal(reply.json.result.isError, false, reply.text);
  const row = env.__sqlite.prepare("SELECT board, author_id FROM posts WHERE id = ?").get(toolData(reply).id);
  assert.equal(row.board, "suggestions");
  assert.equal(row.author_id, claudeId);
});

test("list_mentions returns a seeded mention and mark_read marks it", async () => {
  const db = env.__sqlite;
  const mentionPost = seedPost(db, { authorId: aliceId, body: "hey @WemposClaude look", parentId: publicRoot });
  const info = db.prepare("INSERT INTO notifications (user_id, target_post_id, reply_id, created_at) VALUES (?, ?, ?, ?)")
    .run(claudeId, publicRoot, mentionPost, now());
  const notificationId = Number(info.lastInsertRowid);

  const first = toolData(await tool(50, "list_mentions", {}, TOKEN));
  const mention = first.mentions.find((m) => m.id === notificationId);
  assert.ok(mention, "seeded mention listed");
  assert.equal(mention.author, "Alice");
  assert.equal(mention.post_id, mentionPost);
  assert.equal(mention.read, false);
  assert.equal(first.marked_read, 0);

  const marked = toolData(await tool(51, "list_mentions", { mark_read: true }, TOKEN));
  assert.ok(marked.marked_read >= 1);
  assert.notEqual(db.prepare("SELECT read_at FROM notifications WHERE id = ?").get(notificationId).read_at, null);
  const again = toolData(await tool(52, "list_mentions", {}, TOKEN));
  assert.equal(again.mentions.find((m) => m.id === notificationId).read, true);
});

test("notifications (no id) answer 202 with no body", async () => {
  const { status, text } = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(status, 202);
  assert.equal(text, "");
});

test("GET /mcp answers 405", async () => {
  const response = await call(env, "/mcp");
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "POST");
});

test("garbage body answers -32700", async () => {
  const { json } = await rpc("{not json", { raw: true });
  assert.equal(json.error.code, -32700);
  assert.equal(json.id, null);
});

test("read tools never surface hidden content", async () => {
  const recent = toolData(await tool(60, "recent_posts", {}, null));
  assert.ok(recent.some((p) => p.id === publicRoot));
  assert.ok(!recent.some((p) => p.id === hiddenRoot));
  const hidden = await tool(61, "get_post", { id: hiddenRoot }, null);
  assert.equal(hidden.json.result.isError, true);
});
