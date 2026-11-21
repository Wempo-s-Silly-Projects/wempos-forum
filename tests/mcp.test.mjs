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
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { ORIGIN, call, now, seedPost, seedUser, sha256 } from "./helpers/seed.mjs";
import worker from "../worker.mjs";
import { agentFromRequest } from "../api/core/agent-auth.mjs";

const TOKEN = "agent-token-for-tests-ABCDEFGHIJ0123456789";
const READ_TOOLS = ["search_posts", "recent_posts", "list_board", "get_post", "lobby_read"];
const STAFF_TOKEN = "staff-agent-token-for-tests-ZYXWVU9876543210";
const WRITE_TOOLS = ["create_post", "reply", "create_suggestion", "list_mentions", "lobby_post", "delete_own_post"];
const bodies = [];
let env;
let claudeId;
let aliceId;
let publicRoot;
let hiddenRoot;

before(async () => {
  env = makeEnv({ AGENT_TOKENS: JSON.stringify({ [sha256(TOKEN)]: "WemposClaude", [sha256(STAFF_TOKEN)]: "StaffBot" }) });
  const db = env.__sqlite;
  claudeId = await seedUser(db, { username: "WemposClaude" });
  aliceId = await seedUser(db, { username: "Alice" });
  await seedUser(db, { username: "StaffBot", role: "admin" });
  publicRoot = seedPost(db, { authorId: aliceId, body: "A public topic" });
  hiddenRoot = seedPost(db, { authorId: aliceId, body: "A hidden topic", visibility: "hidden" });
  // The filter list the way api/filterstore.mjs loads it: site_settings "filtered_words".
  db.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES ('filtered_words', 'frobnicate', ?)").run(now());
});

