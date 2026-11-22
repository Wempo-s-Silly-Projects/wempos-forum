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

// v5.57 security review of v5.53-v5.56 (docs/security-reviews/2026-11-22-v5.53-v5.56.md).
// Pins that lock verified behaviour: the v5.55 menus never hand a staff tool
// to a guest, member or author (admin and owner both get it); the thread page
// builds the slow-mode form and the tag editor only for the roles that had
// them; no client module touched in the range has an HTML sink; a raced
// slow-mode refusal over MCP carries the slow-mode text. L3 (fixed in v5.59):
// a raced, refused reply no longer bumps the thread.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedPost, seedUser, sha256 } from "./helpers/seed.mjs";
import { makeFakeDocument } from "./helpers/fake-dom.mjs";
import { SLOW_MODE_CHECK_SQL, SLOW_MODE_REFUSAL } from "../api/staff-tools.mjs";
import { D1_MAX_BOUND_PARAMS, REPLY_BUMP_SQL } from "../constants.mjs";

// Read aloud only renders where a speech engine exists.
globalThis.speechSynthesis ??= { speak() {}, cancel() {}, getVoices: () => [] };
globalThis.SpeechSynthesisUtterance ??= function Utterance() {};

const { createPostCard } = await import("../public/js/render.js");
const { createSlowModeForm } = await import("../public/js/slow-mode.js");
const { organizeThreadActions } = await import("../public/js/thread-actions.js");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const doc = makeFakeDocument();
const STAFF_ACTIONS = Object.freeze([
  "thread-pin", "thread-unpin", "thread-lock", "thread-unlock", "staff-pick", "staff-unpick", "suggestion-status",
]);

function rootPost(overrides = {}) {
  return {
    id: 12, body: "w557 root", parent: null, visibility: "public", board: "suggestions",
    createdAt: "2026-11-22T10:00:00.000Z", author: { id: 9, username: "alice", role: null, avatarUrl: null },
    likeCount: 0, dislikeCount: 0, viewerReaction: null, viewCount: 1, replyCount: 1, subReplyCount: 0,
    pinnedAt: null, staffPick: false, locked: true, subscribed: false, viewerMuted: false,
    viewerBookmarked: false, ...overrides,
  };
}

// By dataset, not a [data-action=...] selector: the fake DOM's attribute
// selectors do not see dataset writes, so such a query always finds nothing.
const staffNodes = (card) =>
  Array.from(card.querySelectorAll("button")).filter((node) => STAFF_ACTIONS.includes(node.dataset.action));

// ---------------------------------------------------------------- reorg

test("v5.55 menus: guests, members and the author never get a Staff menu or a staff tool; admin and owner do", () => {
  for (const board of ["suggestions", "showcase", "general"]) {
    for (const [label, viewer] of [
      ["guest", null],
      ["member", { id: 3, username: "bob", role: "member" }],
      ["author", { id: 9, username: "alice", role: null }],
    ]) {
      const card = createPostCard(rootPost({ board }), doc, viewer);
      organizeThreadActions(doc, card, { postId: 12 });
      assert.equal(card.querySelector(".thread-staff"), null, `${board} ${label}: no Staff menu`);
      assert.equal(staffNodes(card).length, 0, `${board} ${label}: no staff tool`);
      assert.equal(card.querySelector("form"), null, `${board} ${label}: no staff form`);
    }
    for (const role of ["admin", "owner"]) {
      const card = createPostCard(rootPost({ board }), doc, { id: 1, username: "boss", role });
      organizeThreadActions(doc, card, { postId: 12, staffForms: [createSlowModeForm(doc, 12, null)] });
      const panel = card.querySelector(".thread-staff-panel");
      assert.ok(panel, `${board} ${role}: Staff menu`);
      assert.equal(panel.hidden, true, `${board} ${role}: closed by default`);
      const nodes = staffNodes(card);
      assert.ok(nodes.length >= 2, `${board} ${role}: pin and lock at least`);
      for (const node of nodes) assert.ok(panel.contains(node), `${board} ${role}: ${node.dataset.action} inside Staff`);
    }
  }
});

