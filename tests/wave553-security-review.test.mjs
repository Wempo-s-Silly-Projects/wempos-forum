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

// Wave 5.53 security review of v5.49-v5.52 (docs/security-reviews/
// 2026-11-22-v5.49-v5.52.md). Pins that lock verified behaviour: the 423
// lock refusal never answers before the visibility checks (no oracle on a
// hidden, banned-author or block-paired thread, web and MCP); the TL;DR
// read's 404 is byte-identical for every refusal; the TL;DR SELECT binds
// exactly what its placeholders ask for (guest/staff 2, member 4); the lock
// reason and the TL;DR refuse the same character set (one shared
// isRefusedChar); and the export carries no thread-lock section (O9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedPost, seedUser, sha256 } from "./helpers/seed.mjs";
import { lockReason } from "../api/thread-locks.mjs";
import { summaryBody } from "../api/thread-summaries.mjs";
import { D1_MAX_BOUND_PARAMS } from "../constants.mjs";

const AGENT_TOKEN = "w553-agent-token-0123456789abcdefghijklmn";
const REASON_NEEDLE = "W553LOCKREASON";

async function world() {
  const env = makeEnv({ AGENT_TOKENS: JSON.stringify({ [sha256(AGENT_TOKEN)]: "bob" }) });
  const db = env.__sqlite;
  const id = {};
  for (const [name, role] of [["boss", "admin"], ["alice", "member"], ["bob", "member"], ["carol", "member"]]) {
    id[name] = await seedUser(db, { username: name, role });
  }
  const session = (name) => forgeSession(db, id[name]);
  return { env, db, id, session };
}
const lock = (w, postId) => w.db.prepare(
  "INSERT INTO thread_locks (post_id, locked_by, reason, locked_at) VALUES (?, ?, ?, ?)").run(postId, w.id.boss, REASON_NEEDLE, now());
const unlock = (w, postId) => w.db.prepare("DELETE FROM thread_locks WHERE post_id = ?").run(postId);
const block = (w, blocker, blocked) => w.db.prepare(
  "INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(blocker, blocked, now());
const webReply = async (w, postId) => {
  const res = await call(w.env, "/api/posts/" + postId + "/replies", {
    method: "POST", body: { body: "w553 reply attempt" }, session: w.session("bob"),
  });
  return { status: res.status, text: await res.text() };
};
const mcpReply = async (w, postId) => {
  const res = await call(w.env, "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + AGENT_TOKEN },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "reply", arguments: { post_id: postId, body: "w553 agent attempt" } },
    }),
  });
  const { result } = await res.json();
  return { isError: result.isError, text: result.content[0].text };
};

test("a lock never answers before visibility: hidden, banned-author and block-paired threads refuse the same way locked or not (web + MCP)", async () => {
  const w = await world();
  const hidden = seedPost(w.db, { authorId: w.id.alice, body: "hidden root", visibility: "hidden" });
  const banned = seedPost(w.db, { authorId: w.id.carol, body: "banned author root" });
  const blocked = seedPost(w.db, { authorId: w.id.alice, body: "block-paired root" });
  const blockedReply = seedPost(w.db, { authorId: w.id.alice, body: "level 1 under the block pair", parentId: blocked });
  seedBan(w.db, w.id.carol);
  block(w, w.id.alice, w.id.bob); // alice blocks bob: bob must learn nothing about alice's thread
  for (const postId of [hidden, banned, blocked, blockedReply]) {
    const rootId = postId === blockedReply ? blocked : postId;
    const openWeb = await webReply(w, postId);
    const openMcp = await mcpReply(w, postId);
    lock(w, rootId);
    const lockedWeb = await webReply(w, postId);
    const lockedMcp = await mcpReply(w, postId);
    unlock(w, rootId);
    assert.notEqual(lockedWeb.status, 423, "web " + postId);
    assert.deepEqual(lockedWeb, openWeb, "web refusal identical locked or not " + postId);
    assert.deepEqual(lockedMcp, openMcp, "MCP refusal identical locked or not " + postId);
    assert.equal(lockedMcp.isError, true);
    assert.doesNotMatch(lockedWeb.text + lockedMcp.text, new RegExp(REASON_NEEDLE + "|locked", "i"));
  }
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM posts WHERE body LIKE 'w553%'").get().n, 0, "nothing written");
});

