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

// v5.63 L8 (docs/security-reviews/2026-11-22-v5.57-v5.60.md): the thread bump
// after a landed reply is best-effort. A failing bump is logged server-side and
// the request carries on: the web route still answers 201 and notifies, the MCP
// tool still succeeds (so an agent never retries into a duplicate), and a
// staged (attachment) reply still publishes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedPost, seedUser, sha256 } from "./helpers/seed.mjs";
import { REPLY_BUMP_SQL, STAGED_REPLY_BUMP_SQL } from "../constants.mjs";
import { persistStagedPostAttachments } from "../api/posts-write.mjs";

const AGENT_TOKEN = "w563-agent-token-0123456789abcdefghijklmn";
const OLD_ACTIVITY = 1000;

async function world() {
  const env = makeEnv({ AGENT_TOKENS: JSON.stringify({ [sha256(AGENT_TOKEN)]: "bob" }) });
  const db = env.__sqlite;
  const alice = await seedUser(db, { username: "alice" });
  const bob = await seedUser(db, { username: "bob" });
  const root = seedPost(db, { authorId: alice, body: "w563 thread root" });
  db.prepare("UPDATE posts SET last_activity_at = ? WHERE id = ?").run(OLD_ACTIVITY, root);
  return { env, db, alice, bob, root };
}

// Every bump statement fails, as a transient D1 error would; all else is real.
function failingBump(env) {
  const real = env.FORUM_DB;
  const failing = { bind: () => failing, run: async () => { throw new Error("D1 hiccup on the bump"); } };
  return {
    ...env,
    FORUM_DB: {
      prepare: (sql) => (sql === REPLY_BUMP_SQL || sql === STAGED_REPLY_BUMP_SQL ? failing : real.prepare(sql)),
      batch: (statements) => real.batch(statements),
      exec: (sql) => real.exec(sql),
    },
  };
}

const replies = (w) => w.db.prepare("SELECT id, body, visibility FROM posts WHERE parent_id = ?").all(w.root);
const notified = (w, userId) => w.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?").get(userId).n;
const lastActivity = (w) => Number(w.db.prepare("SELECT last_activity_at AS t FROM posts WHERE id = ?").get(w.root).t);

test("L8 web: a failing bump after the reply landed still answers 201, notifies, and logs", async (t) => {
  const w = await world();
  const logged = t.mock.method(console, "error", () => {});
  const res = await call(failingBump(w.env), "/api/posts/" + w.root + "/replies", {
    method: "POST", body: { body: "web reply" }, session: forgeSession(w.db, w.bob),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(replies(w).length, 1);
  assert.equal(Number(body.id), replies(w)[0].id);
  assert.equal(notified(w, w.alice), 1, "the thread author is still notified");
  assert.equal(lastActivity(w), OLD_ACTIVITY, "the failed bump moved nothing");
  assert.ok(logged.mock.calls.some((c) => String(c.arguments[0]).includes("bump")), "the failure is logged");
});

test("L8 MCP: a failing bump still returns the reply (no tool error, so no retry duplicate) and notifies", async (t) => {
  const w = await world();
  t.mock.method(console, "error", () => {});
  const res = await call(failingBump(w.env), "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + AGENT_TOKEN },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "reply", arguments: { post_id: w.root, body: "mcp reply" } } }),
  });
  const { result } = await res.json();
  assert.equal(result.isError, false, JSON.stringify(result.content));
  assert.equal(replies(w).length, 1);
  assert.equal(notified(w, w.alice), 1);
});

test("L8 staged: a failing bump after the publish still leaves the staged reply public", async (t) => {
  const w = await world();
  t.mock.method(console, "error", () => {});
  const t0 = now();
  const replyId = Number(w.db.prepare(
    "INSERT INTO posts (author_id, parent_id, body, visibility, created_at, last_activity_at, board, staged_at) " +
    "VALUES (?, ?, 'staged reply', 'hidden', ?, ?, 'general', ?)",
  ).run(w.bob, w.root, t0, t0, t0).lastInsertRowid);
  await persistStagedPostAttachments(failingBump(w.env).FORUM_DB, replyId, w.bob, [], [], { bumpTargetId: w.root });
  const row = w.db.prepare("SELECT visibility, staged_at FROM posts WHERE id = ?").get(replyId);
  assert.equal(row.visibility, "public");
  assert.equal(row.staged_at, null);
});

test("L8 staged: a working bump still moves the thread after the publish", async () => {
  const w = await world();
  const t0 = now();
  const replyId = Number(w.db.prepare(
    "INSERT INTO posts (author_id, parent_id, body, visibility, created_at, last_activity_at, board, staged_at) " +
    "VALUES (?, ?, 'staged reply', 'hidden', ?, ?, 'general', ?)",
  ).run(w.bob, w.root, t0, t0, t0).lastInsertRowid);
  await persistStagedPostAttachments(w.env.FORUM_DB, replyId, w.bob, [], [], { bumpTargetId: w.root });
  assert.ok(lastActivity(w) > OLD_ACTIVITY);
});