after(() => {
  for (const text of bodies) {
    assert.ok(!text.includes(TOKEN), "bearer token echoed in a response body");
    assert.ok(!text.includes(STAFF_TOKEN), "staff bearer token echoed in a response body");
  }
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

test("tools/list: 5 anonymous, 11 with a valid bearer, 5 with a wrong token", async () => {
  const names = async (token) => (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" }, { token })).json.result.tools.map((t) => t.name);
  assert.deepEqual(await names(null), READ_TOOLS);
  assert.deepEqual(await names(TOKEN), [...READ_TOOLS, ...WRITE_TOOLS]);
  assert.equal((await names(null)).length, 5);
  assert.equal((await names(TOKEN)).length, 11);
  assert.deepEqual(await names(TOKEN.replace("A", "B")), READ_TOOLS);
});

test("every write tool without a token answers -32001 and inserts nothing", async () => {
  const before = postCount();
  const args = { create_post: { board: "general", body: "x" }, reply: { post_id: publicRoot, body: "x" }, create_suggestion: { body: "x" }, list_mentions: {}, lobby_post: { body: "x" }, delete_own_post: { post_id: publicRoot } };
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

test("delete_own_post deletes the agent's own topic, cascades its replies, and archives both", async () => {
  const db = env.__sqlite;
  const own = seedPost(db, { authorId: claudeId, body: "agent topic to delete" });
  const reply = seedPost(db, { authorId: aliceId, body: "reply under agent topic", parentId: own });
  const result = await tool(40, "delete_own_post", { post_id: own }, TOKEN);
  assert.equal(result.json.result.isError, false, result.text);
  assert.deepEqual(toolData(result), { deleted: true, id: own });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM posts WHERE id IN (?, ?)").get(own, reply).n, 0);
  const archived = db.prepare(
    "SELECT original_post_id, deleted_because, deleted_by_user_id FROM post_archive WHERE original_post_id IN (?, ?) ORDER BY original_post_id",
  ).all(own, reply);
  assert.equal(archived.length, 2);
  for (const row of archived) {
    assert.equal(row.deleted_because, "post-delete");
    assert.equal(row.deleted_by_user_id, claudeId);
  }
});

test("delete_own_post refuses another member's post even for a staff agent", async () => {
  const before = postCount();
  const result = await tool(41, "delete_own_post", { post_id: publicRoot }, STAFF_TOKEN);
  assert.equal(result.json.result.isError, true);
  assert.equal(result.json.result.content[0].text, "Post not found or not yours.");
  assert.equal(postCount(), before);
  assert.ok(env.__sqlite.prepare("SELECT 1 FROM posts WHERE id = ?").get(publicRoot));
});

test("delete_own_post answers the same refusal for a missing post id", async () => {
  const result = await tool(42, "delete_own_post", { post_id: 987654 }, TOKEN);
  assert.equal(result.json.result.isError, true);
  assert.equal(result.json.result.content[0].text, "Post not found or not yours.");
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

// ---- security fixes: body cap, per-item read tier, token → user id ----

const MCP_MAX_BODY = 65536;
const CHUNK_BYTES = 16384;

test("an oversized streamed body is refused with 413 / -32600 without reading it all", async () => {
  const chunk = new Uint8Array(CHUNK_BYTES).fill(0x20);
  const totalChunks = 64; // 1 MiB on offer
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (pulled >= totalChunks) return controller.close();
      pulled++;
      controller.enqueue(chunk);
    },
  });
  const request = new Request(ORIGIN + "/mcp", { method: "POST", body: stream, duplex: "half" });
  const response = await worker.fetch(request, env, { waitUntil() {} });
  assert.equal(response.status, 413);
  const json = await response.json();
  assert.equal(json.error.code, -32600);
  assert.ok(pulled * CHUNK_BYTES <= MCP_MAX_BODY + 2 * CHUNK_BYTES, "pulled " + pulled + " chunks");
  assert.ok(pulled < totalChunks);
});

test("a declared Content-Length over the cap is refused with 413 before reading", async () => {
  const response = await call(env, "/mcp", {
    method: "POST",
    body: " ".repeat(MCP_MAX_BODY + 1),
    headers: { "Content-Type": "application/json", "Content-Length": String(MCP_MAX_BODY + 1) },
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, -32600);
});

function batchOf(count, name, args) {
  return Array.from({ length: count }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "tools/call", params: { name, arguments: args } }));
}

async function batchCall(targetEnv, messages, token = null) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const response = await call(targetEnv, "/mcp", { method: "POST", body: JSON.stringify(messages), headers });
  return response.json();
}

test("each read-tool call in a batch charges the read tier once (anonymous, per IP)", async () => {
  const { limiter, bindings } = makeLimiters();
  const counted = { ...env, ...bindings };
  const replies = await batchCall(counted, batchOf(3, "search_posts", { query: "public" }));
  assert.equal(replies.length, 3);
  assert.ok(replies.every((r) => r.result.isError === false));
  assert.equal(limiter.calls.length, 3);
  assert.equal(new Set(limiter.calls).size, 1, "all keyed to the same anonymous IP identity");
});

test("agent read calls charge the read tier per item, keyed by the agent id", async () => {
  const { limiter, bindings } = makeLimiters();
  const counted = { ...env, ...bindings };
  const replies = await batchCall(counted, [...batchOf(2, "recent_posts", {}), ...batchOf(1, "list_mentions", {})], TOKEN);
  assert.equal(replies.length, 3);
  assert.equal(limiter.calls.length, 3);
  const { limiter: anonLimiter, bindings: anonBindings } = makeLimiters();
  await batchCall({ ...env, ...anonBindings }, batchOf(1, "recent_posts", {}));
  assert.notEqual(anonLimiter.calls[0], limiter.calls[0], "agent key differs from the anonymous key");
});

test("an exhausted read tier answers a tool error per item and runs no query", async () => {
  const { bindings } = makeLimiters(false);
  const throttled = { ...env, ...bindings };
  const replies = await batchCall(throttled, batchOf(2, "get_post", { id: publicRoot }));
  assert.equal(replies.length, 2);
  for (const reply of replies) {
    assert.equal(reply.result.isError, true);
    assert.match(reply.result.content[0].text, /Too many requests/);
  }
});

const AUTH_TOKEN = "agent-token-for-auth-tests-0123456789ABCDEF";
const bearer = () => new Request(ORIGIN + "/mcp", { headers: { Authorization: "Bearer " + AUTH_TOKEN } });
const envMapping = (value) => ({ ...env, AGENT_TOKENS: JSON.stringify({ [sha256(AUTH_TOKEN)]: value }) });

test("AGENT_TOKENS resolves a numeric user id (number or digit string)", async () => {
  const asNumber = await agentFromRequest(bearer(), envMapping(claudeId));
  assert.equal(asNumber.id, claudeId);
  assert.equal(asNumber.username, "WemposClaude");
  const asString = await agentFromRequest(bearer(), envMapping(String(claudeId)));
  assert.equal(asString.id, claudeId);
});

test("AGENT_TOKENS legacy username form still resolves", async () => {
  const agent = await agentFromRequest(bearer(), envMapping("alice"));
  assert.equal(agent.id, aliceId);
});

test("AGENT_TOKENS rejects malformed values and unknown ids", async () => {
  assert.equal(await agentFromRequest(bearer(), envMapping(0)), null);
  assert.equal(await agentFromRequest(bearer(), envMapping(-3)), null);
  assert.equal(await agentFromRequest(bearer(), envMapping(1.5)), null);
  assert.equal(await agentFromRequest(bearer(), envMapping("")), null);
  assert.equal(await agentFromRequest(bearer(), envMapping(999999)), null);
});

test("an id-mapped token does NOT follow a freed and re-registered username", async () => {
  const db = env.__sqlite;
  const botId = await seedUser(db, { username: "RenameBot" });
  const byId = envMapping(botId);
  assert.equal((await agentFromRequest(bearer(), byId)).id, botId);
  db.prepare("UPDATE users SET username = ?, username_key = ? WHERE id = ?").run("Renamed" + botId, "renamed" + botId, botId);
  const strangerId = await seedUser(db, { username: "renamebot" });
  const after = await agentFromRequest(bearer(), byId);
  assert.equal(after.id, botId, "still the original account");
  assert.notEqual(after.id, strangerId);
  // The legacy username form is the one that would follow the name.
  assert.equal((await agentFromRequest(bearer(), envMapping("RenameBot"))).id, strangerId);
});

test("initialize instructions describe public reads + bot-only bearer writes", async () => {
  const { json } = await rpc({ jsonrpc: "2.0", id: 90, method: "initialize", params: {} });
  assert.doesNotMatch(json.result.instructions, /read-only/i);
  assert.match(json.result.instructions, /bearer token/);
  assert.match(json.result.instructions, /no public registration/);
});