test("TL;DR read: missing id, hidden root, banned-author root, block pair (both ways) and a reply id answer one byte-identical 404", async () => {
  const w = await world();
  const write = (postId) => w.db.prepare(
    "INSERT INTO thread_summaries (post_id, body, updated_by, updated_at) VALUES (?, ?, ?, ?)").run(postId, "W553SUMTXT", w.id.boss, now());
  const hidden = seedPost(w.db, { authorId: w.id.alice, body: "hidden", visibility: "hidden" });
  const banned = seedPost(w.db, { authorId: w.id.carol, body: "carol root" });
  const aliceRoot = seedPost(w.db, { authorId: w.id.alice, body: "alice root" });
  const bobRoot = seedPost(w.db, { authorId: w.id.bob, body: "bob root" });
  const reply = seedPost(w.db, { authorId: w.id.carol, body: "a reply", parentId: aliceRoot });
  for (const postId of [hidden, banned, aliceRoot, bobRoot]) write(postId);
  seedBan(w.db, w.id.carol);
  block(w, w.id.bob, w.id.alice);
  const get = async (who, postId) => {
    const res = await call(w.env, "/api/posts/" + postId + "/summary", who ? { session: w.session(who) } : {});
    return { status: res.status, text: await res.text() };
  };
  const baseline = await get("bob", 999999);
  assert.equal(baseline.status, 404);
  const cases = [
    ["bob", hidden], ["bob", banned], ["bob", aliceRoot], ["alice", bobRoot], ["bob", reply],
    [null, hidden], [null, banned], [null, reply],
  ];
  for (const [who, postId] of cases) {
    assert.deepEqual(await get(who, postId), baseline, (who || "guest") + " " + postId);
  }
});

test("TL;DR SELECT: placeholders equal binds (guest 2, staff 2, member 4), far under D1_MAX_BOUND_PARAMS", async () => {
  const w = await world();
  const root = seedPost(w.db, { authorId: w.id.alice, body: "root" });
  const captured = [];
  const realPrepare = w.env.FORUM_DB.prepare.bind(w.env.FORUM_DB);
  w.env.FORUM_DB.prepare = (sql) => {
    const statement = realPrepare(sql);
    if (!sql.includes("FROM thread_summaries s")) return statement;
    const realBind = statement.bind.bind(statement);
    statement.bind = (...args) => {
      captured.push({ sql, args });
      return realBind(...args);
    };
    return statement;
  };
  const expected = { guest: 2, boss: 2, bob: 4 };
  for (const [who, binds] of Object.entries(expected)) {
    captured.length = 0;
    const res = await call(w.env, "/api/posts/" + root + "/summary", who === "guest" ? {} : { session: w.session(who) });
    assert.equal(res.status, 200, who);
    assert.equal(captured.length, 1, who);
    const { sql, args } = captured[0];
    assert.equal((sql.match(/\?/g) || []).length, args.length, who + " placeholders = binds");
    assert.equal(args.length, binds, who);
    assert.ok(args.length < D1_MAX_BOUND_PARAMS);
    assert.match(sql, /LIMIT 1$/);
  }
});

test("the lock reason and the TL;DR refuse exactly the same characters (shared isRefusedChar)", () => {
  const refused = (fn) => {
    try {
      fn();
      return false;
    } catch (error) {
      return error.status === 400;
    }
  };
  const codes = [];
  for (let code = 0; code <= 0x3000; code += 1) codes.push(code);
  codes.push(0xfeff, 0x1f600);
  for (const code of codes) {
    const text = "a" + String.fromCodePoint(code) + "b";
    assert.equal(refused(() => lockReason(text)), refused(() => summaryBody({}, text)), "U+" + code.toString(16));
  }
  for (const code of [0x00, 0x09, 0x0a, 0x1f, 0x7f, 0x85, 0x9f, 0x2028, 0x2029, 0x202a, 0x202e, 0x2066, 0x2069]) {
    assert.ok(refused(() => lockReason("a" + String.fromCodePoint(code) + "b")), "refused U+" + code.toString(16));
  }
  for (const code of [0x200e, 0x200f, 0x00a0, 0x1f600]) {
    assert.ok(!refused(() => lockReason("a" + String.fromCodePoint(code) + "b")), "allowed U+" + code.toString(16));
  }
});

test("export: the locker's file has no thread-lock section and no lock reason (O9 owner decision)", async () => {
  const w = await world();
  const root = seedPost(w.db, { authorId: w.id.alice, body: "root" });
  lock(w, root);
  const data = await (await call(w.env, "/api/me/export", { session: w.session("boss") })).json();
  assert.ok(Array.isArray(data.threadSummaries));
  assert.ok(!/thread_?locks?/i.test(JSON.stringify(Object.keys(data))));
  assert.doesNotMatch(JSON.stringify(data), new RegExp(REASON_NEEDLE));
});