test("thread page: the slow-mode form is built only for staff, the tag editor only for the author and staff", () => {
  const post = read("public/js/routes/post.js");
  assert.match(post,
    /if \(!post\.parent && \(viewer\?\.role === "owner" \|\| viewer\?\.role === "admin"\)\) \{\s*(\/\/[^\n]*\n\s*)*staffForms\.push\(createSlowModeForm\(/);
  assert.equal((post.match(/createSlowModeForm\(/g) || []).length, 1);
  assert.match(post, /if \(!canEdit\) return null;\s*return createTagEditor\(/);
  assert.match(post,
    /const canEdit = Boolean\(viewer\) && \(isStaffViewer \|\| Number\(post\.author\?\.id\) === Number\(viewer\.id\)\);\s*const \[own, all\]/);
});

test("no client module touched in v5.53-v5.56 has an HTML sink", () => {
  for (const path of [
    "public/js/thread-actions.js", "public/js/settings-groups.js", "public/js/word-diff.js",
    "public/js/render.js", "public/js/router.js", "public/js/app.js", "public/js/icons.js",
    "public/js/routes/account-nav.js", "public/js/routes/feed.js", "public/js/routes/post.js",
  ]) {
    assert.doesNotMatch(read(path), /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|DOMParser|\beval\(|new Function\(/, path);
  }
});

// ---------------------------------------------------------------- M1 follow-up

const AGENT_TOKEN = "w557-agent-token-0123456789abcdefghijklmn";
const SLOW_MODE_SECONDS = 900;
const OLD_ACTIVITY = 1000;

async function world() {
  const env = makeEnv({ AGENT_TOKENS: JSON.stringify({ [sha256(AGENT_TOKEN)]: "bob" }) });
  const db = env.__sqlite;
  const id = {
    boss: await seedUser(db, { username: "boss", role: "admin" }),
    alice: await seedUser(db, { username: "alice" }),
    bob: await seedUser(db, { username: "bob" }),
  };
  const root = seedPost(db, { authorId: id.alice, body: "w557 thread root" });
  db.prepare("INSERT INTO thread_slowmode (post_id, seconds, set_by, set_at) VALUES (?, ?, ?, ?)")
    .run(root, SLOW_MODE_SECONDS, id.boss, now());
  return { env, db, id, root };
}

// The early fast-path read races (stale once); later reads are fresh.
function staleOnce(env) {
  const real = env.FORUM_DB;
  let stale = true;
  return {
    ...env,
    FORUM_DB: {
      prepare(sql) {
        if (sql === SLOW_MODE_CHECK_SQL && stale) {
          stale = false;
          return { bind: () => ({ first: async () => null }) };
        }
        return real.prepare(sql);
      },
      batch: (statements) => real.batch(statements),
      exec: (sql) => real.exec(sql),
    },
  };
}

async function mcpReply(env, postId, body) {
  const res = await call(env, "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + AGENT_TOKEN },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "reply", arguments: { post_id: postId, body } } }),
  });
  return (await res.json()).result;
}

const webReply = (env, postId, body, session) =>
  call(env, "/api/posts/" + postId + "/replies", { method: "POST", body: { body }, session });
const lastActivity = (w) => Number(w.db.prepare("SELECT last_activity_at AS t FROM posts WHERE id = ?").get(w.root).t);

test("M1 follow-up: a raced MCP reply is refused with the slow-mode text, not the generic 409", async () => {
  const w = await world();
  assert.equal((await mcpReply(w.env, w.root, "mcp first")).isError, false);
  const raced = await mcpReply(staleOnce(w.env), w.root, "mcp raced");
  assert.equal(raced.isError, true);
  assert.ok(JSON.stringify(raced.content).includes(SLOW_MODE_REFUSAL), JSON.stringify(raced.content));
});

test("L3: a raced reply refused by the slow-mode guard does not bump the thread", async () => {
  const w = await world();
  const bob = forgeSession(w.db, w.id.bob);
  assert.equal((await webReply(w.env, w.root, "web first", bob)).status, 201);
  w.db.prepare("UPDATE posts SET last_activity_at = ? WHERE id = ?").run(OLD_ACTIVITY, w.root);
  assert.equal((await webReply(staleOnce(w.env), w.root, "web raced", bob)).status, 429);
  assert.equal(lastActivity(w), OLD_ACTIVITY, "web path");
  assert.equal((await mcpReply(staleOnce(w.env), w.root, "mcp raced")).isError, true);
  assert.equal(lastActivity(w), OLD_ACTIVITY, "MCP path");
});

// Records every statement the reply paths bind (sql + bind count).
function bindSpy(env) {
  const real = env.FORUM_DB;
  const seen = [];
  return {
    seen,
    env: {
      ...env,
      FORUM_DB: {
        prepare(sql) {
          const statement = real.prepare(sql);
          const bind = statement.bind.bind(statement);
          statement.bind = (...values) => {
            seen.push({ sql, binds: values.length });
            return bind(...values);
          };
          return statement;
        },
        batch: (statements) => real.batch(statements),
        exec: (sql) => real.exec(sql),
      },
    },
  };
}

test("L3: a landed reply still bumps the thread on both paths, with the bump bound to the new reply row (3 binds)", async () => {
  assert.equal((REPLY_BUMP_SQL.match(/\?/g) || []).length, 3, "was 2 before v5.59: now, root id; now also the reply id");
  assert.match(REPLY_BUMP_SQL, /WHERE reply\.id = \?/);
  const w = await world();
  const bob = forgeSession(w.db, w.id.bob);
  const web = bindSpy(w.env);
  assert.equal((await webReply(web.env, w.root, "web lands", bob)).status, 201);
  assert.ok(lastActivity(w) > OLD_ACTIVITY, "web path bumps");
  const webBump = web.seen.filter((s) => s.sql === REPLY_BUMP_SQL);
  assert.equal(webBump.length, 1);
  assert.equal(webBump[0].binds, 3);
  // Clear the cooldown so the MCP reply lands too.
  w.db.prepare("DELETE FROM thread_slowmode WHERE post_id = ?").run(w.root);
  w.db.prepare("UPDATE posts SET last_activity_at = ? WHERE id = ?").run(OLD_ACTIVITY, w.root);
  const mcp = bindSpy(w.env);
  assert.equal((await mcpReply(mcp.env, w.root, "mcp lands")).isError, false);
  assert.ok(lastActivity(w) > OLD_ACTIVITY, "MCP path bumps");
  const mcpBump = mcp.seen.filter((s) => s.sql === REPLY_BUMP_SQL);
  assert.equal(mcpBump.length, 1);
  assert.equal(mcpBump[0].binds, 3);
  for (const s of [...web.seen, ...mcp.seen]) assert.ok(s.binds < D1_MAX_BOUND_PARAMS, s.binds + " binds");
});

test("L3: a level-2 reply bumps its conversation root, not the reply it answers", async () => {
  const w = await world();
  w.db.prepare("DELETE FROM thread_slowmode WHERE post_id = ?").run(w.root);
  const bob = forgeSession(w.db, w.id.bob);
  const first = await webReply(w.env, w.root, "level one", bob);
  assert.equal(first.status, 201);
  const levelOne = Number((await first.json()).id);
  w.db.prepare("UPDATE posts SET last_activity_at = ? WHERE id = ?").run(OLD_ACTIVITY, w.root);
  assert.equal((await webReply(w.env, levelOne, "level two web", bob)).status, 201);
  assert.ok(lastActivity(w) > OLD_ACTIVITY, "web level-2 bumps the root");
  w.db.prepare("UPDATE posts SET last_activity_at = ? WHERE id = ?").run(OLD_ACTIVITY, w.root);
  assert.equal((await mcpReply(w.env, levelOne, "level two mcp")).isError, false);
  assert.ok(lastActivity(w) > OLD_ACTIVITY, "MCP level-2 bumps the root");
});

test("L3: the row-bound bump is served by primary keys (no table scan)", async () => {
  const w = await world();
  const plan = w.db.prepare("EXPLAIN QUERY PLAN " + REPLY_BUMP_SQL).all(1, 1, 1).map((row) => row.detail).join(" | ");
  assert.doesNotMatch(plan, /\bSCAN (posts|reply|target)\b(?! USING)/, plan);
});
